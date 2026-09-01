import assert from "node:assert/strict";
import { test } from "node:test";

import { drainOutcomeRefreshJobs } from "@/lib/applications/worker";
import { runNotificationDispatch } from "@/lib/ancillary/notifications";
import { runUploadedReportPurge } from "@/lib/ancillary/purge";
import type { ApplicationsRepository, ApplicationsWorkerIdentity } from "@/lib/applications/ports";
import type { FailRefreshJobInput, OutcomeRefreshJob } from "@/lib/applications/types";
import { nextState } from "@/lib/enrollment/machine";
import type { MachineEffect, MachineEvent, MachineState } from "@/lib/enrollment/types";
import { IDV_LOCK_DURATION_HOURS } from "@/lib/idv/config";
import { validateJobTuple } from "@/lib/jobs/definitions";
import { createVaultReimportKbHandler } from "@/lib/kb/job";
import { createPaidRefresh } from "@/lib/pricing/paid-refresh";
import { createReferralService } from "@/lib/referrals/service";
import { runBillingAccrual } from "@/lib/revenue/accruals";

import { stateMachines } from "./acceptance-manifest.mjs";

const NOW = new Date("2026-08-16T12:00:00.000Z");
const EVENT_KINDS = [
  "idv_start",
  "idv_code_correct",
  "idv_code_wrong",
  "idv_answer_correct",
  "idv_answer_wrong",
  "cancel",
] as const;
type EventKind = (typeof EVENT_KINDS)[number];

const STATES: Record<string, MachineState> = {
  pending: { status: "enrolled", idvState: "pending", attemptsUsed: 0, maxAttempts: 2, subscriptionSettled: false },
  sms_sent: { status: "enrolled", idvState: "sms_sent", attemptsUsed: 0, maxAttempts: 2, subscriptionSettled: false },
  quiz: { status: "enrolled", idvState: "quiz", attemptsUsed: 0, maxAttempts: 2, subscriptionSettled: false },
  retry: { status: "enrolled", idvState: "retry", attemptsUsed: 1, maxAttempts: 2, subscriptionSettled: false },
  passed: { status: "active", idvState: "passed", attemptsUsed: 0, maxAttempts: 2, subscriptionSettled: true },
  locked: { status: "parked", idvState: "locked", attemptsUsed: 2, maxAttempts: 2, subscriptionSettled: false },
};

function event(kind: EventKind): MachineEvent {
  return { kind } as MachineEvent;
}

function expected(state: MachineState, kind: EventKind) {
  if (kind === "cancel") {
    return { next: { ...state, status: "cancelled" as const }, effects: [{ kind: "cancel_subscription" }] as MachineEffect[] };
  }
  if (state.idvState === "passed" || state.idvState === "locked") return { next: state, effects: [] };
  if (state.idvState === "pending" && kind === "idv_start") {
    return { next: { ...state, idvState: "sms_sent" as const }, effects: [{ kind: "start_idv" }] as MachineEffect[] };
  }
  if (state.idvState === "sms_sent" && kind === "idv_code_correct") return pass(state);
  if (state.idvState === "sms_sent" && kind === "idv_code_wrong") {
    return {
      next: { ...state, idvState: "quiz" as const },
      effects: [{ kind: "settle_idv", outcome: "retry", nextState: "quiz" }] as MachineEffect[],
    };
  }
  if ((state.idvState === "quiz" || state.idvState === "retry") && kind === "idv_answer_correct") return pass(state);
  if ((state.idvState === "quiz" || state.idvState === "retry") && kind === "idv_answer_wrong") {
    const attemptsUsed = state.attemptsUsed + 1;
    if (attemptsUsed < state.maxAttempts) {
      return {
        next: { ...state, attemptsUsed, idvState: "retry" as const },
        effects: [{ kind: "settle_idv", outcome: "retry", nextState: "retry" }] as MachineEffect[],
      };
    }
    const until = new Date(NOW.getTime() + IDV_LOCK_DURATION_HOURS * 60 * 60 * 1_000).toISOString();
    return {
      next: { ...state, attemptsUsed, idvState: "locked" as const, status: "parked" as const },
      effects: [{ kind: "park", until }] as MachineEffect[],
    };
  }
  return { next: state, effects: [] };
}

function pass(state: MachineState) {
  const effects: MachineEffect[] = [{ kind: "activate" }];
  if (!state.subscriptionSettled) effects.push({ kind: "start_subscription" });
  return { next: { ...state, idvState: "passed" as const, status: "active" as const }, effects };
}

const enrollmentManifest = stateMachines.find(({ id }) => id === "enrollment");
assert.ok(enrollmentManifest?.states && enrollmentManifest.events);

for (const stateName of enrollmentManifest.states) {
  for (const eventKind of enrollmentManifest.events) {
    test(`enrollment Cartesian edge ${stateName} × ${eventKind}`, () => {
      const state = STATES[stateName];
      assert.ok(state, `missing state fixture for ${stateName}`);
      assert.ok((EVENT_KINDS as readonly string[]).includes(eventKind), `unknown event ${eventKind}`);
      const typedEvent = eventKind as EventKind;
      assert.deepEqual(nextState(state, event(typedEvent), NOW), expected(state, typedEvent));
    });
  }
}

