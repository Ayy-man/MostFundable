import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GET as getKpisRoute } from "../../app/api/revenue/kpis/route.ts";
import { POST as runNowRoute } from "../../app/api/revenue/jobs/run-now/route.ts";
import { GET as tickRoute, maxDuration as tickMaxDuration } from "../../app/api/revenue/jobs/tick/route.ts";
import { TICK_FUNCTION_LIMIT_MS, handleRevenueKpis, handleRevenueRunNow, handleRevenueTick } from "./handlers.ts";

import type { RevenueRpcClient } from "./types.ts";

const UUID = "11111111-1111-4111-8111-111111111111";
const client = { rpc: async () => ({ data: null, error: null }) } satisfies RevenueRpcClient;
const admin = async () => ({ role: "platform_admin" as const });
const NO_INTENTS = { completed: 0, examined: 0, failed: 0, parked: 0, unresolved: 0 };

async function body(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

describe("revenue routes", () => {
  it("returns 404 from every real route while FEATURE_REVENUE is absent", async () => {
    const previous = process.env.FEATURE_REVENUE;
    delete process.env.FEATURE_REVENUE;
    try {
      const responses = await Promise.all([
        getKpisRoute(new Request("http://local/api/revenue/kpis")),
        runNowRoute(new Request("http://local/api/revenue/jobs/run-now", {
          body: "{}",
          method: "POST",
        })),
        tickRoute(new Request("http://local/api/revenue/jobs/tick")),
      ]);
      assert.deepEqual(responses.map((response) => response.status), [404, 404, 404]);
    } finally {
      if (previous === undefined) delete process.env.FEATURE_REVENUE;
      else process.env.FEATURE_REVENUE = previous;
    }
  });

  it("keeps the authenticated shared tick reachable for analysis without revenue", async () => {
    const analysis = process.env.FEATURE_ANALYSIS;
    const revenue = process.env.FEATURE_REVENUE;
    const secret = process.env.CRON_SECRET;
    process.env.FEATURE_ANALYSIS = "1";
    delete process.env.FEATURE_REVENUE;
    delete process.env.CRON_SECRET;
    try {
      const response = await tickRoute(new Request("http://local/api/revenue/jobs/tick"));
      assert.equal(response.status, 503);
      assert.deepEqual(await body(response), { error: { code: "cron_unconfigured" } });
    } finally {
      if (analysis === undefined) delete process.env.FEATURE_ANALYSIS;
      else process.env.FEATURE_ANALYSIS = analysis;
      if (revenue === undefined) delete process.env.FEATURE_REVENUE;
      else process.env.FEATURE_REVENUE = revenue;
      if (secret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = secret;
    }
  });

  it("keeps the shared purge drainer reachable for enrollment without analysis", async () => {
    const enrollment = process.env.FEATURE_ENROLLMENT;
    const analysis = process.env.FEATURE_ANALYSIS;
    const secret = process.env.CRON_SECRET;
    process.env.FEATURE_ENROLLMENT = "1";
    delete process.env.FEATURE_ANALYSIS;
    delete process.env.CRON_SECRET;
    try {
      const response = await tickRoute(new Request("http://local/api/revenue/jobs/tick"));
      assert.equal(response.status, 503);
      assert.deepEqual(await body(response), { error: { code: "cron_unconfigured" } });
    } finally {
      if (enrollment === undefined) delete process.env.FEATURE_ENROLLMENT;
      else process.env.FEATURE_ENROLLMENT = enrollment;
      if (analysis === undefined) delete process.env.FEATURE_ANALYSIS;
      else process.env.FEATURE_ANALYSIS = analysis;
      if (secret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = secret;
    }
  });

  it("requires platform-admin authority for KPI and run-now", async () => {
    const forbidden = async () => { throw { status: 403 }; };
    const kpi = await handleRevenueKpis(new Request("http://local/api/revenue/kpis"), {
      requirePlatformAdmin: forbidden,
    });
    const run = await handleRevenueRunNow(new Request("http://local/api/revenue/jobs/run-now", {
      body: JSON.stringify({ job: "billing.accruals", subject: `org:${UUID}`, window: "2026-08" }),
      method: "POST",
    }), { requirePlatformAdmin: forbidden });
    assert.equal(kpi.status, 403);
    assert.equal(run.status, 403);
  });

  it("preserves authoritative KPI zeroes and uses the UTC month default", async () => {
    let receivedWindow = "";
    const response = await handleRevenueKpis(new Request("http://local/api/revenue/kpis"), {
      createClient: async () => client,
      now: () => new Date("2026-09-01T00:00:00.000Z"),
      readKpis: async (window) => {
        receivedWindow = window;
        return {
          complete: false,
          incompleteCodes: ["monitoring_split_unset"],
          monitoringShareTotalCents: 0,
          saasReferralTotalCents: 0,
        };
      },
      requirePlatformAdmin: admin,
    });
    assert.equal(response.status, 200);
    assert.equal(receivedWindow, "2026-09");
    assert.deepEqual(await body(response), {
      complete: false,
      enabled: true,
      incompleteCodes: ["monitoring_split_unset"],
      monitoringShareTotalCents: 0,
      saasReferralTotalCents: 0,
    });
  });

  it("rejects malformed KPI windows and non-allow-listed run-now bodies", async () => {
    const kpi = await handleRevenueKpis(new Request("http://local/api/revenue/kpis?window=2026-8"), {
      requirePlatformAdmin: admin,
    });
    let runs = 0;
    const run = await handleRevenueRunNow(new Request("http://local/api/revenue/jobs/run-now", {
      body: JSON.stringify({ extra: true, job: "billing.accruals", subject: `org:${UUID}`, window: "2026-08" }),
      method: "POST",
    }), {
      requirePlatformAdmin: admin,
      runNow: async () => {
        runs += 1;
        return { claimed: 0, failed: 0, retried: 0, skipped: 0, succeeded: 0 };
      },
    });
    assert.equal(kpi.status, 400);
    assert.equal(run.status, 400);
    assert.equal(runs, 0);
  });

  it("queues a valid run-now tuple and returns counts without tuple values", async () => {
    const response = await handleRevenueRunNow(new Request("http://local/api/revenue/jobs/run-now", {
      body: JSON.stringify({ job: "billing.accruals", subject: `org:${UUID}`, window: "2026-08" }),
      method: "POST",
    }), {
      requirePlatformAdmin: admin,
      runNow: async () => ({ claimed: 1, failed: 0, retried: 0, skipped: 0, succeeded: 1 }),
    });
    const result = await body(response);
    assert.deepEqual(result, { claimed: 1, completed: 1, failed: 0, retried: 0, status: "complete" });
    assert.equal(JSON.stringify(result).includes(UUID), false);
    assert.equal(Object.hasOwn(result, "window"), false);
  });

  it("fails the tick closed before scheduler access without an exact secret", async () => {
    let calls = 0;
    const dependencies = {
      drain: async () => {
        calls += 1;
        return { claimed: 0, failed: 0, retried: 0, skipped: 0, succeeded: 0 };
      },
      schedule: async () => {
        calls += 1;
        return { failures: [], jobs: 0, providers: 0 };
      },
    };
    const unconfigured = await handleRevenueTick(new Request("http://local/tick"), {
      ...dependencies,
      env: {},
    });
    const unauthorized = await handleRevenueTick(new Request("http://local/tick", {
      headers: { authorization: "Bearer wrong" },
    }), {
      ...dependencies,
      env: { CRON_SECRET: "expected" },
    });
    assert.equal(unconfigured.status, 503);
    assert.equal(unauthorized.status, 401);
    assert.equal(calls, 0);
  });

  it("runs one bounded tick and returns metadata counts only", async () => {
    let max = 0;
    const response = await handleRevenueTick(new Request("http://local/tick", {
      headers: { authorization: "Bearer exact-secret" },
    }), {
      drain: async (maxJobs) => {
        max = maxJobs;
        return { claimed: 4, failed: 1, retried: 1, skipped: 1, succeeded: 1 };
      },
      env: { CRON_SECRET: "exact-secret" },
      now: () => new Date("2026-08-16T02:05:00Z"),
      schedule: async () => ({ failures: [], jobs: 3, providers: 1 }),
    });
    const result = await body(response);
    assert.equal(max, 25);
    assert.deepEqual(result, {
      batches: 1, claimed: 4, completed: 2, deferred: 0, drainFailures: [], failed: 1, operatorIntents: NO_INTENTS,
      remaining: false, retried: 1, scheduleFailures: [], scheduled: 3,
    });
    assert.deepEqual(Object.keys(result).sort(), [
      "batches", "claimed", "completed", "deferred", "drainFailures", "failed", "operatorIntents",
      "remaining", "retried", "scheduleFailures", "scheduled",
    ]);
  });

  it("drains forty queued rows to terminal state in one tick", async () => {
    const batches = [25, 15];
    const response = await handleRevenueTick(new Request("http://local/tick", {
      headers: { authorization: "Bearer exact-secret" },
    }), {
      drain: async () => {
        const claimed = batches.shift() ?? 0;
        return { claimed, failed: 0, retried: 0, skipped: 0, succeeded: claimed };
      },
      env: { CRON_SECRET: "exact-secret" },
      monotonicNow: () => 0,
      schedule: async () => ({ failures: [], jobs: 40, providers: 1 }),
    });
    assert.deepEqual(await body(response), {
      batches: 2, claimed: 40, completed: 40, deferred: 0, drainFailures: [], failed: 0, operatorIntents: NO_INTENTS,
      remaining: false, retried: 0, scheduleFailures: [], scheduled: 40,
    });
  });

  it("stops full batches at the measured deadline and reports remaining work", async () => {
    let clock = 0;
    let calls = 0;
    const response = await handleRevenueTick(new Request("http://local/tick", {
      headers: { authorization: "Bearer exact-secret" },
    }), {
      drain: async () => { calls += 1; clock = 46; return { claimed: 25, failed: 0, retried: 0, skipped: 0, succeeded: 25 }; },
      env: { CRON_SECRET: "exact-secret", JOB_TICK_DEADLINE_MS: "45" },
      monotonicNow: () => clock,
      schedule: async () => ({ failures: [], jobs: 40, providers: 1 }),
    });
    assert.equal(calls, 1);
    assert.equal((await body(response)).remaining, true);
  });

  it("R4C-04: drains durable work when scheduling was partial and reports both", async () => {
    let drains = 0;
    const response = await handleRevenueTick(new Request("http://local/tick", {
      headers: { authorization: "Bearer exact-secret" },
    }), {
      drain: async () => { drains += 1; return { claimed: 6, failed: 0, retried: 0, skipped: 1, succeeded: 5 }; },
      env: { CRON_SECRET: "exact-secret" },
      schedule: async () => ({
        failures: [{ count: 2, job: "purge.derived" as const, reason: "DERIVED_PURGE_TARGETS_READ_FAILED", scope: "provider" as const }],
        jobs: 4,
        providers: 3,
      }),
    });
    assert.equal(drains, 1);
    assert.equal(response.status, 503);
    assert.deepEqual(await body(response), {
      batches: 1,
      claimed: 6,
      completed: 6,
      deferred: 0,
      drainFailures: [],
      error: { code: "job_schedule_partial" },
      failed: 0,
      operatorIntents: NO_INTENTS,
      remaining: false,
      retried: 0,
      scheduleFailures: [{ count: 2, job: "purge.derived", reason: "DERIVED_PURGE_TARGETS_READ_FAILED", scope: "provider" }],
      scheduled: 4,
    });
  });

  it("R4C-04: a scheduler that throws outright still lets already durable work drain", async () => {
    let drains = 0;
    const response = await handleRevenueTick(new Request("http://local/tick", {
      headers: { authorization: "Bearer exact-secret" },
    }), {
      drain: async () => { drains += 1; return { claimed: 2, failed: 0, retried: 0, skipped: 0, succeeded: 2 }; },
      env: { CRON_SECRET: "exact-secret" },
      schedule: async () => { throw new Error("JOB_SCHEDULE_TIME_INVALID"); },
    });
    assert.equal(drains, 1);
    assert.equal(response.status, 503);
    const result = await body(response);
    assert.equal(result.claimed, 2);
    assert.equal(result.scheduled, 0);
    assert.deepEqual(result.scheduleFailures, [
      { count: 1, job: "scheduler", reason: "JOB_SCHEDULE_FAILED", scope: "scheduler" },
    ]);
  });

  /**
   * G-KB-01. `vault.reimport_kb` failed on every run from Phase 8 to 2026-08-22 and every
   * tick that carried it still answered 200, so "12 invocations, all 200" read as health.
   * A job that has burned its three attempts is dead until somebody acts, and the tick has
   * to say so where the Vercel cron dashboard shows it.
   */
  it("G-KB-01: a terminal drain failure fails the tick and names the job", async () => {
    const response = await handleRevenueTick(new Request("http://local/tick", {
      headers: { authorization: "Bearer exact-secret" },
    }), {
      drain: async () => ({
        claimed: 1,
        failed: 1,
        failures: [{
          attempt: 3,
          code: "handler_failed",
          detail: "KB_SOURCE_SHAPE_UNVERIFIED",
          job: "vault.reimport_kb" as const,
          terminal: true,
        }],
        retried: 0,
        skipped: 0,
        succeeded: 0,
      }),
      env: { CRON_SECRET: "exact-secret" },
      schedule: async () => ({ failures: [], jobs: 1, providers: 1 }),
    });
    assert.equal(response.status, 503, "a dead obligation must not be reported inside a 200");
    const result = await body(response);
    assert.deepEqual(result.error, { code: "job_drain_terminal" });
    assert.deepEqual(result.drainFailures, [{
      attempt: 3, code: "handler_failed", detail: "KB_SOURCE_SHAPE_UNVERIFIED",
      job: "vault.reimport_kb", terminal: true,
    }]);
  });

  it("G-KB-01: a retryable drain failure is reported but keeps the tick green", async () => {
    const response = await handleRevenueTick(new Request("http://local/tick", {
      headers: { authorization: "Bearer exact-secret" },
    }), {
      drain: async () => ({
        claimed: 1,
        failed: 0,
        failures: [{
          attempt: 1, code: "handler_threw", detail: null, job: "kpi.rollup" as const, terminal: false,
        }],
        retried: 1,
        skipped: 0,
        succeeded: 0,
      }),
      env: { CRON_SECRET: "exact-secret" },
      schedule: async () => ({ failures: [], jobs: 1, providers: 1 }),
    });
    // The next tick is the answer to a retryable failure; 503 on ordinary contention is
    // the noise that trains people to stop reading the signal.
    assert.equal(response.status, 200);
    const failures = (await body(response)).drainFailures as unknown[];
    assert.equal(failures.length, 1);
  });

  it("R5C-06: the tick reconciles operator intents with no HTTP caller and reports the outcome", async () => {
    let reconciled = 0;
    const response = await handleRevenueTick(new Request("http://local/tick", {
      headers: { authorization: "Bearer exact-secret" },
    }), {
      drain: async () => ({ claimed: 0, failed: 0, retried: 0, skipped: 0, succeeded: 0 }),
      env: { CRON_SECRET: "exact-secret" },
      reconcileOperatorIntents: async () => {
        reconciled += 1;
        return { completed: 1, examined: 2, failed: 0, parked: 1, unresolved: 0 };
      },
      schedule: async () => ({ failures: [], jobs: 0, providers: 0 }),
    });
    assert.equal(reconciled, 1, "terminality does not wait for a second POST");
    assert.deepEqual((await body(response)).operatorIntents, {
      completed: 1, examined: 2, failed: 0, parked: 1, unresolved: 0,
    });
  });

  it("R5C-06: a reconciliation failure is recorded and durable work still drains", async () => {
    let drains = 0;
    const response = await handleRevenueTick(new Request("http://local/tick", {
      headers: { authorization: "Bearer exact-secret" },
    }), {
      drain: async () => { drains += 1; return { claimed: 3, failed: 0, retried: 0, skipped: 0, succeeded: 3 }; },
      env: { CRON_SECRET: "exact-secret" },
      reconcileOperatorIntents: async () => { throw new Error("OPERATOR_INTENT_READ_FAILED"); },
      schedule: async () => ({ failures: [], jobs: 0, providers: 0 }),
    });
    assert.equal(drains, 1);
    const result = await body(response);
    assert.equal(result.claimed, 3);
    assert.deepEqual(result.operatorIntents, { completed: 0, examined: 0, failed: 1, parked: 0, unresolved: 0 });
  });

  /**
   * The route's ceiling and the drain's budget were unrelated numbers, and the
   * ceiling was not even written down — it came from the deployment plan's
   * default. So the drain budgeted nothing, the platform killed the invocation
   * instead (production 2026-08-22 07:30:32, 504 after 300 seconds), and a kill
   * writes no `fail()`, logs nothing and loses the schedule result with it.
   *
   * Both numbers are read out of their own modules here rather than restated, so
   * changing either one alone fails this rather than production.
   */
  it("budgets the drain strictly inside the route's declared function ceiling", async () => {
    assert.equal(TICK_FUNCTION_LIMIT_MS, tickMaxDuration * 1_000);

    const budgets: number[] = [];
    let clock = 0;
    await handleRevenueTick(new Request("http://local/tick", {
      headers: { authorization: "Bearer exact-secret" },
    }), {
      drain: async (_maxJobs, budgetMs) => {
        budgets.push(budgetMs);
        return { claimed: 1, failed: 0, retried: 0, skipped: 0, succeeded: 1 };
      },
      env: { CRON_SECRET: "exact-secret" },
      // The schedule and reconciliation steps run before the drain, so the budget
      // has to be what is left of the invocation, not what it started with.
      monotonicNow: () => (clock += 1_000),
      schedule: async () => ({ failures: [], jobs: 0, providers: 0 }),
    });

    assert.equal(budgets.length, 1);
    assert.ok(budgets[0] > 0, "the drain is given a budget at all");
    assert.ok(
      budgets[0] < TICK_FUNCTION_LIMIT_MS,
      "the drain must stop before the platform does, with room for the response",
    );
  });

  it("R5C-05: the deployed cron is materially tighter than daily", async () => {
    const { readFileSync } = await import("node:fs");
    const config = JSON.parse(readFileSync(new URL("../../../vercel.json", import.meta.url), "utf8")) as {
      crons: { path: string; schedule: string }[];
    };
    const ticks = config.crons.filter((cron) => cron.path === "/api/revenue/jobs/tick");
    assert.ok(ticks.length > 0, "the tick is still deployed");
    // A crash between the local cancel and the provider cancel is recovered by the next tick,
    // so the tick period is the worst-case delay before a live subscription is closed. A
    // fixed daily hour cannot bound that; a minute field that repeats within the hour can.
    const minutes = ticks.map((cron) => cron.schedule.split(" ")[0] ?? "");
    assert.ok(
      minutes.some((minute) => /^\*\/([1-9]|[1-5]\d)$/.test(minute)),
      `no sub-hourly tick: ${JSON.stringify(ticks)}`,
    );
    const period = Math.max(...minutes
      .filter((minute) => /^\*\/\d+$/.test(minute))
      .map((minute) => Number(minute.slice(2))));
    assert.ok(period <= 15, `the provider-cancel recovery bound is ${period} minutes, not 15`);
  });

  it.skip("verifies the production Vercel cron registration when account evidence is available", () => {});
});
