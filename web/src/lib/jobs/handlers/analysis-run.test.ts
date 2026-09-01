import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createFixedClock } from "@/lib/crs/ports";
import { createMockAdapter } from "@/lib/crs/mock/driver";
import { deriveReadinessPlan } from "@/lib/llm/mock-driver";
import { computeReadinessScore } from "@/lib/llm/evaluator";
import { runPlanEngine } from "@/lib/llm/engine";
import { extractFeatures } from "@/lib/analysis/features";
import { CRS_BUREAU_CODES, CRS_REPORT_CODE_BY_BUREAU } from "@/lib/crs/constants";
import { createInMemoryAnalysisRepository } from "@/lib/analysis/repository";
import { drainAnalysisQueue, enqueueAnalysisRun } from "@/lib/analysis/worker";
import { createAnalysisRunHandler } from "./analysis-run.ts";

import type { AnalysisJob } from "@/lib/analysis/ports";
import type { CrsMemberRef } from "@/lib/crs/types";
import type { PlanDriver } from "@/lib/llm/types";
import type { InMemoryAnalysisRepository } from "@/lib/analysis/repository";

const CLIENT_ID = "54000000-0000-4000-8000-000000000101";
const ENROLLMENT_ID = "54000000-0000-4000-8000-000000000201";
const ENABLED = { FEATURE_ANALYSIS: "true" };
const INSTANT = "2026-08-22T07:45:00.000Z";
const ALL_REPORT_CODES = CRS_BUREAU_CODES.map((bureau) => CRS_REPORT_CODE_BY_BUREAU[bureau]);
const WEBHOOK_CONFIG = {
  basicUser: null, basicPass: null, hmacSecret: null,
  hmacHeader: "x-crs-signature", sourceIps: [],
};

interface MutableClock {
  now(): Date;
  advance(milliseconds: number): void;
}

function mutableClock(): MutableClock {
  let current = Date.parse(INSTANT);
  return {
    now: () => new Date(current),
    advance(milliseconds) {
      current += milliseconds;
    },
  };
}

/**
 * A durable analysis job whose every stage attempt fails, wired to the real
 * worker so the statuses under test are the ones the worker actually writes
 * rather than a stubbed drain result. `getAdapter` throwing is the worker's
 * `configuration_error` path — the earliest one, so no fixture pull is needed.
 */
async function failingQueue(clock: MutableClock): Promise<{
  handler: ReturnType<typeof createAnalysisRunHandler>;
  repository: InMemoryAnalysisRepository;
  row(): AnalysisJob;
  subject: string;
  window: string;
}> {
  const repository = createInMemoryAnalysisRepository({
    clock: { now: () => clock.now() },
    enrollments: { [CLIENT_ID]: "mock_clean_000001" as CrsMemberRef },
  });
  const enqueued = await enqueueAnalysisRun(
    { clientId: CLIENT_ID, sourceKind: "enrollment", sourceId: ENROLLMENT_ID, trigger: "scheduled" },
    { env: ENABLED, repository },
  );
  assert.ok(enqueued);
  const overrides = {
    env: ENABLED,
    repository,
    getAdapter() {
      throw new Error("adapter unavailable in this test");
    },
  };
  return {
    handler: createAnalysisRunHandler((input) => drainAnalysisQueue(input, overrides)),
    repository,
    row: () => repository.readJobs()[0],
    subject: enqueued.subject,
    window: enqueued.window,
  };
}

/**
 * The same durable job, but reaching the plan stage: a real mock CRS adapter
 * supplies the pull so the only thing under test is what the plan driver does.
 */
async function planQueue(clock: MutableClock, driver: PlanDriver): Promise<{
  handler: ReturnType<typeof createAnalysisRunHandler>;
  row(): AnalysisJob;
  subject: string;
  window: string;
}> {
  const repository = createInMemoryAnalysisRepository({
    clock: { now: () => clock.now() },
    enrollments: { [CLIENT_ID]: "mock_clean_000001" as CrsMemberRef },
  });
  const enqueued = await enqueueAnalysisRun(
    { clientId: CLIENT_ID, sourceKind: "enrollment", sourceId: ENROLLMENT_ID, trigger: "scheduled" },
    { env: ENABLED, repository },
  );
  assert.ok(enqueued);
  const overrides = {
    env: ENABLED,
    repository,
    getAdapter: () => createMockAdapter({
      clock: createFixedClock(INSTANT),
      webhookConfig: WEBHOOK_CONFIG,
    }),
    getDriver: () => driver,
  };
  return {
    handler: createAnalysisRunHandler((input) => drainAnalysisQueue(input, overrides)),
    row: () => repository.readJobs()[0],
    subject: enqueued.subject,
    window: enqueued.window,
  };
}

