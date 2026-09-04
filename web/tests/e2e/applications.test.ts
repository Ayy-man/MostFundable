/**
 * The live chain for Phase 11: create → attest → record → review → recompute.
 *
 * Everything before this file proves a piece. pgTAP proves the constraints,
 * `node --test` proves the mechanism, and the route tests prove the flag-off
 * default. None of them proves the pieces are wired to each other, and the two
 * ROADMAP criteria are claims about the running system rather than about the
 * schema. This file is the only place they are observed over HTTP.
 *
 * Both identities are seeded Phase 1 profiles the other e2e files already use,
 * so no new identity is introduced. The client is a reserved fixture row rather
 * than a seeded one, because hanging applications and outcomes off a demo
 * persona would leave the seed data in a state this file then has to repair.
 *
 * ## What this run can and cannot remove
 *
 * It removes the outcome it recorded, which cascades the review, the staged
 * write-back row and the notification, and it removes the three rows keyed on
 * its own lender handle. It cannot remove the application or the note, and it
 * does not try: `application_notes_prevent_change`
 * (`supabase/migrations/080_applications_outcomes.sql:92-94`) makes a note
 * append-only on purpose — an attestation that could be deleted is not an
 * attestation — and an application with a note therefore cannot be deleted
 * either, because the cascade reaches the guarded table. The client is
 * un-deletable for the same reason one level up: `audit_log.client_id` cascades
 * and `audit_log_prevent_change` refuses the cascaded delete.
 *
 * So the fixture client is a single reserved row created once and reused by
 * every later run, which is what keeps the residue at one application and one
 * note per run instead of also adding a client. `docs/GAPS.md` G-11-10 records
 * the interaction; it is a property of two deliberate append-only designs
 * meeting, not a defect in either.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { drainOutcomeRefreshJobs } from "@/lib/applications";
import { supabaseApplicationsRepository } from "@/lib/applications/repository";
import { featureFlag } from "@/lib/env";

import { enrollmentBaseUrl, enrollmentServerUp } from "./support";

/** Seeded Phase 1 identities. The operator is an org owner, so it reaches every client in its org. */
const OPERATOR_ID = "a1000000-0000-0000-0000-000000000001";
const PLATFORM_ADMIN_ID = "00000000-0000-0000-0000-000000000001";
const NORTHBRIDGE_ORG_ID = "a0000000-0000-0000-0000-000000000001";

/**
 * The one client row this file ever creates, in the reserved `7c…` range
 * `scripts/verify-tracker-live.mjs:55-60` established for fixture rows that a
 * later run has to be able to find without having recorded anything.
 */
const FIXTURE_CLIENT_ID = "7c110000-0000-4000-8000-000000000001";
const FIXTURE_CLIENT_NAME = "Applications E2E Fixture";

const APPROVED_AMOUNT_CENTS = 4_250_000;

const serverUp = await enrollmentServerUp();
const flagUp = featureFlag("FEATURE_APPLICATIONS");

// The re-drain in step 6 runs in this process rather than on the server, so the
// admin client has to be configured here too. Without it every assertion below
// fails for a reason that has nothing to do with the chain.
const adminConfigured =
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

const skip = !serverUp
  ? `no dev server on ${enrollmentBaseUrl} — run \`npm run dev -- -p 3003\``
  : !flagUp
    ? "FEATURE_APPLICATIONS must be set for this process and for the server"
    : !adminConfigured
      ? "the local Supabase URL and service role key must be set for this process"
      : false;

// ---------------------------------------------------------------------------
// A loosely typed handle on this phase's tables
// ---------------------------------------------------------------------------

/**
 * Phase 11's nine tables are not in `src/lib/db/types.ts`.
 *
 * Regenerating that file against the shared local stack would pull in three
 * sibling phases' tables alongside this phase's, which is exactly the diff the
 * worktree protocol says not to commit, so the generated types stay as Phase 7
 * left them and the integrator regenerates once at merge. `repository.ts:54-77`
 * has the same problem and answers it the same way — a structural interface
 * naming only the query shapes it uses — so this file borrows that answer
 * rather than inventing a second one or reaching for `any`.
 */
