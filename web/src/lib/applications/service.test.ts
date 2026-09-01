import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  addNote,
  createApplication,
  listApplicationsBounded,
  listOutcomesWithReviewsBounded,
  listPendingReviews,
  recordOutcome,
  reviewOutcome,
  type ApplicationsServiceDependencies,
} from "./service.ts";
import {
  APPLICATION_LIST_CEILING,
  ApplicationsError,
  OUTCOME_KIND_VALUES,
  OUTCOME_REVIEW_STATE_VALUES,
} from "./types.ts";
import type { ApplicationStagePort, ApplicationStageResult } from "./stage.ts";
import type {
  ApplicationsRepository,
  VaultWritebackDeliveryResult,
  VaultWritebackDriver,
} from "./ports.ts";
import type {
  Application,
  ApplicationNote,
  BankHeatLevel,
  BankOutcomeStats,
  BankOutcomeStatsWindow,
  Outcome,
  OutcomeKind,
  OutcomeNotification,
  OutcomeRefreshJob,
  OutcomeReview,
  OutcomeState,
  VaultWritebackRow,
} from "./types.ts";

// Nothing in this file reads an environment variable, opens a socket or needs a
// database. The repository below models the constraints migration 080 declares,
// so a test that passes here is a test against the same rules Postgres enforces
// — and a rule that drifts between the two shows up as a failure in the pgTAP
// suite rather than being quietly absent from both.

const CLIENT = "dd000000-0000-0000-0000-000000000001";
const ADMIN = "dd000000-0000-0000-0000-000000000011";
const OPERATOR = "dd000000-0000-0000-0000-000000000012";
const TODAY = new Date("2026-08-16T00:00:00.000Z");

// --- Deterministic generation ----------------------------------------------

/**
 * A linear congruential generator, inline so the property runs are reproducible
 * without adding a package. The multiplier and increment are Numerical
 * Recipes'; nothing here is a security control.
 */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
  );
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}

function fingerprint(document: unknown): string {
  return createHash("md5").update(stableStringify(document)).digest("hex");
}

function dayOffset(days: number): string {
  const date = new Date(TODAY.getTime() - days * 86_400_000);
  return date.toISOString().slice(0, 10);
}

function daysAgo(decidedOn: string): number {
  return Math.round((TODAY.getTime() - Date.parse(decidedOn)) / 86_400_000);
}

// --- The in-memory repository ----------------------------------------------

const HOT_APPROVED_LAST_30 = 3;
const WINDOW_DAYS: Readonly<Record<keyof BankOutcomeStats["windows"], number>> = {
  d30: 30,
  d60: 60,
  d90: 90,
  d183: 183,
  d365: 365,
};

interface MemoryRepository {
  repository: ApplicationsRepository;
  calls: string[];
  outcomes: Outcome[];
  reviews: Map<string, OutcomeReview>;
  outbox: Map<string, VaultWritebackRow>;
  notifications: OutcomeNotification[];
  stats: Map<string, BankOutcomeStats>;
  index: Map<string, { version: number; fingerprint: string; document: unknown }>;
  jobs: OutcomeRefreshJob[];
  seedApplication(bankRef: string): Application;
  seedOutcome(
    bankRef: string,
    kind: OutcomeKind,
    decidedOn: string,
    state?: OutcomeState,
  ): void;
  recompute(bankRef: string): void;
}

function emptyWindow(): BankOutcomeStatsWindow {
  return { approved: 0, denied: 0, withdrawn: 0, approvedAmountCents: 0 };
}

