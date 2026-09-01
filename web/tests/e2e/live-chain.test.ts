/**
 * The in-runner twin of `scripts/verify-tracker-live.mjs`.
 *
 * The script and this file cover the same chain and deliberately do not cover it the same way. The
 * script owns the child-server lifecycle, the psql read-back and a cleanup contract strict enough to
 * assert a zero row count afterwards; it is the artifact somebody runs once, by hand, with a human
 * looking at the surface in between its two modes. This file owns fast regression coverage inside
 * `npm run test:e2e`, so that a later change breaking the enrollment → tracker → queue → tracker
 * chain fails the standard gate rather than waiting for somebody to remember the script.
 *
 * Reads go through the admin client rather than through the enrollment repository's e2e evidence
 * helper, because that helper reports enrollment evidence and this file's subject is the tracker
 * rows — `clients.stage`, `stage_history`, `tracker_transition_receipts` — which it does not expose.
 * Widening it would mean editing lane B's repository, which this plan does not own.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";


import { noopAnalysisStageTracker } from "@/lib/analysis/ports";
import { drainAnalysisQueue, enqueueAnalysisRun } from "@/lib/analysis/worker";
import { featureFlag } from "@/lib/env";
import { MOCK_SMS_CODE } from "@/lib/idv/config";
import type { Database } from "@/lib/db/types";
import { createAdminClient } from "@/lib/supabase/admin";

import {
  enrollmentBaseUrl,
  enrollmentBody,
  enrollmentServerUp,
  postEnrollment,
  provisionConsumer,
} from "./support";

/** The seeded Northbridge persona whose plan ROADMAP Phase 5 criterion 1 names. */
const DEROG_CLIENT_ID = "a3000000-0000-0000-0000-000000000002";
const DEROG_ENROLLMENT_ID = "a5000000-0000-0000-0000-000000000002";

type QueueRow = Pick<
  Database["public"]["Tables"]["analysis_jobs"]["Row"],
  "analysis_run_id" | "error_code" | "id" | "status"
>;

interface PlanChild {
  accountRef?: unknown;
  observedUtilizationPct?: unknown;
}

interface PlanChecklistEntry {
  children?: PlanChild[];
}

const serverUp = await enrollmentServerUp();
const flagsUp = featureFlag("FEATURE_ANALYSIS") && featureFlag("FEATURE_TRACKER");

// The queue is drained in this process, not on the server, so both flags have to be set here as
// well as there. Without them `drainAnalysisQueue` returns zero claims and every assertion below
// fails for a reason that has nothing to do with the chain.
const skip = !serverUp
  ? `no dev server on ${enrollmentBaseUrl} — run \`npm run dev -- -p 3003\``
  : !flagsUp
    ? "FEATURE_ANALYSIS and FEATURE_TRACKER must be set for this process — the queue drains here"
    : false;

