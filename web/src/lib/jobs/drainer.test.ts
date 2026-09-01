import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { drainJobs } from "./drainer.ts";
import { registerJobHandler, resetJobRegistryForTests } from "./registry.ts";
import { runNow } from "./run-now.ts";

import type { BackgroundJob, JobsRepository, JobTuple } from "./types.ts";

const UUID = "11111111-1111-4111-8111-111111111111";

function job(overrides: Partial<BackgroundJob> = {}): BackgroundJob {
  return {
    attemptCount: 1,
    id: UUID,
    job: "billing.accruals",
    status: "running",
    subject: `org:${UUID}`,
    window: "2026-08",
    ...overrides,
  };
}

function fakeRepository(claimed: BackgroundJob[] = []) {
  const events: Array<{ kind: string; value: unknown }> = [];
  const repository: JobsRepository = {
    async claim(input) {
      events.push({ kind: "claim", value: input });
      return claimed;
    },
    async claimOne(input) {
      events.push({ kind: "claimOne", value: input });
      return claimed.filter((row) => row.id === input.jobId);
    },
    async complete(input) { events.push({ kind: "complete", value: input }); },
    async enqueue(tuple) {
      events.push({ kind: "enqueue", value: tuple });
      return job({ ...tuple, attemptCount: 0, status: "queued" });
    },
    async fail(input) { events.push({ kind: "fail", value: input }); },
    async renew(input) {
      const row = claimed.find((candidate) => candidate.id === input.jobId);
      return { attemptCount: row?.attemptCount ?? null, renewed: Boolean(row) };
    },
  };
  return { events, repository };
}