let sequence = 0;
function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}${String(sequence).padStart(12, "0")}`;
}

function createMemoryRepository(): MemoryRepository {
  const applications = new Map<string, Application>();
  const notes: ApplicationNote[] = [];
  const outcomes: Outcome[] = [];
  const reviews = new Map<string, OutcomeReview>();
  const outbox = new Map<string, VaultWritebackRow>();
  const notifications: OutcomeNotification[] = [];
  const stats = new Map<string, BankOutcomeStats>();
  const index = new Map<
    string,
    { version: number; fingerprint: string; document: unknown }
  >();
  const jobs: OutcomeRefreshJob[] = [];
  const calls: string[] = [];

  function record(name: string): void {
    calls.push(name);
  }

  /**
   * The recompute, mirroring `public.run_outcome_refresh_job`: aggregate the
   * counted outcomes into five windows, derive the heat level, build the
   * retrieval document, and write only when the document's fingerprint moved.
   *
   * The document deliberately omits `stats_version`. A version inside the
   * fingerprinted content would make every run look like a change and
   * idempotency would be unreachable.
   */
  function recompute(bankRef: string): void {
    const counted = outcomes.filter(
      (row) => row.bankRef === bankRef && row.state === "counted",
    );

    const windows = {} as BankOutcomeStats["windows"];
    for (const [name, days] of Object.entries(WINDOW_DAYS)) {
      const key = name as keyof BankOutcomeStats["windows"];
      const bucket = emptyWindow();
      for (const row of counted) {
        if (daysAgo(row.decidedOn) > days) continue;
        bucket[row.kind] += 1;
        if (row.kind === "approved") {
          bucket.approvedAmountCents += row.amountCents ?? 0;
        }
      }
      windows[key] = bucket;
    }

    const d30 = windows.d30;
    const d90 = windows.d90;
    const heatLevel: BankHeatLevel =
      d30.approved >= HOT_APPROVED_LAST_30
        ? "hot"
        : d90.approved + d90.denied + d90.withdrawn === 0
          ? "cold"
          : "warm";

    const lastOutcomeAt =
      counted.length === 0
        ? null
        : counted
            .map((row) => row.decidedOn)
            .sort()
            .at(-1) ?? null;

    const document = {
      approved_amount_cents_total: counted.reduce(
        (total, row) => total + (row.kind === "approved" ? (row.amountCents ?? 0) : 0),
        0,
      ),
      bank_ref: bankRef,
      heat_level: heatLevel,
      last_outcome_at: lastOutcomeAt,
      outcome_count_total: counted.length,
      windows,
    };

    const digest = fingerprint(document);
    const current = index.get(bankRef);
    if (current !== undefined && current.fingerprint === digest) return;

    const version = (current?.version ?? 0) + 1;
    stats.set(bankRef, {
      bankRef,
      statsVersion: version,
      heatLevel,
      windows,
      lastOutcomeAt,
      approvedAmountCentsTotal: document.approved_amount_cents_total,
      outcomeCountTotal: document.outcome_count_total,
      computedAt: TODAY.toISOString(),
    });
    index.set(bankRef, { version, fingerprint: digest, document });
  }

  function enqueue(bankRef: string, changeId: string): OutcomeRefreshJob {
    const key = `outcomes.refresh_stats|bank:${bankRef}|change:${changeId}`;
    const existing = jobs.find((job) => job.idempotencyKey === key);
    if (existing !== undefined) return existing;
    const job: OutcomeRefreshJob = {
      id: nextId("job-"),
      bankRef,
      changeId,
      subject: `bank:${bankRef}`,
      window: `change:${changeId}`,
      idempotencyKey: key,
      status: "queued",
      attemptCount: 0,
      errorCode: null,
    };
    jobs.push(job);
    return job;
  }

  const repository: ApplicationsRepository = {
    async listApplications(clientId) {
      record("listApplications");
      return [...applications.values()].filter((row) => row.clientId === clientId);
    },
    async readApplication(applicationId) {
      record("readApplication");
      return applications.get(applicationId) ?? null;
    },
    async createApplication(input) {
      record("createApplication");
      const application: Application = {
        id: nextId("app-"),
        clientId: input.clientId,
        bankRef: input.bankRef,
        operatorStatus: "wait",
        consumerStatus: "pending",
        amountCents: input.amountCents ?? null,
        visibility: input.visibility ?? "inherit",
        createdAt: TODAY.toISOString(),
        updatedAt: TODAY.toISOString(),
      };
      applications.set(application.id, application);
      return application;
    },
    async updateApplication(input) {
      record("updateApplication");
      const existing = applications.get(input.applicationId);
      if (existing === undefined) throw new ApplicationsError("not_found");
      const updated: Application = {
        ...existing,
        operatorStatus: input.operatorStatus ?? existing.operatorStatus,
        consumerStatus: input.consumerStatus ?? existing.consumerStatus,
        amountCents:
          input.amountCents === undefined ? existing.amountCents : input.amountCents,
        visibility: input.visibility ?? existing.visibility,
      };
      applications.set(updated.id, updated);
      return updated;
    },
    async listNotes(applicationId) {
      record("listNotes");
      return notes.filter((note) => note.applicationId === applicationId);
    },
    async addNote(input) {
      record("addNote");
      // `application_notes_operator_attestation`. The service refuses first, so
      // reaching this line at all is the failure the test asserts against.
      if (input.authorKind === "operator" && !input.attested) {
        throw new ApplicationsError("attestation_required");
      }
      const note: ApplicationNote = {
        id: nextId("note-"),
        applicationId: input.applicationId,
        authorProfileId: input.authorProfileId,
        authorKind: input.authorKind,
        body: input.body,
        attested: input.attested,
        createdAt: TODAY.toISOString(),
      };
      notes.push(note);
      return note;
    },
    async recordOutcome(input) {
      record("recordOutcome");
      const application = applications.get(input.applicationId);
      if (application === undefined) throw new ApplicationsError("not_found");

      // `outcomes_amount_shape`: an approved outcome carries a positive amount
      // and every other kind carries none.
      const approved = input.kind === "approved";
      if (approved && (input.amountCents === null || input.amountCents <= 0)) {
        throw new ApplicationsError("conflict");
      }
      if (!approved && input.amountCents !== null) {
        throw new ApplicationsError("conflict");
      }

      // `outcomes_one_counted_per_application`, the partial unique index.
      const clash = outcomes.some(
        (row) => row.applicationId === input.applicationId && row.state === "counted",
      );
      if (clash) throw new ApplicationsError("conflict");

      const outcome: Outcome = {
        id: nextId("out-"),
        applicationId: input.applicationId,
        bankRef: application.bankRef,
        clientId: application.clientId,
        kind: input.kind,
        amountCents: input.amountCents,
        // D-01: the column default, not a decision made up here.
        state: "counted",
        recordedByKind: "operator",
        // `record_outcome` coalesces a null to `current_date`.
        decidedOn: input.decidedOn ?? dayOffset(0),
        createdAt: TODAY.toISOString(),
      };
      outcomes.push(outcome);

      // The `outcomes_ensure_review` trigger, in the same transaction.
      reviews.set(outcome.id, {
        id: nextId("rev-"),
        outcomeId: outcome.id,
        state: "pending",
        reviewedAt: null,
        reasonCode: null,
        createdAt: TODAY.toISOString(),
      });
      enqueue(outcome.bankRef, outcome.id);
      recompute(outcome.bankRef);
      return outcome.id;
    },
    async readOutcome(outcomeId) {
      record("readOutcome");
      return outcomes.find((row) => row.id === outcomeId) ?? null;
    },
    async listOutcomes(clientId) {
      record("listOutcomes");
      return outcomes.filter((row) => row.clientId === clientId);
    },
    async readReview(outcomeId) {
      record("readReview");
      return reviews.get(outcomeId) ?? null;
    },
    async listReviews(outcomeIds) {
      record("listReviews");
      return outcomeIds
        .map((outcomeId) => reviews.get(outcomeId))
        .filter((row): row is OutcomeReview => row !== undefined);
    },
    async listPendingReviews() {
      record("listPendingReviews");
      return [...reviews.values()].filter((row) => row.state === "pending");
    },
    async reviewOutcome(input) {
      record("reviewOutcome");
      // D-09: platform admin only. An operator must not be able to remove its
      // own inconvenient entry.
      if (input.actorProfileId !== ADMIN) throw new ApplicationsError("forbidden");

      const review = reviews.get(input.outcomeId);
      const outcome = outcomes.find((row) => row.id === input.outcomeId);
      if (review === undefined || outcome === undefined) {
        throw new ApplicationsError("not_found");
      }

      if (review.state === input.decision) {
        return {
          result: "unchanged",
          reviewState: review.state,
          outboxState: outbox.get(input.outcomeId)?.state ?? null,
          notified: false,
        };
      }

      reviews.set(input.outcomeId, {
        ...review,
        state: input.decision,
        reviewedAt: TODAY.toISOString(),
      });

      if (input.decision === "approved") {
        outbox.set(input.outcomeId, {
          id: nextId("box-"),
          outcomeId: input.outcomeId,
          bankRef: outcome.bankRef,
          target: "bank_datapoints",
          // APPS-03's tag is a check constraint, not a caller's choice.
          source: "mostfundable",
          payload: {
            amount_cents: outcome.amountCents ?? 0,
            bank_ref: outcome.bankRef,
            decided_on: outcome.decidedOn,
            outcome_kind: outcome.kind,
            stats_version: stats.get(outcome.bankRef)?.statsVersion ?? 0,
          },
          state: "recorded",
          recordedAt: TODAY.toISOString(),
          failureCode: null,
        });
      } else {
        const staged = outbox.get(input.outcomeId);
        if (staged?.state === "recorded") outbox.delete(input.outcomeId);
        const position = outcomes.findIndex((row) => row.id === input.outcomeId);
        outcomes[position] = { ...outcome, state: "removed" };
      }

      notifications.push({
        id: nextId("ntf-"),
        outcomeId: input.outcomeId,
        kind:
          input.decision === "approved"
            ? "outcome_review_approved"
            : "outcome_review_removed",
        createdAt: TODAY.toISOString(),
        readAt: null,
      });

      // D-11: keyed on the decision, so a correction is not swallowed by the
      // already-succeeded job the approval enqueued.
      enqueue(outcome.bankRef, `${review.id}:${input.decision}`);
      recompute(outcome.bankRef);

      return {
        result: "decided",
        reviewState: input.decision,
        outboxState: outbox.get(input.outcomeId)?.state ?? null,
        notified: true,
      };
    },
    async readBankStats(bankRef) {
      record("readBankStats");
      return stats.get(bankRef) ?? null;
    },
    async listBankStats(bankRefs) {
      record("listBankStats");
      return bankRefs.flatMap((ref) => {
        const row = stats.get(ref);
        return row === undefined ? [] : [row];
      });
    },
    async listNotifications() {
      record("listNotifications");
      return [...notifications];
    },
    async enqueueRefreshJob(bankRef, changeId) {
      record("enqueueRefreshJob");
      return enqueue(bankRef, changeId);
    },
    async claimRefreshJob() {
      record("claimRefreshJob");
      const job = jobs.find((row) => row.status === "queued");
      if (job === undefined) return null;
      job.status = "running";
      job.attemptCount += 1;
      return job;
    },
    async runRefreshJob(jobId) {
      record("runRefreshJob");
      const job = jobs.find((row) => row.id === jobId);
      if (job === undefined) throw new ApplicationsError("not_found");
      recompute(job.bankRef);
      job.status = "succeeded";
      return job;
    },
    async failRefreshJob(input) {
      record("failRefreshJob");
      const job = jobs.find((row) => row.id === input.jobId);
      if (job === undefined) throw new ApplicationsError("not_found");
      job.status = input.retry ? "queued" : "failed";
      job.errorCode = input.errorCode;
      return job;
    },
    async listWritebackOutbox(state) {
      record("listWritebackOutbox");
      return [...outbox.values()].filter((row) => row.state === state);
    },
    async readWriteback(outcomeId) {
      record("readWriteback");
      return outbox.get(outcomeId) ?? null;
    },
    async markWriteback(id, state, failureCode) {
      record("markWriteback");
      for (const [key, row] of outbox) {
        if (row.id === id) outbox.set(key, { ...row, state, failureCode });
      }
    },
  };

  return {
    repository,
    calls,
    outcomes,
    reviews,
    outbox,
    notifications,
    stats,
    index,
    jobs,
    seedApplication(bankRef) {
      const application: Application = {
        id: nextId("app-"),
        clientId: CLIENT,
        bankRef,
        operatorStatus: "wait",
        consumerStatus: "pending",
        amountCents: null,
        visibility: "inherit",
        createdAt: TODAY.toISOString(),
        updatedAt: TODAY.toISOString(),
      };
      applications.set(application.id, application);
      return application;
    },
    seedOutcome(bankRef, kind, decidedOn, state = "counted") {
      outcomes.push({
        id: nextId("out-"),
        applicationId: nextId("app-"),
        bankRef,
        clientId: CLIENT,
        kind,
        amountCents: kind === "approved" ? 500_00 : null,
        state,
        recordedByKind: "operator",
        decidedOn,
        createdAt: TODAY.toISOString(),
      });
    },
    recompute,
  };
}

// --- Injected collaborators -------------------------------------------------

function stagePort(result: ApplicationStageResult): {
  port: ApplicationStagePort;
  calls: { clientId: string; to: string }[];
} {
  const calls: { clientId: string; to: string }[] = [];
  return {
    calls,
    port: {
      async advance(clientId, to) {
        calls.push({ clientId, to });
        return result;
      },
    },
  };
}

function writebackDriver(result: VaultWritebackDeliveryResult): {
  driver: VaultWritebackDriver;
  calls: VaultWritebackRow[];
} {
  const calls: VaultWritebackRow[] = [];
  return {
    calls,
    driver: {
      async deliver(row) {
        calls.push(row);
        return result;
      },
    },
  };
}

function deps(
  memory: MemoryRepository,
  overrides: Partial<ApplicationsServiceDependencies> = {},
): ApplicationsServiceDependencies {
  return {
    repository: memory.repository,
    stage: overrides.stage ?? stagePort("unavailable").port,
    writeback: overrides.writeback ?? writebackDriver({ state: "recorded" }).driver,
  };
}

function amountFor(kind: OutcomeKind): number | null {
  return kind === "approved" ? 1_000_00 : null;
}

// --- Property 1: counted is independent of review ---------------------------

test("property: an outcome counts on entry for every kind, review state and decision", async () => {
  let combinations = 0;

  for (const kind of OUTCOME_KIND_VALUES) {
    for (const reviewState of OUTCOME_REVIEW_STATE_VALUES) {
      for (const applied of [false, true]) {
        combinations += 1;

        const memory = createMemoryRepository();
        const application = memory.seedApplication("bank-property-1");
        const dependencies = deps(memory);

        const recorded = await recordOutcome(
          {
            applicationId: application.id,
            kind,
            amountCents: amountFor(kind),
            decidedOn: dayOffset(1),
            actorProfileId: OPERATOR,
          },
          dependencies,
        );

        // APPS-02, immediately and unconditionally: the entry counted before
        // any reviewer saw it.
        assert.equal(
          recorded.outcome.state,
          "counted",
          `${kind}/${reviewState}/${applied} must count on entry`,
        );
        assert.equal(recorded.review?.state, "pending");

        // `pending` is where every review starts, so there is no decision to
        // apply for that arm; the assertion is that nothing changed.
        if (applied && reviewState !== "pending") {
          await reviewOutcome(
            {
              outcomeId: recorded.outcome.id,
              decision: reviewState,
              actorProfileId: ADMIN,
            },
            dependencies,
          );
        }

        const after = await memory.repository.readOutcome(recorded.outcome.id);
        const expected = applied && reviewState === "removed" ? "removed" : "counted";
        assert.equal(
          after?.state,
          expected,
          `${kind}/${reviewState}/applied=${applied} left the wrong state`,
        );

        // The review never gates the count: the only thing that can change an
        // outcome's state is an applied `removed` decision, and that is a
        // correction after the fact rather than a condition on the entry.
        if (expected === "counted") {
          assert.equal(after?.kind, kind);
        }
      }
    }
  }

  assert.equal(combinations, 18, "3 kinds x 3 review states x applied/not");
});

// --- Property 2: the recompute is a fixed point -----------------------------

interface GeneratedCase {
  label: string;
  outcomes: { kind: OutcomeKind; offset: number }[];
}

/** Every window edge and the day either side of it. */
const WINDOW_BOUNDARIES = [30, 60, 90, 183, 365];

function generateCases(): GeneratedCase[] {
  const cases: GeneratedCase[] = [
    { label: "zero outcomes", outcomes: [] },
    { label: "one outcome", outcomes: [{ kind: "approved", offset: 0 }] },
    {
      label: "hot: three approvals inside thirty days",
      outcomes: [
        { kind: "approved", offset: 1 },
        { kind: "approved", offset: 10 },
        { kind: "approved", offset: 29 },
      ],
    },
    {
      label: "cold: nothing inside ninety days",
      outcomes: [
        { kind: "approved", offset: 200 },
        { kind: "denied", offset: 300 },
      ],
    },
    {
      label: "warm: one denial inside ninety days",
      outcomes: [{ kind: "denied", offset: 45 }],
    },
  ];

  // Either side of each of the five window boundaries, for each kind.
  for (const boundary of WINDOW_BOUNDARIES) {
    for (const offset of [boundary - 1, boundary, boundary + 1]) {
      for (const kind of OUTCOME_KIND_VALUES) {
        cases.push({
          label: `boundary ${boundary} at ${offset} days (${kind})`,
          outcomes: [{ kind, offset }],
        });
      }
    }
  }

  // Random mixtures, seeded so a failure is reproducible from the label alone.
  const random = seededRandom(20_260_816);
  for (let index = 0; index < 40; index += 1) {
    const count = Math.floor(random() * 7);
    const generated: GeneratedCase["outcomes"] = [];
    for (let item = 0; item < count; item += 1) {
      generated.push({
        kind: OUTCOME_KIND_VALUES[Math.floor(random() * OUTCOME_KIND_VALUES.length)],
        offset: Math.floor(random() * 400),
      });
    }
    cases.push({ label: `generated #${index}`, outcomes: generated });
  }

  return cases;
}