type LooseRow = Record<string, unknown>;

interface LooseResult<Value> {
  data: Value | null;
  error: { message?: string } | null;
}

interface LooseFilter extends PromiseLike<LooseResult<LooseRow[]>> {
  eq(column: string, value: unknown): LooseFilter;
  maybeSingle(): PromiseLike<LooseResult<LooseRow>>;
}

interface LooseTable {
  select(columns: string): LooseFilter;
  insert(values: LooseRow): PromiseLike<LooseResult<LooseRow[]>>;
  upsert(values: LooseRow, options: { onConflict: string }): PromiseLike<LooseResult<LooseRow[]>>;
  delete(): { eq(column: string, value: unknown): PromiseLike<LooseResult<LooseRow[]>> };
}

interface LooseDb {
  from(table: string): LooseTable;
}

/**
 * The admin client, reached the way `src/lib/applications/repository.ts:37-40`
 * reaches it: inside the function that needs it, never at module scope.
 *
 * `scripts/verify-source-gates.mjs` explicitly names this local-only fixture
 * among the files allowed to obtain the admin client. Deferred and module-scope
 * imports are both checked, so this test cannot quietly widen that boundary.
 */
async function looseAdmin(): Promise<LooseDb> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient() as unknown as LooseDb;
}

/** Read one row and fail with the caller's sentence rather than a null dereference. */
async function readOne(
  table: string,
  columns: string,
  column: string,
  value: unknown,
  why: string,
): Promise<LooseRow> {
  const result = await (await looseAdmin())
    .from(table)
    .select(columns)
    .eq(column, value)
    .maybeSingle();
  assert.equal(result.error, null, `${why} — the read itself failed`);
  assert.notEqual(result.data, null, why);
  return result.data as LooseRow;
}

function num(row: LooseRow, key: string): number {
  const value = row[key];
  assert.equal(typeof value, "number", `${key} is not a number`);
  return value as number;
}

// ---------------------------------------------------------------------------
// The HTTP surface
// ---------------------------------------------------------------------------

interface ApiResult<T> {
  status: number;
  body: T;
}