describe("job drainer", () => {
  beforeEach(resetJobRegistryForTests);

  it("claims an empty queue with a hard batch cap", async () => {
    const fake = fakeRepository();
    assert.deepEqual(await drainJobs({ maxJobs: 999, workerId: "worker" }, fake), {
      claimed: 0,
      failed: 0,
      failures: [],
      retried: 0,
      skipped: 0,
      succeeded: 0,
    });
    assert.equal((fake.events[0].value as { maxJobs: number }).maxJobs, 25);
  });

  it("completes ok and skipped rows", async () => {
    const fake = fakeRepository([job(), job({ id: "22222222-2222-4222-8222-222222222222" })]);
    let calls = 0;
    registerJobHandler("billing.accruals", async () => {
      calls += 1;
      return calls === 1 ? { status: "ok", rows: 2 } : { status: "skipped" };
    }, "FEATURE_REVENUE");
    const result = await drainJobs({ workerId: "worker" }, fake);
    assert.deepEqual(result, { claimed: 2, failed: 0, failures: [], retried: 0, skipped: 1, succeeded: 1 });
    assert.deepEqual(fake.events.filter((event) => event.kind === "complete").map((event) => event.value), [
      { jobId: UUID, rows: 2, status: "succeeded", workerId: "worker" },
      { jobId: "22222222-2222-4222-8222-222222222222", rows: 0, status: "skipped", workerId: "worker" },
    ]);
  });

  it("dispatches each tuple once while a second drainer arrives during a slow first handler", async () => {
    const rows = [job(), job({ id: "22222222-2222-4222-8222-222222222222" })];
    const fake = fakeRepository(rows);
    let firstClaim = true;
    fake.repository.claim = async () => {
      if (!firstClaim) return [];
      firstClaim = false;
      return rows;
    };
    let releaseFirst: (() => void) | undefined;
    let firstStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { firstStarted = resolve; });
    const release = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const dispatched: string[] = [];
    registerJobHandler("billing.accruals", async (subject) => {
      dispatched.push(subject);
      if (dispatched.length === 1) {
        firstStarted?.();
        await release;
      }
      return { status: "ok", rows: 1 };
    }, "FEATURE_REVENUE");
    const first = drainJobs({ workerId: "worker-a" }, fake);
    await started;
    const second = await drainJobs({ workerId: "worker-b" }, fake);
    releaseFirst?.();
    await first;
    assert.equal(second.claimed, 0);
    assert.deepEqual(dispatched, [`org:${UUID}`, `org:${UUID}`], "each leased tuple is dispatched once");
  });

  it("retries failed results and thrown handlers with deterministic delays", async () => {
    const second = "22222222-2222-4222-8222-222222222222";
    const fake = fakeRepository([job(), job({ attemptCount: 2, id: second })]);
    let calls = 0;
    registerJobHandler("billing.accruals", async () => {
      calls += 1;
      if (calls === 1) return { status: "failed" };
      throw new Error("sensitive domain detail");
    }, "FEATURE_REVENUE");
    const result = await drainJobs({ workerId: "worker" }, fake);
    assert.equal(result.retried, 2);
    const failures = fake.events.filter((event) => event.kind === "fail").map((event) => event.value);
    assert.deepEqual(failures, [
      { errorCode: "handler_failed", jobId: UUID, retry: true, retryAfterSeconds: 30, workerId: "worker" },
      { errorCode: "handler_threw", jobId: second, retry: true, retryAfterSeconds: 60, workerId: "worker" },
    ]);
  });

  it("makes attempt three terminal and continues to later leased rows", async () => {
    const later = "22222222-2222-4222-8222-222222222222";
    const fake = fakeRepository([job({ attemptCount: 3 }), job({ id: later })]);
    let calls = 0;
    registerJobHandler("billing.accruals", async () => {
      calls += 1;
      return calls === 1 ? { status: "failed" } : { status: "ok", rows: 1 };
    }, "FEATURE_REVENUE");
    const result = await drainJobs({ workerId: "worker" }, fake);
    assert.deepEqual(result, {
      claimed: 2,
      failed: 1,
      failures: [{ attempt: 3, code: "handler_failed", detail: null, job: "billing.accruals", terminal: true }],
      retried: 0,
      skipped: 0,
      succeeded: 1,
    });
    assert.equal((fake.events.find((event) => event.kind === "fail")?.value as { retry: boolean }).retry, false);
    assert.ok(fake.events.some((event) => event.kind === "complete" && (event.value as { jobId: string }).jobId === later));
  });

  it("parks an unregistered handler without dispatch", async () => {
    const fake = fakeRepository([job({ job: "vault.sync_banks", subject: "global", window: "2026-08-16" })]);
    const result = await drainJobs({ workerId: "worker" }, fake);
    assert.equal(result.failed, 1);
    assert.deepEqual(fake.events.find((event) => event.kind === "fail")?.value, {
      errorCode: "handler_unregistered",
      jobId: UUID,
      retry: false,
      retryAfterSeconds: 0,
      workerId: "worker",
    });
  });

  it("logs only the eight allowed metadata keys", async () => {
    const fake = fakeRepository([job()]);
    const logs: Record<string, unknown>[] = [];
    registerJobHandler("billing.accruals", async () => { throw new Error("private text"); }, "FEATURE_REVENUE");
    await drainJobs({ now: (() => { let tick = 10; return () => tick++; })(), workerId: "worker" }, {
      ...fake,
      logger: (event) => logs.push(event),
    });
    assert.deepEqual(Object.keys(logs[0]).sort(), [
      "attempt", "code", "detail", "durationMs", "job", "rows", "status", "terminal",
    ]);
    assert.equal(JSON.stringify(logs).includes("private text"), false);
    assert.equal(JSON.stringify(logs).includes(`org:${UUID}`), false);
  });

  /**
   * G-KB-01. Two properties in one place, because they pull against each other:
   * a handler's declared code must reach the log and the tick body so a
   * repeatedly-failing job explains itself, while a thrown error's message —
   * arbitrary domain text — must not, which is what the assertion above plants
   * "private text" to prove.
   */
  it("G-KB-01: a handler's declared failure code reaches the log and the drain result", async () => {
    const thrower = "22222222-2222-4222-8222-222222222222";
    const fake = fakeRepository([job(), job({ id: thrower })]);
    const logs: Record<string, unknown>[] = [];
    let calls = 0;
    registerJobHandler("billing.accruals", async () => {
      calls += 1;
      if (calls === 1) return { status: "failed", code: "KB_SOURCE_SHAPE_UNVERIFIED" };
      throw new Error("private text");
    }, "FEATURE_REVENUE");
    const result = await drainJobs({ workerId: "worker" }, { ...fake, logger: (event) => logs.push(event) });
    assert.deepEqual(result.failures, [
      { attempt: 1, code: "handler_failed", detail: "KB_SOURCE_SHAPE_UNVERIFIED", job: "billing.accruals", terminal: false },
      { attempt: 1, code: "handler_threw", detail: null, job: "billing.accruals", terminal: false },
    ]);
    assert.equal(logs[0].detail, "KB_SOURCE_SHAPE_UNVERIFIED");
    assert.equal(logs[1].detail, null, "a thrown message is never carried as detail");
    assert.equal(JSON.stringify(logs).includes("private text"), false);
    assert.equal(JSON.stringify(result).includes("private text"), false);
  });

  it("run-now validates, enqueues, then drains one row", async () => {
    const fake = fakeRepository();
    const order: string[] = [];
    const result = await runNow("billing.accruals", `org:${UUID}`, "2026-08", {
      drain: async () => {
        order.push("drain");
        return { claimed: 1, failed: 0, retried: 0, skipped: 0, succeeded: 1 };
      },
      repository: {
        ...fake.repository,
        async enqueue(tuple: JobTuple) {
          order.push("enqueue");
          return fake.repository.enqueue(tuple);
        },
      },
    });
    assert.deepEqual(order, ["enqueue", "drain"]);
    assert.equal(result.succeeded, 1);
    await assert.rejects(
      () => runNow("billing.accruals", "global", "2026-08", { drain: async () => result, repository: fake.repository }),
      /JOB_TUPLE_INVALID/,
    );
  });

  it("run-now drains the row it enqueued, never the FIFO head", async () => {
    const OLDER = "22222222-2222-4222-8222-222222222222";
    const fake = fakeRepository([
      job({ id: OLDER, subject: `org:${OLDER}` }),
      job({ id: UUID, subject: `org:${UUID}` }),
    ]);
    const handled: string[] = [];
    registerJobHandler("billing.accruals", async (subject) => {
      handled.push(subject);
      return { status: "ok", rows: 1 };
    }, "FEATURE_REVENUE");
    let drained: string | undefined;
    const result = await runNow("billing.accruals", `org:${UUID}`, "2026-08", {
      drain: (enqueued) => {
        drained = enqueued.id;
        return drainJobs({ jobId: enqueued.id, maxJobs: 1, workerId: "worker" }, fake);
      },
      repository: fake.repository,
    });
    assert.equal(drained, UUID);
    assert.deepEqual(result, { claimed: 1, failed: 0, failures: [], retried: 0, skipped: 0, succeeded: 1 });
    assert.deepEqual(handled, [`org:${UUID}`]);
    assert.deepEqual(fake.events.map((event) => event.kind), ["enqueue", "claimOne", "complete"]);
    assert.equal((fake.events[1].value as { jobId: string }).jobId, UUID);
  });

  it("a targeted drain of a job that is no longer queued claims nothing", async () => {
    const fake = fakeRepository([]);
    const result = await drainJobs({ jobId: UUID, maxJobs: 1, workerId: "worker" }, fake);
    assert.deepEqual(result, { claimed: 0, failed: 0, failures: [], retried: 0, skipped: 0, succeeded: 0 });
    assert.deepEqual(fake.events.map((event) => event.kind), ["claimOne"]);
  });

  /**
   * The drain's own wall clock, which nothing bounded before: the tick's
   * `JOB_TICK_DEADLINE_MS` is read between batches, so a handler already running
   * could only be stopped by the platform killing the whole function — which
   * writes no `fail()`, logs nothing, and takes the schedule result and every
   * later row in the batch with it. Production, 2026-08-22 07:30:32: `GET
   * /api/revenue/jobs/tick` 504, "Task timed out after 300 seconds".
   *
   * Neither the retry flag nor the attempt cap is transcribed here. The first
   * loop discovers where this module makes an ordinary failure terminal, and the
   * deadline path is then asserted to turn terminal at exactly the same attempt —
   * the property being that a deadline is retried on the same schedule as any
   * other failure, whatever that schedule is.
   */
  it("stops a handler that outlives the drain budget and retries it like any other failure", { timeout: 10_000 }, async () => {
    const slower = () => new Promise<{ status: "ok"; rows: number }>((resolve) => {
      setTimeout(() => resolve({ status: "ok", rows: 1 }), 300);
    });

    async function terminalAt(handler: () => Promise<{ status: string; rows?: number }>): Promise<number[]> {
      const terminal: number[] = [];
      for (let attemptCount = 1; attemptCount <= 5; attemptCount += 1) {
        resetJobRegistryForTests();
        const fake = fakeRepository([job({ attemptCount })]);
        registerJobHandler("billing.accruals", handler as never, "FEATURE_REVENUE");
        const result = await drainJobs({ budgetMs: 20, maxJobs: 1, workerId: "worker" }, fake);
        if ((result.failures ?? []).some((failure) => failure.terminal)) terminal.push(attemptCount);
        assert.equal(result.claimed, 1);
      }
      return terminal;
    }

    const ordinary = await terminalAt(async () => ({ status: "failed" }));
    const overdue = await terminalAt(slower);

    assert.ok(ordinary.length > 0, "the module makes an ordinary failure terminal somewhere");
    assert.deepEqual(overdue, ordinary, "a deadline is retried on the module's own schedule");
  });

  it("records a deadline under its own code, distinct from a handler that threw", { timeout: 10_000 }, async () => {
    const fake = fakeRepository([job()]);
    const logs: Record<string, unknown>[] = [];
    registerJobHandler("billing.accruals", () => new Promise((resolve) => {
      setTimeout(() => resolve({ status: "ok", rows: 1 }), 300);
    }), "FEATURE_REVENUE");
    const result = await drainJobs(
      { budgetMs: 20, workerId: "worker" },
      { ...fake, logger: (event) => logs.push(event) },
    );
    const code = (result.failures ?? [])[0]?.code;
    assert.ok(code);
    assert.notEqual(code, "handler_threw", "a budget that ran out is not a handler that threw");
    assert.equal((fake.events.find((event) => event.kind === "fail")?.value as { errorCode: string }).errorCode, code);
    assert.equal(logs[0].code, code);
    // 64 characters is `background_jobs_error_code_short`; a code the column rejects
    // turns a recorded failure back into a silent one.
    assert.ok(code.length >= 1 && code.length <= 64);
  });

  /**
   * Migration 336 counts the attempt at the first `renew`, so a row the drain
   * never starts costs none of its three and its lease expires into migration
   * 251's reclaim. Asserting on `renew` rather than on a count is what ties this
   * to that rule instead of to this scenario's numbers.
   */
  it("hands back rows it has no budget to start without spending their attempt", { timeout: 10_000 }, async () => {
    const second = "22222222-2222-4222-8222-222222222222";
    const third = "33333333-3333-4333-8333-333333333333";
    const fake = fakeRepository([job(), job({ id: second }), job({ id: third })]);
    const renewed: string[] = [];
    const repository = {
      ...fake.repository,
      async renew(input: { jobId: string; leaseSeconds: number; workerId: string }) {
        renewed.push(input.jobId);
        return fake.repository.renew(input);
      },
    };
    registerJobHandler("billing.accruals", async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return { status: "ok", rows: 1 };
    }, "FEATURE_REVENUE");

    const result = await drainJobs({ budgetMs: 50, workerId: "worker" }, { ...fake, repository });

    assert.equal(result.deferred, 2, "the budget is gone by the time the first row's deadline fires");
    assert.deepEqual(renewed, [UUID], "an unstarted row is never renewed, so it never counts an attempt");
    assert.deepEqual(
      fake.events.filter((event) => event.kind === "fail").map((event) => (event.value as { jobId: string }).jobId),
      [UUID],
      "only the row that actually ran is failed; the rest are handed back untouched",
    );
    assert.deepEqual([second, third].filter((id) => renewed.includes(id)), []);
  });

  it("passes only enabled handler names to claims so disabled work stays queued", async () => {
    const fake = fakeRepository();
    await drainJobs({ workerId: "worker" }, {
      ...fake,
      allowedJobs: new Set(["purge.derived"]),
    });
    assert.deepEqual((fake.events[0].value as { allowedJobs: string[] }).allowedJobs, ["purge.derived"]);
  });
});