test("property: applying the recompute twice equals applying it once", () => {
  const cases = generateCases();
  assert.ok(cases.length >= 50, `expected at least fifty inputs, got ${cases.length}`);

  const heatSeen = new Set<BankHeatLevel>();
  let advancedOnFirstRun = 0;

  for (const generated of cases) {
    const memory = createMemoryRepository();
    const bankRef = "bank-property-2";
    for (const item of generated.outcomes) {
      memory.seedOutcome(bankRef, item.kind, dayOffset(item.offset));
    }

    memory.recompute(bankRef);
    const first = memory.index.get(bankRef);
    const firstStats = memory.stats.get(bankRef);
    assert.ok(first !== undefined && firstStats !== undefined, generated.label);
    if (first.version === 1) advancedOnFirstRun += 1;
    heatSeen.add(firstStats.heatLevel);

    const firstSnapshot = stableStringify({ first, firstStats });

    memory.recompute(bankRef);
    const second = memory.index.get(bankRef);
    const secondStats = memory.stats.get(bankRef);

    // f(f(x)) === f(x), down to the version and the timestamp: a second run
    // that rewrote the same content would still be a version bump every reader
    // has to reconcile.
    assert.equal(
      stableStringify({ first: second, firstStats: secondStats }),
      firstSnapshot,
      `${generated.label} is not a fixed point`,
    );
    assert.equal(second?.version, 1, `${generated.label} advanced on a no-op run`);
  }

  // The companion assertion. A recompute that never wrote anything would
  // satisfy the fixed point trivially, so every case has to have advanced the
  // version exactly once on its first run.
  assert.equal(
    advancedOnFirstRun,
    cases.length,
    "an inert recompute would pass the fixed point and must not pass this",
  );

  // And the generated set has to have exercised all three heat states, or the
  // property proved a fixed point over one shape of document.
  assert.deepEqual([...heatSeen].sort(), ["cold", "hot", "warm"]);
});