test("subscription-settled pass activates without a second subscription effect", () => {
  const state = { ...STATES.sms_sent!, subscriptionSettled: true };
  assert.deepEqual(nextState(state, { kind: "idv_code_correct" }, NOW).effects, [{ kind: "activate" }]);
});

test("every manifest edge ID is accounted for by the hardening case register", () => {
  const declared = stateMachines.flatMap(({ legalCases, illegalCases }) => [...legalCases, ...illegalCases]).sort();
  const registered = new Set([
    "consent-grant", "consent-revoke-latest", "consent-revoke-replay", "cancel-first-call",
    "cancel-replay", "cancel-subscription-effect", "purge-after-due", "purge-retry-terminal",
    "consent-cross-tenant", "consent-stale-authority", "cancel-unauthorized-actor", "purge-before-due",
    "purge-cross-tenant", "pending-idv-start", "sms-code-pass", "sms-code-to-quiz", "quiz-answer-pass",
    "retry-answer-lock", "cancel-precedence", "terminal-event-stable", "wrong-event-stable", "stale-rpc-call",
    "paid-current", "failed-past-due", "retry-exhausted-grace", "deleted-deactivated", "duplicate-event",
    "stale-event", "unknown-status", "empty-queue", "bounded-success", "retry", "attempts-exhausted",
    "lease-lost", "invalid-iterations", "wrong-worker",
  ]);
  assert.deepEqual([...registered].sort(), declared);
});

const WORKER: ApplicationsWorkerIdentity = { workerId: () => "hardening-worker" };

function refreshJob(id: string, attemptCount = 0): OutcomeRefreshJob {
  return {
    id,
    bankRef: "hardening-bank",
    changeId: `change-${id}`,
    subject: "bank:hardening-bank",
    window: `change:change-${id}`,
    idempotencyKey: `outcomes.refresh_stats|bank:hardening-bank|change:change-${id}`,
    status: "queued",
    attemptCount,
    errorCode: null,
  };
}

function queueRepository(input: {
  jobs: OutcomeRefreshJob[];
  failing?: Set<string>;
  failLease?: boolean;
  requeue?: boolean;
}) {
  const jobs = [...input.jobs];
  const failures: FailRefreshJobInput[] = [];
  const calls: string[] = [];
  const forbidden = (name: string): never => { throw new Error(`unexpected repository call: ${name}`); };
  const repository: ApplicationsRepository = {
    listApplications: () => forbidden("listApplications"), readApplication: () => forbidden("readApplication"),
    createApplication: () => forbidden("createApplication"), updateApplication: () => forbidden("updateApplication"),
    listNotes: () => forbidden("listNotes"), addNote: () => forbidden("addNote"),
    recordOutcome: () => forbidden("recordOutcome"), readOutcome: () => forbidden("readOutcome"),
    listOutcomes: () => forbidden("listOutcomes"), readReview: () => forbidden("readReview"),
    listReviews: () => forbidden("listReviews"), listPendingReviews: () => forbidden("listPendingReviews"),
    reviewOutcome: () => forbidden("reviewOutcome"), readBankStats: () => forbidden("readBankStats"),
    listBankStats: () => forbidden("listBankStats"), listNotifications: () => forbidden("listNotifications"),
    enqueueRefreshJob: () => forbidden("enqueueRefreshJob"), listWritebackOutbox: () => forbidden("listWritebackOutbox"),
    readWriteback: () => forbidden("readWriteback"), markWriteback: () => forbidden("markWriteback"),
    async claimRefreshJob() {
      calls.push("claim");
      const next = jobs.shift();
      return next ? { ...next, status: "running", attemptCount: next.attemptCount + 1 } : null;
    },
    async runRefreshJob(jobId) {
      calls.push(`run:${jobId}`);
      if (input.failing?.has(jobId)) throw new Error("synthetic failure");
      return { ...refreshJob(jobId), status: "succeeded" };
    },
    async failRefreshJob(value) {
      calls.push(`fail:${value.jobId}`);
      failures.push(value);
      if (input.failLease) throw new Error("synthetic lease loss");
      if (input.requeue && value.retry) jobs.push(refreshJob(value.jobId, 1));
      return { ...refreshJob(value.jobId), status: value.retry ? "queued" : "failed" };
    },
  };
  return { repository, failures, calls };
}

test("outcome recompute: empty and bounded-success queues report exact counts", async () => {
  const empty = queueRepository({ jobs: [] });
  assert.deepEqual(await drainOutcomeRefreshJobs({ repository: empty.repository, identity: WORKER }, { maxIterations: 5 }), { claimed: 0, succeeded: 0, failed: 0 });
  const full = queueRepository({ jobs: [refreshJob("one"), refreshJob("two")] });
  assert.deepEqual(await drainOutcomeRefreshJobs({ repository: full.repository, identity: WORKER }, { maxIterations: 5 }), { claimed: 2, succeeded: 2, failed: 0 });
});

