import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  JOB_DEFINITIONS,
  JOB_NAMES,
  JOB_WINDOW_PATTERNS,
  REDISCOVERY_MEMBER_JOBS,
  isRowIdWindowJob,
} from "./definitions.ts";
import { createAnalysisRunHandler } from "./handlers/analysis-run.ts";
import { createOutcomesRefreshHandler } from "./handlers/outcomes-refresh.ts";
import { registerRowWindowRediscovery } from "./rediscovery.ts";
import {
  getCadenceOwnerFlags,
  getCadenceProviders,
  getHandlerOwnerFlags,
  registerCadenceProvider,
  registerJobHandler,
  resetJobRegistryForTests,
} from "./registry.ts";
import { enqueueDueJobs, schedulerEnabled } from "./scheduler.ts";
import { createBillingAccrualCadenceProvider, justClosedUtcMonth, utcMonth } from "../revenue/jobs/register.ts";

import type { BackgroundJob, JobName, JobsRepository, JobTuple } from "./types.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const SECOND_ENROLLMENT = "22222222-2222-4222-8222-222222222222";
const SAMPLE_UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

function repository(enqueued: JobTuple[]): JobsRepository {
  return {
    async claim() { return []; },
    async claimOne() { return []; },
    async complete() {},
    async enqueue(tuple) {
      enqueued.push(tuple);
      return { ...tuple, attemptCount: 0, id: ORG, status: "queued" } satisfies BackgroundJob;
    },
    async fail() {},
    async renew() { return { attemptCount: 1, renewed: true }; },
  };
}