test("property: the version advances when, and only when, the document changes", () => {
  const memory = createMemoryRepository();
  const bankRef = "bank-version";

  memory.recompute(bankRef);
  assert.equal(memory.index.get(bankRef)?.version, 1, "the first document is a change");

  for (let index = 0; index < 5; index += 1) memory.recompute(bankRef);
  assert.equal(memory.index.get(bankRef)?.version, 1, "no content change, no version");

  memory.seedOutcome(bankRef, "approved", dayOffset(2));
  memory.recompute(bankRef);
  assert.equal(memory.index.get(bankRef)?.version, 2, "new content advances the version");
  memory.recompute(bankRef);
  assert.equal(memory.index.get(bankRef)?.version, 2);

  // A tombstoned outcome is a real row that the aggregate does not see, so the
  // document is byte-identical and the version must hold. The lifetime totals
  // in the document mean every *counted* row moves it, which is why this is the
  // negative case rather than an outcome dated outside every window.
  memory.seedOutcome(bankRef, "approved", dayOffset(3), "removed");
  memory.recompute(bankRef);
  assert.equal(
    memory.index.get(bankRef)?.version,
    2,
    "a row the aggregate cannot see is not a change",
  );

  // And an outcome dated outside every window still moves the lifetime totals,
  // so it is a change and the version does advance.
  memory.seedOutcome(bankRef, "approved", dayOffset(400));
  memory.recompute(bankRef);
  assert.equal(memory.index.get(bankRef)?.version, 3);
});