describe("live chain — enrollment and analysis both reach the tracker", { skip }, () => {
  it("advances the client once, records both receipts, and does not restart the timer", async () => {
    const admin = createAdminClient();
    const clientId = randomUUID();
    const name = "Live Chain E2E";
    const email = `live-chain-${clientId}@example.invalid`;
    const { actorId } = await provisionConsumer({ clientId, email, fullName: name });

    const started = await postEnrollment(
      "/api/enroll",
      actorId,
      enrollmentBody({ draftId: randomUUID(), email, name }),
    );
    const active = await postEnrollment(
      `/api/enrollments/${started.enrollmentId}/idv`,
      actorId,
      { code: MOCK_SMS_CODE, kind: "sms" },
    );
    assert.equal(active.status, "active");

    // The enrollment half of the chain, read back rather than inferred from the 200 above.
    const afterEnrollment = await admin
      .from("clients")
      .select("stage, stage_entered_at")
      .eq("id", clientId)
      .single();
    assert.equal(afterEnrollment.error, null);
    assert.equal(
      afterEnrollment.data?.stage,
      "optimization",
      "activation did not reach the tracker transition",
    );
    const enteredAfterEnrollment = afterEnrollment.data?.stage_entered_at;

    const pending = createAdminClient();
    const queued = await pending
      .from("analysis_jobs")
      .select("id, analysis_run_id, status, error_code")
      .eq("client_id", clientId);
    assert.equal(queued.error, null);
    assert.equal(queued.data?.length, 1, "activation did not enqueue exactly one analysis job");

    // Other e2e files run in parallel and can have queued jobs of their own, so the drain is
    // repeated until this client's job is terminal rather than trusting one pass to be enough.
    let job: QueueRow | undefined = queued.data?.[0];
    for (let attempt = 0; attempt < 3 && job?.status !== "succeeded"; attempt += 1) {
      await drainAnalysisQueue({ maxJobs: 10, workerId: randomUUID() });
      const reread = await pending
        .from("analysis_jobs")
        .select("id, analysis_run_id, status, error_code")
        .eq("client_id", clientId)
        .single();
      job = reread.data ?? undefined;
    }
    assert.equal(job?.status, "succeeded", "the analysis job did not succeed");
    const analysisRunId = job?.analysis_run_id;
    assert.ok(analysisRunId, "the succeeded job carries no analysis run id");

    // Two causes, one transition. The second event must not add a row or move the timer, because
    // the stage timer the operator surface counts from is `clients.stage_entered_at`.
    //
    // The literal receipt keys are NOT asserted here, and that is a privilege boundary rather than
    // an oversight. `tracker_transition_receipts` is written only by the security-definer transition
    // RPC and carries no SELECT grant for `service_role`, so the admin client this file uses cannot
    // read it — correctly, since no application code should. `scripts/verify-tracker-live.mjs` reads
    // the table over psql as `postgres` and asserts both keys as literal strings. What this file can
    // prove is the behaviour those receipts exist to produce, which is everything below.
    const history = await admin
      .from("stage_history")
      .select("from_stage, to_stage, changed_at")
      .eq("client_id", clientId);
    assert.equal(history.error, null);
    assert.equal(history.data?.length, 1, "expected exactly one stage_history row after both events");
    assert.equal(history.data?.[0]?.from_stage, "onboarding");
    assert.equal(history.data?.[0]?.to_stage, "optimization");

    const audits = await admin
      .from("audit_log")
      .select("occurred_at")
      .eq("client_id", clientId)
      .eq("action", "client.stage.transitioned");
    assert.equal(audits.error, null);
    assert.equal(audits.data?.length, 1, "expected exactly one transition audit_log row");

    const settled = await admin
      .from("clients")
      .select("stage, stage_entered_at")
      .eq("id", clientId)
      .single();
    assert.equal(settled.error, null);
    assert.equal(settled.data?.stage, "optimization");
    assert.equal(
      settled.data?.stage_entered_at,
      enteredAfterEnrollment,
      "the analysis event moved stage_entered_at — the stage timer restarted",
    );
    assert.equal(history.data?.[0]?.changed_at, settled.data?.stage_entered_at);
    assert.equal(audits.data?.[0]?.occurred_at, settled.data?.stage_entered_at);

    // ROADMAP Phase 5 criterion 5, scoped to this client. The standalone verifier owns the stricter
    // form — a second drain that claims zero jobs outright — because it runs alone against a server
    // it started; in here another suite's queued job would make a global count flaky, and the
    // durable claim that matters is that replaying the drain produces no second run and no second
    // receipt for a client that already has one.
    await drainAnalysisQueue({ maxJobs: 10, workerId: randomUUID() });
    const replayed = await admin
      .from("analysis_runs")
      .select("id, readiness_score")
      .eq("client_id", clientId);
    assert.equal(replayed.error, null);
    assert.equal(replayed.data?.length, 1, "a replayed drain produced a second analysis run");
    const replayedHistory = await admin
      .from("stage_history")
      .select("id")
      .eq("client_id", clientId);
    assert.equal(replayedHistory.error, null);
    assert.equal(replayedHistory.data?.length, 1, "a replayed drain produced a second transition");
    const replayedJob = await pending
      .from("analysis_jobs")
      .select("status, attempt_count")
      .eq("client_id", clientId)
      .single();
    assert.equal(replayedJob.error, null);
    assert.equal(replayedJob.data?.status, "succeeded");
    assert.equal(replayedJob.data?.attempt_count, 1, "a replayed drain re-claimed a finished job");
  });

  it("gives the seeded higher-risk persona a plan with per-account utilization subtasks", async () => {
    const admin = createAdminClient();

    // ROADMAP Phase 5 criterion 1, on the seeded row rather than on a fixture built here, so the
    // seed's own member reference is part of what is proved. The tracker is stubbed out for this
    // one run: the criterion is about the plan, and letting the real adapter fire would move a
    // seeded client's stage and leave the demo data in a state this test then had to repair.
    const job = await enqueueAnalysisRun(
      {
        clientId: DEROG_CLIENT_ID,
        sourceKind: "enrollment",
        sourceId: DEROG_ENROLLMENT_ID,
        trigger: "scheduled",
      },
      { tracker: noopAnalysisStageTracker },
    );
    assert.ok(job, "the seeded persona could not be enqueued");

    try {
      const drain = await drainAnalysisQueue(
        { maxJobs: 1, workerId: randomUUID() },
        { tracker: noopAnalysisStageTracker },
      );
      assert.equal(drain.succeeded, 1, "the seeded persona did not complete a run");

      const run = await admin
        .from("analysis_runs")
        .select("readiness_score")
        .eq("id", job.analysisRunId)
        .single();
      const plan = await admin
        .from("plans")
        .select("body, readiness_score")
        .eq("analysis_run_id", job.analysisRunId)
        .single();
      assert.equal(plan.error, null, "the seeded persona produced no plan");

      const readiness = run.data?.readiness_score ?? 100;
      const checklist =
        ((plan.data?.body as { personalChecklist?: PlanChecklistEntry[] } | null)
          ?.personalChecklist ?? []);
      const perAccount = checklist
        .flatMap((entry) => entry.children ?? [])
        .filter(
          (child) =>
            typeof child.accountRef === "string" &&
            typeof child.observedUtilizationPct === "number",
        );

      // The exact number is recorded, never asserted. Phase 5 measured 33; pinning that here would
      // make an unrelated tweak to a mock fixture fail the demo gate for no correctness reason.
      console.log(
        `seeded higher-risk persona: readiness ${readiness}, ${perAccount.length} per-account subtasks ` +
          `(${perAccount.map((child) => `${String(child.accountRef)} ${String(child.observedUtilizationPct)}%`).join(", ")})`,
      );
      assert.ok(readiness < 100, `expected readiness below 100, got ${readiness}`);
      assert.ok(
        perAccount.length >= 2,
        `expected per-account utilization subtasks, got ${perAccount.length}`,
      );
    } finally {
      // The seeded client keeps exactly the run and plan the seed gave it. Deleting by the ids this
      // test created rather than by client keeps the seeded row untouched even if an assertion
      // above threw partway through.
      await admin.from("plans").delete().eq("analysis_run_id", job.analysisRunId);
      await admin.from("analysis_runs").delete().eq("id", job.analysisRunId);
      await createAdminClient().from("analysis_jobs").delete().eq("id", job.id);
    }
  });
});