test("outcome recompute: mixed failure schedules retry with exact bounded inputs", async () => {
  const queue = queueRepository({ jobs: [refreshJob("good"), refreshJob("bad")], failing: new Set(["bad"]) });
  assert.deepEqual(await drainOutcomeRefreshJobs(
    { repository: queue.repository, identity: WORKER },
    { maxIterations: 5, retryAfterSeconds: 7, maxAttempts: 3 },
  ), { claimed: 2, succeeded: 1, failed: 1 });
  assert.deepEqual(queue.failures, [{ jobId: "bad", workerId: "hardening-worker", errorCode: "worker_failed", retry: true, retryAfterSeconds: 7 }]);
});

test("outcome recompute: maximum attempt is terminal and lease loss stays bounded", async () => {
  const terminal = queueRepository({ jobs: [refreshJob("spent", 2)], failing: new Set(["spent"]) });
  await drainOutcomeRefreshJobs({ repository: terminal.repository, identity: WORKER }, { maxIterations: 2, maxAttempts: 3 });
  assert.equal(terminal.failures[0]?.retry, false);

  const leaseLost = queueRepository({ jobs: [refreshJob("lost"), refreshJob("next")], failing: new Set(["lost"]), failLease: true });
  assert.deepEqual(await drainOutcomeRefreshJobs({ repository: leaseLost.repository, identity: WORKER }, { maxIterations: 4 }), { claimed: 2, succeeded: 1, failed: 1 });
});

test("outcome recompute: iteration ceiling stops a repeatedly queued failure", async () => {
  const queue = queueRepository({ jobs: [refreshJob("repeat")], failing: new Set(["repeat"]), requeue: true });
  assert.deepEqual(await drainOutcomeRefreshJobs(
    { repository: queue.repository, identity: WORKER },
    { maxIterations: 3, maxAttempts: 100 },
  ), { claimed: 3, succeeded: 0, failed: 3 });
  assert.equal(queue.calls.filter((call) => call === "claim").length, 3);
});

test("outcome recompute: invalid iteration bounds fail before a claim", async () => {
  for (const maxIterations of [-1, 1.5]) {
    const queue = queueRepository({ jobs: [refreshJob("never")] });
    await assert.rejects(drainOutcomeRefreshJobs(
      { repository: queue.repository, identity: WORKER },
      { maxIterations },
    ));
    assert.deepEqual(queue.calls, []);
  }
});

test("merged late seams reject illegal transitions through their exported boundaries", async () => {
  const platformOrgId = "19000000-0000-4000-8000-000000000001";
  const actorId = "19000000-0000-4000-8000-000000000002";
  const clientId = "19000000-0000-4000-8000-000000000003";
  const referral = createReferralService({
    async platformOrgIsMarked() { return true; },
    async resolveSourceClient() { return { clientId, orgId: actorId }; },
    async createReferral() { throw new Error("unexpected create"); },
    async markClicked() { throw new Error("unexpected click"); },
    async markConverted() { throw new Error("unexpected conversion"); },
    async readEvidence() { return null; },
  }, {
    FEATURE_REFERRALS: "true",
    REFERRAL_PLATFORM_ORG_ID: platformOrgId,
    REFERRAL_INTAKE_ORIGIN: "https://example.test",
  });

  const kb = createVaultReimportKbHandler({
    createSource() { throw new Error("unexpected source"); },
    createEmbedding() { throw new Error("unexpected embedding"); },
    createRepository() { throw new Error("unexpected repository"); },
  });

  const cases: Array<{ name: string; run: () => Promise<unknown>; expected: unknown }> = [
    { name: "revenue invalid subject", run: () => runBillingAccrual("global", "2026-08"), expected: { status: "failed" } },
    { name: "referral invalid token", run: () => referral.resolveConsumerReferral("invalid"), expected: "invalid_token" },
    // G-KB-01 made the KB job name its refusal: the tuple guard's closed domain
    // code now rides the result so the reimport route and job log can show it.
    { name: "KB invalid window", run: () => kb("global", "2026-8"), expected: { code: "KB_JOB_TUPLE_INVALID", rows: 0, status: "failed" } },
    { name: "notification invalid tuple", run: () => runNotificationDispatch("bad", "bad", {} as never), expected: { status: "failed" } },
    { name: "upload purge invalid tuple", run: () => runUploadedReportPurge("bad", "2026-08-16", { repository: {} as never }), expected: { status: "failed" } },
    {
      name: "paid refresh disabled before persistence",
      run: () => createPaidRefresh(
        { actorId, clientId, expectedAmountCents: 1_900, idempotencyKey: "hardening-late" },
        { env: {} },
      ),
      expected: { ok: false, reason: "dependency_disabled", requestId: null },
    },
  ];

  for (const row of cases) {
    if (row.name === "referral invalid token") {
      await assert.rejects(row.run, (error: unknown) => (
        error instanceof Error && "code" in error && error.code === row.expected
      ));
    } else {
      assert.deepEqual(await row.run(), row.expected, row.name);
    }
  }

  assert.throws(
    () => validateJobTuple({ job: "crs.alert_batch", subject: "org:not-a-uuid", window: "2026-08-16" }),
    /JOB_TUPLE_INVALID/,
  );
});