// --- The ordinary cases -----------------------------------------------------

test("an operator note without the attestation never reaches the database", async () => {
  const memory = createMemoryRepository();
  const application = memory.seedApplication("bank-notes");

  await assert.rejects(
    addNote(
      {
        applicationId: application.id,
        authorProfileId: OPERATOR,
        authorKind: "operator",
        body: "Spoke to the lender.",
        attested: false,
      },
      deps(memory),
    ),
    (error: unknown) => {
      assert.ok(error instanceof ApplicationsError);
      assert.equal(error.code, "attestation_required");
      return true;
    },
  );

  assert.equal(memory.calls.includes("addNote"), false, "refused before the insert");
});

test("a consumer note needs no attestation", async () => {
  const memory = createMemoryRepository();
  const application = memory.seedApplication("bank-notes");

  const note = await addNote(
    {
      applicationId: application.id,
      authorProfileId: CLIENT,
      authorKind: "consumer",
      body: "The bank asked for another statement.",
      attested: false,
    },
    deps(memory),
  );

  assert.equal(note.authorKind, "consumer");
});

test("approving a review hands the staged row to the driver exactly once", async () => {
  const memory = createMemoryRepository();
  const application = memory.seedApplication("bank-writeback");
  const driver = writebackDriver({ state: "recorded" });
  const dependencies = deps(memory, { writeback: driver.driver });

  const recorded = await recordOutcome(
    {
      applicationId: application.id,
      kind: "approved",
      amountCents: 750_00,
      decidedOn: dayOffset(1),
      actorProfileId: OPERATOR,
    },
    dependencies,
  );

  const decided = await reviewOutcome(
    { outcomeId: recorded.outcome.id, decision: "approved", actorProfileId: ADMIN },
    dependencies,
  );

  assert.equal(decided.result, "decided");
  assert.equal(decided.notified, true);
  assert.equal(driver.calls.length, 1);
  assert.equal(driver.calls[0]?.source, "mostfundable");
  assert.deepEqual(Object.keys(driver.calls[0]?.payload ?? {}).sort(), [
    "amount_cents",
    "bank_ref",
    "decided_on",
    "outcome_kind",
    "stats_version",
  ]);

  // The fixture arm returns the state the row already holds, so nothing is
  // written back to the outbox at all.
  assert.equal(memory.calls.includes("markWriteback"), false);
  assert.equal(memory.outbox.get(recorded.outcome.id)?.state, "recorded");
});