async function call<T>(
  method: "GET" | "POST" | "PATCH",
  path: string,
  actorId: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  const target = new URL(path, enrollmentBaseUrl);
  const response = await fetch(target, {
    method,
    headers: {
      "content-type": "application/json",
      ...(!["GET", "HEAD"].includes(method) ? { origin: target.origin } : {}),
      "x-mf-demo-profile-id": actorId,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  // The body is parsed but never printed: a failure reports the status and the
  // error code, which is enough to diagnose and carries no row values (T-11-39).
  const parsed = (await response.json()) as T;
  return { status: response.status, body: parsed };
}

function errorCode(body: unknown): string {
  return typeof body === "object" && body !== null && "error" in body
    ? String((body as { error: unknown }).error)
    : "no error code";
}

/**
 * Create the reserved fixture client, or leave the one an earlier run created.
 *
 * There is no upsert here on purpose: the row carries nothing a later run needs
 * to refresh, and an update would be a write to a table this phase does not own
 * for no gain.
 */
async function ensureFixtureClient(): Promise<void> {
  const existing = await (await looseAdmin())
    .from("clients")
    .select("id")
    .eq("id", FIXTURE_CLIENT_ID)
    .maybeSingle();
  assert.equal(existing.error, null, "the fixture client could not be read");
  if (existing.data !== null) return;

  const created = await (await looseAdmin()).from("clients").insert({
    id: FIXTURE_CLIENT_ID,
    org_id: NORTHBRIDGE_ORG_ID,
    display_name: FIXTURE_CLIENT_NAME,
  });
  assert.equal(created.error, null, "the fixture client could not be created");
}

/**
 * Drain until this process claims nothing.
 *
 * `claim_outcome_refresh_job` takes the oldest queued row for any bank, so a
 * job left behind by an earlier run can be claimed first. Looping until a pass
 * claims nothing is what makes the assertion about this run's bank rather than
 * about whichever job happened to be at the front of the queue.
 */
async function drainUntilQuiet(): Promise<void> {
  for (let pass = 0; pass < 5; pass += 1) {
    const drained = await drainOutcomeRefreshJobs(undefined, { maxIterations: 10 });
    if (drained.claimed === 0) return;
  }
}

describe("applications live chain — both ROADMAP criteria over HTTP", { skip }, () => {
  it("creates, attests, records, reviews, and recomputes exactly once per change", async () => {
    await ensureFixtureClient();

    // A lender handle nothing else uses, so this run's aggregate is its own and
    // a concurrent worktree's outcomes cannot move the version being watched.
    const bankRef = `e2e-bank-${randomUUID().slice(0, 8)}`;
    let outcomeId: string | undefined;

    // Phase 8, migration 383: `applications.bank_ref` references
    // `public.banks_cache`, so this run's private lender needs a catalog row
    // before the application can be filed. Unpublished, so it stays out of
    // `/api/banks` while still satisfying the key.
    await (await looseAdmin()).from("banks_cache").upsert(
      {
        bank_ref: bankRef,
        name: bankRef,
        application_questions: JSON.parse('[{"id":"a","label":"A","responseBasis":"x"},{"id":"b","label":"B","responseBasis":"x"},{"id":"c","label":"C","responseBasis":"x"},{"id":"d","label":"D","responseBasis":"x"}]'),
        is_active: false,
        source: "fixture",
      },
      { onConflict: "bank_ref" },
    );

    try {
      // --- 1. APPS-01: the application opens on the schema's own defaults ----
      const created = await call<{
        application: {
          id: string;
          operatorStatus: string;
          consumerStatus: string;
          visibility: string;
          amountCents: number | null;
        };
        stage: string;
      }>("POST", "/api/applications", OPERATOR_ID, {
        clientId: FIXTURE_CLIENT_ID,
        bankRef,
      });
      assert.equal(
        created.status,
        201,
        `create returned ${created.status} (${errorCode(created.body)})`,
      );
      const applicationId = created.body.application.id;
      assert.equal(created.body.application.operatorStatus, "wait");
      assert.equal(created.body.application.consumerStatus, "pending");
      assert.equal(created.body.application.visibility, "inherit");
      // The stage seam is best effort and this fixture sits at `onboarding`, so
      // the tracker's precondition does not hold and the move is reported
      // rather than forced (G-11-06). What matters is that the application
      // exists either way.
      assert.ok(
        ["transitioned", "skipped", "unavailable"].includes(created.body.stage),
        `unexpected stage result ${created.body.stage}`,
      );

      // --- 2. APPS-01: the attestation, in both directions -------------------
      const unattested = await call<unknown>(
        "POST",
        `/api/applications/${applicationId}/notes`,
        OPERATOR_ID,
        { body: "Called the lender for an update.", attested: false },
      );
      assert.equal(unattested.status, 400, "an unattested operator note was accepted");
      assert.equal(errorCode(unattested.body), "attestation_required");

      const attested = await call<{ note: { attested: boolean } }>(
        "POST",
        `/api/applications/${applicationId}/notes`,
        OPERATOR_ID,
        { body: "Called the lender for an update.", attested: true },
      );
      assert.equal(
        attested.status,
        201,
        `note returned ${attested.status} (${errorCode(attested.body)})`,
      );
      assert.equal(attested.body.note.attested, true);

      // --- 3. APPS-02: it counts on entry, and its review opens pending ------
      const recorded = await call<{
        outcome: { id: string; state: string; kind: string };
        review: { state: string } | null;
      }>("POST", `/api/applications/${applicationId}/outcomes`, OPERATOR_ID, {
        kind: "approved",
        amountCents: APPROVED_AMOUNT_CENTS,
      });
      assert.equal(
        recorded.status,
        201,
        `outcome returned ${recorded.status} (${errorCode(recorded.body)})`,
      );
      outcomeId = recorded.body.outcome.id;
      assert.equal(
        recorded.body.outcome.state,
        "counted",
        "the outcome did not count on entry — APPS-02 is not holding",
      );
      assert.equal(recorded.body.review?.state, "pending");

      // --- 4. Criterion 1: the inline drain already ran ----------------------
      // No explicit drain here, and that absence is the assertion. The route
      // drains its own bank's job before it answers, so a stats row exists by
      // the time this read lands. Nothing in this repository schedules a worker
      // (G-11-07), so without that inline call this would 404.
      const afterOutcome = await call<{
        stats: { statsVersion: number; outcomeCountTotal: number; heatLevel: string };
      }>("GET", `/api/outcomes?bankRef=${bankRef}`, OPERATOR_ID);
      assert.equal(
        afterOutcome.status,
        200,
        `stats returned ${afterOutcome.status} (${errorCode(afterOutcome.body)}) — the inline drain did not run`,
      );
      const versionAfterOutcome = afterOutcome.body.stats.statsVersion;
      assert.equal(afterOutcome.body.stats.outcomeCountTotal, 1);

      const indexAfterOutcome = await readOne(
        "bank_retrieval_index",
        "stats_version, rebuilt_at, document_fingerprint",
        "bank_ref",
        bankRef,
        "the retrieval index was not written",
      );
      assert.equal(
        indexAfterOutcome.stats_version,
        versionAfterOutcome,
        "the aggregate and the index disagree — APPS-04's both-or-neither is not holding",
      );
      const rebuiltAfterOutcome = indexAfterOutcome.rebuilt_at;
      const fingerprintAfterOutcome = indexAfterOutcome.document_fingerprint;

      // --- 5. APPS-03: the approval stages the write-back, honestly worded ---
      const approved = await call<{
        result: string;
        reviewState: string;
        outboxState: string | null;
        notified: boolean;
        message: string;
      }>("POST", `/api/outcomes/${outcomeId}/review`, PLATFORM_ADMIN_ID, {
        decision: "approved",
      });
      assert.equal(
        approved.status,
        200,
        `review returned ${approved.status} (${errorCode(approved.body)})`,
      );
      assert.equal(approved.body.result, "decided");
      assert.equal(approved.body.reviewState, "approved");
      assert.equal(
        approved.body.outboxState,
        "recorded",
        "the fixture driver reported something other than recorded",
      );
      assert.equal(approved.body.message, "Recorded for the funding brain.");
      // The pass-3 claim, checked at runtime rather than only by grep. Both
      // words are assembled so this file is not its own first finding in the
      // repository's plain-text copy gates.
      const overclaim = new RegExp(`${"sen"}t|${"sync"}ed`, "i");
      assert.equal(
        overclaim.test(JSON.stringify(approved.body)),
        false,
        "the review response claims a delivery the fixture driver never made",
      );

      const outbox = await readOne(
        "vault_writeback_outbox",
        "source, state, target",
        "outcome_id",
        outcomeId,
        "the approval staged no outbox row",
      );
      assert.equal(outbox.source, "mostfundable", "APPS-03's attribution is missing");
      assert.equal(outbox.state, "recorded");

      const notifications = await (await looseAdmin())
        .from("outcome_notifications")
        .select("kind")
        .eq("outcome_id", outcomeId);
      assert.equal(notifications.error, null);
      assert.equal(
        notifications.data?.length,
        1,
        "the approval did not notify the operator exactly once",
      );
      assert.equal(notifications.data?.[0]?.kind, "outcome_review_approved");

      // --- 6. Criterion 1's idempotency: a re-drain with no data change ------
      // A genuine second run over unchanged data, not a repeat of the chain.
      // The recompute fingerprints the document it built and writes nothing when
      // the fingerprint matches, so the version stops drifting and a downstream
      // reader cannot mistake a re-run for a change.
      await supabaseApplicationsRepository.enqueueRefreshJob(bankRef, randomUUID());
      await drainUntilQuiet();

      const afterRedrain = await readOne(
        "bank_outcome_stats",
        "stats_version, computed_at",
        "bank_ref",
        bankRef,
        "the aggregate disappeared during the re-drain",
      );
      assert.equal(
        afterRedrain.stats_version,
        versionAfterOutcome,
        "a re-drain over unchanged data advanced stats_version",
      );

      const indexAfterRedrain = await readOne(
        "bank_retrieval_index",
        "stats_version, rebuilt_at, document_fingerprint",
        "bank_ref",
        bankRef,
        "the retrieval index disappeared during the re-drain",
      );
      assert.equal(
        indexAfterRedrain.rebuilt_at,
        rebuiltAfterOutcome,
        "a re-drain over unchanged data rewrote the retrieval index",
      );
      assert.equal(
        indexAfterRedrain.document_fingerprint,
        fingerprintAfterOutcome,
        "the same data produced a different fingerprint",
      );

      // --- 7. Criterion 1 and APPS-04: a correction does advance both --------
      // This is what stops an inert implementation passing step 6: if the
      // recompute never wrote anything at all, step 6 would pass and this fails.
      const corrected = await call<{
        result: string;
        reviewState: string;
        outboxState: string | null;
        message: string;
      }>("POST", `/api/outcomes/${outcomeId}/review`, PLATFORM_ADMIN_ID, {
        decision: "removed",
      });
      assert.equal(
        corrected.status,
        200,
        `correction returned ${corrected.status} (${errorCode(corrected.body)})`,
      );
      assert.equal(corrected.body.result, "decided");
      assert.equal(corrected.body.reviewState, "removed");
      // `review_outcome` drops a still-staged outbox row in the same
      // transaction, because nothing had left the system while it read
      // `recorded`.
      assert.equal(corrected.body.outboxState, null);

      // The review route drains inline too, so the recompute has already run.
      const afterCorrection = await call<{
        stats: { statsVersion: number; outcomeCountTotal: number };
      }>("GET", `/api/outcomes?bankRef=${bankRef}`, OPERATOR_ID);
      assert.equal(afterCorrection.status, 200);
      assert.ok(
        afterCorrection.body.stats.statsVersion > versionAfterOutcome,
        `stats_version did not advance after the correction (${afterCorrection.body.stats.statsVersion} vs ${versionAfterOutcome})`,
      );
      assert.equal(
        afterCorrection.body.stats.outcomeCountTotal,
        0,
        "a corrected outcome is still counted in the lender's totals",
      );

      const indexAfterCorrection = await readOne(
        "bank_retrieval_index",
        "stats_version, rebuilt_at",
        "bank_ref",
        bankRef,
        "the retrieval index disappeared after the correction",
      );
      assert.equal(
        num(indexAfterCorrection, "stats_version"),
        afterCorrection.body.stats.statsVersion,
        "the correction moved the aggregate without the index — APPS-04 is not holding",
      );
      assert.notEqual(
        indexAfterCorrection.rebuilt_at,
        rebuiltAfterOutcome,
        "the correction left the retrieval index untouched",
      );

      // A repeat of the decision already in force writes nothing and says so.
      const repeated = await call<unknown>(
        "POST",
        `/api/outcomes/${outcomeId}/review`,
        PLATFORM_ADMIN_ID,
        { decision: "removed" },
      );
      assert.equal(repeated.status, 409, "a repeated decision was applied again");
      assert.equal(errorCode(repeated.body), "conflict");
    } finally {
      // Deleting the outcome cascades its review, its staged write-back row and
      // its notifications. The per-lender aggregate and its queue are keyed on
      // the bank rather than on the outcome, so those three go by hand, and the
      // retrieval index goes before the aggregate it references.
      //
      // The application, its note and the reserved client deliberately stay.
      // See this file's header: both `application_notes` and `audit_log` are
      // append-only by design, so neither can be removed and neither parent can
      // be either.
      const admin = await looseAdmin();
      if (outcomeId !== undefined) {
        await admin.from("outcomes").delete().eq("id", outcomeId);
      }
      await admin.from("outcome_refresh_jobs").delete().eq("bank_ref", bankRef);
      await admin.from("bank_retrieval_index").delete().eq("bank_ref", bankRef);
      await admin.from("bank_outcome_stats").delete().eq("bank_ref", bankRef);
      // The catalog row stays. Migration 383's key is ON DELETE RESTRICT and
      // the application above is deliberately left behind, so a delete here
      // would be refused; the row is already unpublished, so it is invisible to
      // every read the product performs.
    }
  });
});