describe("job scheduler and adapters", () => {
  it("derives scheduler reachability from registered owner flags", async () => {
    const owners = new Set(["FEATURE_ANALYSIS", "FEATURE_REVENUE"] as const);
    assert.equal(await schedulerEnabled({ FEATURE_ANALYSIS: "1" }, owners), true);
    assert.equal(await schedulerEnabled({ FEATURE_REVENUE: "true" }, owners), true);
    assert.equal(await schedulerEnabled({}, owners), false);
  });
  it("adapts analysis and outcome workers to one-item drains", async () => {
    let analysisInput: unknown;
    let outcomeInput: unknown;
    const analysis = createAnalysisRunHandler(async (input) => {
      analysisInput = input;
      return { claimed: 1, failed: 0, succeeded: 1 };
    });
    const outcomes = createOutcomesRefreshHandler(async (...input) => {
      outcomeInput = input;
      return { claimed: 0, failed: 0, succeeded: 0 };
    });

    const runId = "22222222-2222-4222-8222-222222222222";
    assert.deepEqual(await analysis(`client:${ORG}`, `run:${runId}`), { rows: 1, status: "ok" });
    assert.equal((analysisInput as { maxJobs: number }).maxJobs, 1);
    assert.deepEqual((analysisInput as { target: unknown }).target, {
      analysisRunId: runId,
      clientId: ORG,
    });
    assert.deepEqual(await outcomes("bank:target-bank", `change:${ORG}`), { status: "skipped" });
    assert.deepEqual(outcomeInput, [undefined, {
      maxIterations: 1,
      target: { bankRef: "target-bank", changeId: ORG },
    }]);
  });

  it("keeps unavailable targets retryable and maps terminal targets to skipped", async () => {
    const runId = "22222222-2222-4222-8222-222222222222";
    const target = [`client:${ORG}`, `run:${runId}`] as const;
    const unavailable = await createAnalysisRunHandler(
      async () => ({ claimed: 0, failed: 0, pending: 1, succeeded: 0 }),
    )(...target);
    assert.equal(unavailable.status, "failed");
    assert.deepEqual(
      await createAnalysisRunHandler(async () => ({
        claimed: 0, failed: 0, succeeded: 0, terminal: 1, terminalStatus: "succeeded" as const,
      }))(...target),
      { status: "skipped" },
    );
    let calls = 0;
    const malformed = await createAnalysisRunHandler(
      async () => { calls += 1; return { claimed: 1, failed: 0, succeeded: 1 }; },
    )("client:bad", `run:${runId}`);
    assert.equal(malformed.status, "failed");
    assert.equal(calls, 0);
    // Both are `failed` because that is the only result that leaves the outer
    // tuple runnable, so the code is the only thing that tells them apart in a
    // runtime log — which is what a bare `{status:"failed"}` cost in production.
    assert.ok(unavailable.code && malformed.code);
    assert.notEqual(unavailable.code, malformed.code);
    const outcomeTuple = ["bank:target-bank", `change:${ORG}`] as const;
    assert.deepEqual(await createOutcomesRefreshHandler(async () => ({
      claimed: 0, failed: 0, pending: 1, succeeded: 0,
    }))(...outcomeTuple), { status: "failed" });
    assert.deepEqual(await createOutcomesRefreshHandler(async () => ({
      claimed: 0, failed: 0, succeeded: 0, terminal: 1,
    }))(...outcomeTuple), { status: "skipped" });
  });

  it("accepts every shared-validator analysis tuple including seeded Postgres UUIDs", async () => {
    const tuples = [
      ["client:a3000000-0000-0000-0000-000000000004", "run:14111000-0000-0000-0000-000000000003"],
      [`client:${ORG}`, "run:22222222-2222-4222-8222-222222222222"],
    ] as const;
    const targets: unknown[] = [];
    const handler = createAnalysisRunHandler(async (input) => {
      targets.push(input.target);
      return { claimed: 1, failed: 0, succeeded: 1 };
    });
    for (const [subject, window] of tuples) {
      assert.deepEqual(await handler(subject, window), { rows: 1, status: "ok" });
    }
    assert.deepEqual(targets[0], {
      analysisRunId: "14111000-0000-0000-0000-000000000003",
      clientId: "a3000000-0000-0000-0000-000000000004",
    });
  });

  it("emits the just-closed month and never the open month at the UTC boundary", async () => {
    const provider = createBillingAccrualCadenceProvider({
      async listAccrualOrgIds() { return [ORG]; },
    });
    assert.equal(utcMonth(new Date("2026-09-01T00:00:00.000Z")), "2026-09");
    assert.equal(justClosedUtcMonth(new Date("2026-09-01T00:30:00.000Z")), "2026-08");
    const tuples = await provider(new Date("2026-09-01T00:30:00.000Z"));
    assert.deepEqual(tuples, [{
      job: "billing.accruals",
      subject: `org:${ORG}`,
      window: "2026-08",
    }]);
    assert.equal(tuples.some((tuple) => tuple.window === "2026-09"), false, "the open month is never enqueued");
  });

  it("visits only registered providers and preserves replay tuples", async () => {
    const enqueued: JobTuple[] = [];
    const provider = createBillingAccrualCadenceProvider({
      async listAccrualOrgIds() { return [ORG]; },
    });
    const deps = {
      env: { FEATURE_REVENUE: "1" },
      ownerFlags: new Map([["billing.accruals" as const, new Set(["FEATURE_REVENUE" as const])]]),
      providers: new Map([["billing.accruals" as const, provider]]),
      repository: repository(enqueued),
    };
    const now = new Date("2026-08-16T12:00:00Z");
    assert.deepEqual(await enqueueDueJobs(now, deps), { failures: [], jobs: 1, providers: 1 });
    assert.deepEqual(await enqueueDueJobs(now, deps), { failures: [], jobs: 1, providers: 1 });
    assert.deepEqual(enqueued[0], enqueued[1]);
  });

  it("a single enabled owner schedules only its own cadence", async () => {
    const enqueued: JobTuple[] = [];
    const tuple = (job: "billing.accruals" | "kpi.rollup") => async () => [{
      job,
      subject: job === "kpi.rollup" ? "platform" : `org:${ORG}`,
      window: job === "kpi.rollup" ? "2026-08-16" : "2026-08",
    }] as const;
    const result = await enqueueDueJobs(new Date("2026-08-16T12:00:00Z"), {
      env: { FEATURE_ADMIN: "1" },
      ownerFlags: new Map<"billing.accruals" | "kpi.rollup", ReadonlySet<"FEATURE_REVENUE" | "FEATURE_ADMIN">>([
        ["billing.accruals", new Set(["FEATURE_REVENUE" as const])],
        ["kpi.rollup", new Set(["FEATURE_ADMIN" as const])],
      ]),
      providers: new Map([
        ["billing.accruals", tuple("billing.accruals")],
        ["kpi.rollup", tuple("kpi.rollup")],
      ]),
      repository: repository(enqueued),
    });
    assert.deepEqual(result, { failures: [], jobs: 1, providers: 1 });
    assert.deepEqual(enqueued.map((row) => row.job), ["kpi.rollup"]);
  });

  it("does no work when recurring definitions have no registered provider", async () => {
    const enqueued: JobTuple[] = [];
    assert.deepEqual(await enqueueDueJobs(new Date("2026-08-16T12:00:00Z"), {
      providers: new Map(),
      repository: repository(enqueued),
    }), { failures: [], jobs: 0, providers: 0 });
    assert.equal(enqueued.length, 0);
  });

  it("R4C-04: a throwing producer is recorded and every later producer still enqueues", async () => {
    const enqueued: JobTuple[] = [];
    const result = await enqueueDueJobs(new Date("2026-08-18T02:05:00Z"), {
      env: { FEATURE_ADMIN: "1", FEATURE_ENROLLMENT: "1" },
      ownerFlags: new Map<"purge.derived" | "kpi.rollup", ReadonlySet<"FEATURE_ENROLLMENT" | "FEATURE_ADMIN">>([
        ["purge.derived", new Set(["FEATURE_ENROLLMENT" as const])],
        ["kpi.rollup", new Set(["FEATURE_ADMIN" as const])],
      ]),
      providers: new Map([
        ["purge.derived", async () => { throw new Error("DERIVED_PURGE_TARGETS_READ_FAILED"); }],
        ["kpi.rollup", async () => [{ job: "kpi.rollup" as const, subject: "platform", window: "2026-08-18" }]],
      ]),
      repository: repository(enqueued),
    });
    assert.deepEqual(enqueued.map((row) => row.job), ["kpi.rollup"]);
    assert.deepEqual(result, {
      failures: [{ count: 1, job: "purge.derived", reason: "DERIVED_PURGE_TARGETS_READ_FAILED", scope: "provider" }],
      jobs: 1,
      providers: 2,
    });
  });

  it("R4C-04: an unusable tuple is recorded without suppressing its siblings, and validation still refuses it", async () => {
    const enqueued: JobTuple[] = [];
    const result = await enqueueDueJobs(new Date("2026-08-18T02:05:00Z"), {
      env: { FEATURE_ADMIN: "1" },
      ownerFlags: new Map([["kpi.rollup" as const, new Set(["FEATURE_ADMIN" as const])]]),
      providers: new Map([["kpi.rollup" as const, async () => [
        { job: "kpi.rollup" as const, subject: "not-a-subject", window: "2026-08-18" },
        { job: "billing.accruals" as const, subject: `org:${ORG}`, window: "2026-08" },
        { job: "kpi.rollup" as const, subject: "platform", window: "2026-08-18" },
      ]]]),
      repository: repository(enqueued),
    });
    assert.deepEqual(enqueued, [{ job: "kpi.rollup", subject: "platform", window: "2026-08-18" }]);
    assert.deepEqual(result.failures, [
      { count: 1, job: "kpi.rollup", reason: "JOB_TUPLE_INVALID", scope: "tuple" },
      { count: 1, job: "kpi.rollup", reason: "JOB_CADENCE_OWNER_MISMATCH", scope: "tuple" },
    ]);
    assert.equal(result.jobs, 1);
  });

  it("R4C-04: a failing enqueue does not stop the rest of the same producer's tuples", async () => {
    const enqueued: JobTuple[] = [];
    const inner = repository(enqueued);
    const result = await enqueueDueJobs(new Date("2026-08-18T02:05:00Z"), {
      env: { FEATURE_ENROLLMENT: "1" },
      ownerFlags: new Map([["purge.derived" as const, new Set(["FEATURE_ENROLLMENT" as const])]]),
      providers: new Map([["purge.derived" as const, async () => [
        { job: "purge.derived" as const, subject: `enrollment:${ORG}`, window: "2026-08-18" },
        { job: "purge.derived" as const, subject: `enrollment:${SECOND_ENROLLMENT}`, window: "2026-08-18" },
      ]]]),
      repository: {
        ...inner,
        async enqueue(tuple) {
          if (tuple.subject === `enrollment:${ORG}`) throw new Error("BACKGROUND_JOB_DATABASE_ERROR");
          return inner.enqueue(tuple);
        },
      },
    });
    assert.deepEqual(enqueued.map((row) => row.subject), [`enrollment:${SECOND_ENROLLMENT}`]);
    assert.deepEqual(result.failures, [
      { count: 1, job: "purge.derived", reason: "BACKGROUND_JOB_DATABASE_ERROR", scope: "tuple" },
    ]);
  });

  it("R5C-02: every job with a handler has a producer, on-demand included", async () => {
    await import("./register.ts");
    // R4D-03's version of this assertion excluded every `on-demand` definition, which is
    // exactly the three definitions that had no rediscovery path at all. The exclusion is
    // gone: a handler with no producer dies with its tuple whatever its declared cadence.
    const missing = JOB_NAMES.filter((job) =>
      getHandlerOwnerFlags().has(job) && !getCadenceProviders().has(job));
    assert.deepEqual(missing, [], "a handler with no producer dies with its tuple");
    assert.deepEqual(
      [...getCadenceOwnerFlags().get("purge.derived") ?? []],
      ["FEATURE_ENROLLMENT", "FEATURE_ANALYSIS"],
      "rediscovery is owned by the same two flags as the handler",
    );
  });

  it("R5C-02: the rediscovery class is derived from the frozen window patterns, not listed", () => {
    // Re-derived behaviourally — does this job's own window pattern accept a row id? — rather
    // than compared against a transcribed set, so a new on-demand definition carrying a row
    // id in its window joins the class by itself.
    const derived = JOB_NAMES.filter((job) => {
      if (JOB_DEFINITIONS[job].cadence !== "on-demand") return false;
      const prefix = JOB_DEFINITIONS[job].window.split(":")[0];
      return new RegExp(`^(?:${JOB_WINDOW_PATTERNS[job]})$`).test(`${prefix}:${SAMPLE_UUID}`);
    });
    assert.deepEqual([...REDISCOVERY_MEMBER_JOBS], derived);
    assert.ok(derived.length >= 3, "the class is non-empty");
    for (const job of derived) {
      assert.equal(isRowIdWindowJob(job), true, `${job} carries a row id in its window`);
    }
    // The three catalog entries with neither handler nor producer are unbuilt phases, not
    // members of this class: none of them carries a row-id window.
    for (const job of ["crs.alert_batch", "analysis.schedule_due", "vault.sync_banks"] as const) {
      assert.equal(isRowIdWindowJob(job), false, `${job} is a dated window, not a row-id window`);
    }
  });

  it("R5C-02: every member has a rediscovery path wired for it", async () => {
    await import("./register.ts");
    for (const job of REDISCOVERY_MEMBER_JOBS) {
      assert.equal(
        typeof getCadenceProviders().get(job), "function",
        `${job} is an on-demand row-id-window job with no rediscovery producer`,
      );
      assert.ok(
        [...getCadenceOwnerFlags().get(job) ?? []].length > 0,
        `${job} rediscovery runs under no owner flag`,
      );
    }
  });

  it("R5C-02: rediscovery composes onto a domain cadence instead of replacing it", async () => {
    resetJobRegistryForTests();
    const domain: JobTuple[] = [{
      job: "notifications.dispatch",
      subject: `client:${ORG}`,
      window: `notification:${SECOND_ENROLLMENT}`,
    }];
    registerJobHandler("notifications.dispatch", async () => ({ status: "ok" }), "FEATURE_ANCILLARY");
    registerCadenceProvider("notifications.dispatch", async () => domain, "FEATURE_ANCILLARY");
    let asked: unknown = null;
    registerRowWindowRediscovery({
      createClient: () => ({
        async rpc(name: string, args: Record<string, unknown>) {
          assert.equal(name, "rediscover_row_window_jobs");
          asked = args.p_jobs;
          return {
            data: [{ job: "notifications.dispatch", subject: `client:${ORG}`, window: `notification:${SAMPLE_UUID}` }],
            error: null,
          };
        },
      }),
    });
    const provider = getCadenceProviders().get("notifications.dispatch");
    assert.ok(provider);
    assert.deepEqual(
      (await provider(new Date("2026-08-18T02:05:00Z"))).map((row) => row.window),
      [`notification:${SECOND_ENROLLMENT}`, `notification:${SAMPLE_UUID}`],
      "the domain's own discovery and the re-armed tuple are both emitted",
    );
    assert.deepEqual(asked, ["notifications.dispatch"]);
    resetJobRegistryForTests();
  });

  it("R5C-02: a re-armed tuple is emitted for every member and the sweep is asked per job", async () => {
    resetJobRegistryForTests();
    const asked: unknown[] = [];
    for (const job of REDISCOVERY_MEMBER_JOBS) {
      registerJobHandler(job, async () => ({ status: "ok" }), "FEATURE_ANALYSIS");
    }
    registerRowWindowRediscovery({
      createClient: () => ({
        async rpc(_name: string, args: Record<string, unknown>) {
          asked.push(args.p_jobs);
          const [job] = args.p_jobs as JobName[];
          return {
            data: [{
              job,
              subject: job === "outcomes.refresh_stats" ? "bank:r5-bank" : `client:${ORG}`,
              window: `${job === "analysis.run" ? "run" : job === "outcomes.refresh_stats" ? "change" : "notification"}:${SECOND_ENROLLMENT}`,
            }],
            error: null,
          };
        },
      }),
    });
    const enqueued: JobTuple[] = [];
    const result = await enqueueDueJobs(new Date("2026-08-18T02:20:00Z"), {
      env: { FEATURE_ANALYSIS: "1" },
      repository: repository(enqueued),
    });
    assert.deepEqual(asked, REDISCOVERY_MEMBER_JOBS.map((job) => [job]));
    assert.deepEqual(enqueued.map((row) => row.job), [...REDISCOVERY_MEMBER_JOBS]);
    assert.deepEqual(result.failures, []);
    assert.equal(result.jobs, REDISCOVERY_MEMBER_JOBS.length);
    resetJobRegistryForTests();
  });
});