test("a repeated decision changes nothing and delivers nothing", async () => {
  const memory = createMemoryRepository();
  const application = memory.seedApplication("bank-repeat");
  const driver = writebackDriver({ state: "recorded" });
  const dependencies = deps(memory, { writeback: driver.driver });

  const recorded = await recordOutcome(
    {
      applicationId: application.id,
      kind: "approved",
      amountCents: 100_00,
      decidedOn: dayOffset(3),
      actorProfileId: OPERATOR,
    },
    dependencies,
  );
  const input = {
    outcomeId: recorded.outcome.id,
    decision: "approved" as const,
    actorProfileId: ADMIN,
  };

  await reviewOutcome(input, dependencies);
  const again = await reviewOutcome(input, dependencies);

  // Plan 06 turns `unchanged` into a 409. The RPC does not throw on it, so the
  // route can tell "already decided" apart from "failed".
  assert.equal(again.result, "unchanged");
  assert.equal(again.delivery, null);
  assert.equal(driver.calls.length, 1, "the second decision delivered nothing");
});

test("a failed delivery leaves the decision standing and marks the row", async () => {
  const memory = createMemoryRepository();
  const application = memory.seedApplication("bank-transport");
  const driver = writebackDriver({ state: "failed", failureCode: "transport" });
  const dependencies = deps(memory, { writeback: driver.driver });

  const recorded = await recordOutcome(
    {
      applicationId: application.id,
      kind: "approved",
      amountCents: 250_00,
      decidedOn: dayOffset(4),
      actorProfileId: OPERATOR,
    },
    dependencies,
  );

  const decided = await reviewOutcome(
    { outcomeId: recorded.outcome.id, decision: "approved", actorProfileId: ADMIN },
    dependencies,
  );

  assert.equal(decided.result, "decided");
  assert.equal(decided.reviewState, "approved");
  assert.equal(decided.outboxState, "failed");
  assert.equal(memory.reviews.get(recorded.outcome.id)?.state, "approved");
  assert.equal(memory.outbox.get(recorded.outcome.id)?.state, "failed");
  assert.equal(memory.outbox.get(recorded.outcome.id)?.failureCode, "transport");

  // T-11-20: an unreachable VAULT does not roll the decision back.
  assert.equal(
    (await memory.repository.readOutcome(recorded.outcome.id))?.state,
    "counted",
  );
});