describe("analysis.run job handler", () => {
  /**
   * The stage code the worker wrote to the durable row is the one the handler
   * reports, so a `handler_failed` line in the runtime log names the stage. The
   * expected value is read back off the row rather than written down here: the
   * assertion is that the two agree, which stays true when the stage set changes.
   *
   * Production, 2026-08-22: three ticks logged `[jobs] analysis.run attempt N
   * failed: handler_failed after …ms` with no detail at all, one of them 177ms
   * and another 150,495ms — the same line for two entirely different causes.
   */
  it("reports the stage code the worker persisted", async () => {
    const clock = mutableClock();
    const queue = await failingQueue(clock);

    const handled = await queue.handler(queue.subject, queue.window);

    assert.equal(handled.status, "failed");
    assert.equal(handled.code, queue.row().errorCode);
    assert.ok(handled.code, "a failure the log cannot explain is the defect");
  });

  /**
   * An inner job serving its own retry backoff has not failed — nothing ran. It
   * still reports `failed`, because that is the only result that leaves the outer
   * tuple runnable, but under a code that tells the two apart in a log.
   */
  it("distinguishes an unclaimable inner job from a stage failure", async () => {
    const clock = mutableClock();
    const queue = await failingQueue(clock);

    const failure = await queue.handler(queue.subject, queue.window);
    // No clock advance: the row is inside the retry backoff the line above set.
    const pending = await queue.handler(queue.subject, queue.window);

    assert.equal(queue.row().status, "queued");
    assert.equal(pending.status, "failed");
    assert.notEqual(pending.code, failure.code);
    assert.equal(
      queue.row().attemptCount,
      1,
      "a claim refused by the backoff must not spend an inner attempt",
    );
  });

  /**
   * Migration 389. `plan_rejected` used to mean either "the engine ran and refused
   * every candidate" or "the model call blew up", because the worker wrapped the
   * plan step in a blanket catch. Production read `error_code = plan_rejected` off
   * two stuck hosted jobs and that value settled nothing; which cause it was had
   * to be established by correlating against `eval_runs`.
   *
   * The sentinel is not transcribed. It is obtained by running the real
   * `runPlanEngine` and capturing what it throws — so if the engine ever raises
   * something else, this fails rather than quietly reclassifying every transport
   * fault as a rejection. That exact captured value is then what the worker is
   * asked to classify.
   *
   * Nor is the refusal hand-authored. With `PLAN_DRIVER` unset the mock driver is
   * `deriveReadinessPlan`, the real deterministic builder, and `evaluatePlan`
   * recomputes its way to agreement every time — so a candidate that fails the
   * evaluator has to be constructed, and constructing it by writing out a bad plan
   * is the round-5 rot shape: it passes today and stops meaning anything the moment
   * the schema gains a field. Instead the builder's own sound output is perturbed
   * in exactly the field `evaluatePlan` recomputes, by a value derived from
   * `computeReadinessScore(features)` at test time. The refusal is then guaranteed
   * by the evaluator's own `SCORE_VALUE` rule rather than by anything typed here.
   * The supervisor approves, which is also the shape production is in.
   */
  it("maps the engine's own rejection and a failed model call to different durable codes", async () => {
    const clock = mutableClock();
    const features = extractFeatures(
      await createMockAdapter({ clock: createFixedClock(INSTANT), webhookConfig: WEBHOOK_CONFIG })
        .softPull("mock_clean_000001" as CrsMemberRef, ALL_REPORT_CODES),
    );

    const expectedScore = computeReadinessScore(features);
    // Provably not what the evaluator will recompute, and still a schema-valid
    // integer, so `SCORE_VALUE` is what refuses it rather than `SCORE_SCHEMA`.
    const wrongScore = expectedScore === 100 ? expectedScore - 1 : expectedScore + 1;
    const refusing: PlanDriver = {
      driver: "mock",
      async generateCandidate(input, prompt) {
        return { ...deriveReadinessPlan(input, prompt), readinessScore: wrongScore };
      },
      supervise: async () => ({ approved: true, codes: [] }),
    };
    assert.notEqual(wrongScore, expectedScore, "the perturbation is derived, not assumed");

    const sentinel = await runPlanEngine(refusing, features, { env: ENABLED })
      .then(() => undefined, (error: unknown) => error);
    assert.ok(sentinel instanceof Error, "the engine signals a refusal by throwing");

    // The worker is handed that same thrown value, and separately a transport fault.
    const rejected = await planQueue(clock, {
      driver: "mock",
      generateCandidate: async () => { throw sentinel; },
      supervise: async () => ({ approved: true, codes: [] }),
    });
    const unavailable = await planQueue(clock, {
      driver: "mock",
      generateCandidate: async () => { throw new Error("socket hang up"); },
      supervise: async () => ({ approved: true, codes: [] }),
    });

    await rejected.handler(rejected.subject, rejected.window);
    await unavailable.handler(unavailable.subject, unavailable.window);

    assert.notEqual(
      rejected.row().errorCode,
      unavailable.row().errorCode,
      "one durable code for two opposite causes is the defect",
    );
    // Both keep the ordinary ladder: a transient fault must never be terminal, and
    // a refusal self-heals when the prompt or evaluator seam is fixed.
    assert.equal(rejected.row().status, "queued");
    assert.equal(unavailable.row().status, "queued");
  });

  /**
   * `claim_analysis_job` (migration 252) declines in two unrelated ways, and the
   * worker reported both as a bare `pending`. No inner row at all means the outer
   * tuple points at nothing and no attempt can satisfy it — a wiring or data
   * defect. A row that is there but inside its `available_at` backoff, or held by
   * a live lease, is ordinary contention that resolves itself. Both produced the
   * same sub-second `handler_failed` line in production.
   *
   * The codes are not written down: the property is that the three ways this
   * handler can report `failed` are pairwise distinguishable in a log, which is
   * what a bare `{status:"failed"}` cost.
   */
  it("tells a missing inner job apart from one that is merely not claimable", async () => {
    const clock = mutableClock();
    const queue = await failingQueue(clock);

    const stage = await queue.handler(queue.subject, queue.window);
    const unclaimable = await queue.handler(queue.subject, queue.window);
    // Same client, a run id no `analysis_jobs` row was ever minted for.
    const missing = await queue.handler(queue.subject, "run:99999999-9999-4999-8999-999999999999");

    const codes = [stage.code, unclaimable.code, missing.code];
    assert.deepEqual(
      [stage.status, unclaimable.status, missing.status],
      ["failed", "failed", "failed"],
      "all three keep the tuple runnable; only the code separates them",
    );
    assert.ok(codes.every((code) => typeof code === "string" && code.length > 0));
    assert.equal(new Set(codes).size, codes.length, "three causes, three codes");
  });

  /**
   * Migration 370 revives an inner row in status `failed`, and reaches it only
   * through an outer `background_jobs` row that is also `failed` — its sweep
   * selects `where status = 'failed'`. Completing the outer tuple as `skipped`
   * for an exhausted inner row therefore put the pair beyond the only mechanism
   * that could ever run it again, and the consumer waits forever.
   *
   * The attempt budget is not written down here: the loop runs the real worker
   * until the row reports its own terminal status, so the assertion holds
   * whatever `MAX_ATTEMPTS` becomes.
   */
  it("keeps an exhausted inner job reachable by the rediscovery sweep", async () => {
    const clock = mutableClock();
    const queue = await failingQueue(clock);

    for (let guard = 0; guard < 10 && queue.row().status !== "failed"; guard += 1) {
      await queue.handler(queue.subject, queue.window);
      clock.advance(61_000);
    }
    assert.equal(queue.row().status, "failed", "the inner row exhausted its attempts");

    const handled = await queue.handler(queue.subject, queue.window);

    assert.equal(
      handled.status,
      "failed",
      "`skipped` completes the outer tuple, and the sweep only revives failed ones",
    );
    assert.ok(handled.code);
  });

  it("completes the tuple once the inner job is discharged", async () => {
    const clock = mutableClock();
    const repository = createInMemoryAnalysisRepository({
      clock: { now: () => clock.now() },
      enrollments: { [CLIENT_ID]: "mock_clean_000001" as CrsMemberRef },
    });
    const enqueued = await enqueueAnalysisRun(
      { clientId: CLIENT_ID, sourceKind: "enrollment", sourceId: ENROLLMENT_ID, trigger: "scheduled" },
      { env: ENABLED, repository },
    );
    assert.ok(enqueued);
    const handler = createAnalysisRunHandler(async () => ({
      claimed: 0,
      failed: 0,
      succeeded: 0,
      terminal: 1,
      terminalStatus: "succeeded" as const,
    }));

    assert.deepEqual(await handler(enqueued.subject, enqueued.window), { status: "skipped" });
  });
});