test("a driver that throws is still not allowed to break the review", async () => {
  const memory = createMemoryRepository();
  const application = memory.seedApplication("bank-throwing");
  const dependencies = deps(memory, {
    writeback: {
      async deliver() {
        throw new Error("the network is on fire");
      },
    },
  });

  const recorded = await recordOutcome(
    {
      applicationId: application.id,
      kind: "approved",
      amountCents: 300_00,
      decidedOn: dayOffset(5),
      actorProfileId: OPERATOR,
    },
    dependencies,
  );

  const decided = await reviewOutcome(
    { outcomeId: recorded.outcome.id, decision: "approved", actorProfileId: ADMIN },
    dependencies,
  );

  assert.equal(decided.result, "decided");
  assert.equal(decided.outboxState, "failed");
  assert.equal(memory.outbox.get(recorded.outcome.id)?.failureCode, "transport");
});

test("a non-admin reviewer gets a code, never a database message", async () => {
  const memory = createMemoryRepository();
  const application = memory.seedApplication("bank-forbidden");
  const dependencies = deps(memory);

  const recorded = await recordOutcome(
    {
      applicationId: application.id,
      kind: "denied",
      amountCents: null,
      decidedOn: dayOffset(6),
      actorProfileId: OPERATOR,
    },
    dependencies,
  );

  await assert.rejects(
    reviewOutcome(
      { outcomeId: recorded.outcome.id, decision: "removed", actorProfileId: OPERATOR },
      dependencies,
    ),
    (error: unknown) => {
      assert.ok(error instanceof ApplicationsError);
      assert.equal(error.code, "forbidden");
      assert.equal(error.message, "Applications operation failed");
      return true;
    },
  );

  assert.equal(memory.reviews.get(recorded.outcome.id)?.state, "pending");
});

test("removing an outcome clears the staged row and leaves a tombstone", async () => {
  const memory = createMemoryRepository();
  const application = memory.seedApplication("bank-correction");
  const driver = writebackDriver({ state: "recorded" });
  const dependencies = deps(memory, { writeback: driver.driver });

  const recorded = await recordOutcome(
    {
      applicationId: application.id,
      kind: "approved",
      amountCents: 900_00,
      decidedOn: dayOffset(2),
      actorProfileId: OPERATOR,
    },
    dependencies,
  );
  await reviewOutcome(
    { outcomeId: recorded.outcome.id, decision: "approved", actorProfileId: ADMIN },
    dependencies,
  );

  const corrected = await reviewOutcome(
    { outcomeId: recorded.outcome.id, decision: "removed", actorProfileId: ADMIN },
    dependencies,
  );

  assert.equal(corrected.result, "decided");
  assert.equal(corrected.delivery, null, "a correction delivers nothing");
  assert.equal(memory.outbox.has(recorded.outcome.id), false);
  assert.equal(
    (await memory.repository.readOutcome(recorded.outcome.id))?.state,
    "removed",
  );

  // The correction re-enqueued under its own key rather than colliding with the
  // approval's already-succeeded job (D-11).
  assert.equal(new Set(memory.jobs.map((job) => job.idempotencyKey)).size, 3);
});

test("creating an application asks for Applying and survives being told no", async () => {
  const memory = createMemoryRepository();
  const stage = stagePort("unavailable");

  const created = await createApplication(
    { clientId: CLIENT, bankRef: "bank-stage", createdBy: OPERATOR },
    deps(memory, { stage: stage.port }),
  );

  assert.equal(created.application.clientId, CLIENT);
  assert.equal(created.stage, "unavailable");
  assert.deepEqual(stage.calls, [{ clientId: CLIENT, to: "applying" }]);
});

test("an approved outcome asks for Funded and a denied one asks for nothing", async () => {
  const memory = createMemoryRepository();
  const approvedStage = stagePort("transitioned");
  const application = memory.seedApplication("bank-funded");

  const approved = await recordOutcome(
    {
      applicationId: application.id,
      kind: "approved",
      amountCents: 500_00,
      decidedOn: dayOffset(1),
      actorProfileId: OPERATOR,
    },
    deps(memory, { stage: approvedStage.port }),
  );
  assert.equal(approved.stage, "transitioned");
  assert.deepEqual(approvedStage.calls, [{ clientId: CLIENT, to: "funded" }]);

  const deniedStage = stagePort("transitioned");
  const other = memory.seedApplication("bank-funded");
  const denied = await recordOutcome(
    {
      applicationId: other.id,
      kind: "denied",
      amountCents: null,
      decidedOn: dayOffset(1),
      actorProfileId: OPERATOR,
    },
    deps(memory, { stage: deniedStage.port }),
  );
  assert.equal(denied.stage, "skipped");
  assert.deepEqual(deniedStage.calls, []);
});

test("the pending queue holds exactly the undecided reviews", async () => {
  const memory = createMemoryRepository();
  const dependencies = deps(memory);
  const first = memory.seedApplication("bank-queue");
  const second = memory.seedApplication("bank-queue");

  const kept = await recordOutcome(
    {
      applicationId: first.id,
      kind: "withdrawn",
      amountCents: null,
      decidedOn: dayOffset(1),
      actorProfileId: OPERATOR,
    },
    dependencies,
  );
  const decided = await recordOutcome(
    {
      applicationId: second.id,
      kind: "denied",
      amountCents: null,
      decidedOn: dayOffset(1),
      actorProfileId: OPERATOR,
    },
    dependencies,
  );
  await reviewOutcome(
    { outcomeId: decided.outcome.id, decision: "approved", actorProfileId: ADMIN },
    dependencies,
  );

  const pending = await listPendingReviews(dependencies);
  assert.deepEqual(
    pending.map((review) => review.outcomeId),
    [kept.outcome.id],
  );
});

test("one counted outcome per application, as the partial unique index has it", async () => {
  const memory = createMemoryRepository();
  const application = memory.seedApplication("bank-unique");
  const dependencies = deps(memory);
  const input = {
    applicationId: application.id,
    kind: "denied" as const,
    amountCents: null,
    decidedOn: dayOffset(1),
    actorProfileId: OPERATOR,
  };

  const first = await recordOutcome(input, dependencies);
  await assert.rejects(recordOutcome(input, dependencies), (error: unknown) => {
    assert.ok(error instanceof ApplicationsError);
    assert.equal(error.code, "conflict");
    return true;
  });

  // Correcting the first one frees the slot: that is what the `where` clause on
  // the index is for, and a plain unique key would have blocked this forever.
  await reviewOutcome(
    { outcomeId: first.outcome.id, decision: "removed", actorProfileId: ADMIN },
    dependencies,
  );
  const second = await recordOutcome(input, dependencies);
  assert.equal(second.outcome.state, "counted");
});

/**
 * The bounded list calls must be able to ask past the answer ceiling.
 *
 * The assistant reads one row more than it will ground an answer on, so that an
 * overflow is a fact it can observe rather than a silence. That only works if
 * this layer passes the request through: while the clamp sat one below, asking
 * for the probe row returned exactly the ceiling and "there are more" became
 * indistinguishable from "there are exactly this many".
 */
test("a bounded application list forwards the overflow probe row", async () => {
  const asked: number[] = [];
  const repository = {
    async listApplications(_clientId: string, limit?: number) {
      asked.push(limit ?? -1);
      return [];
    },
    async listOutcomes(_clientId: string, limit?: number) {
      asked.push(limit ?? -1);
      return [];
    },
  } as unknown as ApplicationsRepository;

  await listApplicationsBounded("11111111-1111-4111-8111-111111111111", APPLICATION_LIST_CEILING, { repository } as unknown as ApplicationsServiceDependencies);
  await listOutcomesWithReviewsBounded("11111111-1111-4111-8111-111111111111", APPLICATION_LIST_CEILING, { repository } as unknown as ApplicationsServiceDependencies);

  assert.deepEqual(asked, [APPLICATION_LIST_CEILING, APPLICATION_LIST_CEILING]);
  assert.ok(APPLICATION_LIST_CEILING > 30, "the ceiling leaves no room for the probe row");
});
