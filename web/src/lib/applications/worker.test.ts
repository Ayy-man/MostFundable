import assert from "node:assert/strict";
import { test } from "node:test";

import { drainOutcomeRefreshJobs } from "./worker.ts";
import { ApplicationsError } from "./types.ts";

import type { ApplicationsRepository, ApplicationsWorkerIdentity } from "./ports.ts";
import type { FailRefreshJobInput, OutcomeRefreshJob } from "./types.ts";

const WORKER: ApplicationsWorkerIdentity = Object.freeze({
  workerId: () => "worker-a",
});

function job(id: string, attemptCount = 0): OutcomeRefreshJob {
  return {
    id,
    bankRef: "bank-queue",
    changeId: `change-${id}`,
    subject: "bank:bank-queue",
    window: `change:change-${id}`,
    idempotencyKey: `outcomes.refresh_stats|bank:bank-queue|change:change-${id}`,
    status: "queued",
    attemptCount,
    errorCode: null,
  };
}

interface QueueRepository {
  repository: ApplicationsRepository;
  /** Every repository method the worker touched, in order. */
  calls: string[];
  claimed: string[];
  failures: FailRefreshJobInput[];
}

interface QueueOptions {
  queued: OutcomeRefreshJob[];
  /** Ids whose run throws. */
  failing?: Set<string>;
  /** When true a claimed job goes straight back on the queue after a failure. */
  requeue?: boolean;
}

/**
 * A queue that models what the database guarantees and nothing else.
 *
 * `claimRefreshJob` removes its row before it yields, which is the TypeScript
 * shape of `for update skip locked`: two callers in flight at the same time
 * cannot be handed the same row. Every method the worker is not supposed to use
 * records the call and throws, so "the worker only learns about a job through
 * claim" is checked rather than assumed.
 */
function createQueueRepository(options: QueueOptions): QueueRepository {
  const queue = [...options.queued];
  const failing = options.failing ?? new Set<string>();
  const calls: string[] = [];
  const claimed: string[] = [];
  const failures: FailRefreshJobInput[] = [];

  function forbidden(name: string): never {
    calls.push(name);
    throw new Error(`the drain loop must not call ${name}`);
  }

  const repository: ApplicationsRepository = {
    listApplications: () => forbidden("listApplications"),
    readApplication: () => forbidden("readApplication"),
    createApplication: () => forbidden("createApplication"),
    updateApplication: () => forbidden("updateApplication"),
    listNotes: () => forbidden("listNotes"),
    addNote: () => forbidden("addNote"),
    recordOutcome: () => forbidden("recordOutcome"),
    readOutcome: () => forbidden("readOutcome"),
    listOutcomes: () => forbidden("listOutcomes"),
    readReview: () => forbidden("readReview"),
    listReviews: () => forbidden("listReviews"),
    listPendingReviews: () => forbidden("listPendingReviews"),
    reviewOutcome: () => forbidden("reviewOutcome"),
    readBankStats: () => forbidden("readBankStats"),
    listBankStats: () => forbidden("listBankStats"),
    listNotifications: () => forbidden("listNotifications"),
    enqueueRefreshJob: () => forbidden("enqueueRefreshJob"),
    listWritebackOutbox: () => forbidden("listWritebackOutbox"),
    readWriteback: () => forbidden("readWriteback"),
    markWriteback: () => forbidden("markWriteback"),

    async claimRefreshJob(workerId) {
      calls.push("claimRefreshJob");
      // The row leaves the queue before the first await, so a second caller
      // interleaving here can never be handed it.
      const next = queue.shift();
      await Promise.resolve();
      if (next === undefined) return null;
      claimed.push(`${workerId}:${next.id}`);
      return { ...next, status: "running", attemptCount: next.attemptCount + 1 };
    },

    async runRefreshJob(jobId) {
      calls.push("runRefreshJob");
      if (failing.has(jobId)) throw new ApplicationsError("conflict");
      return { ...job(jobId), status: "succeeded" };
    },

    async failRefreshJob(input) {
      calls.push("failRefreshJob");
      failures.push(input);
      if (input.retry && options.requeue === true) {
        queue.push(job(input.jobId, 1));
      }
      return { ...job(input.jobId), status: input.retry ? "queued" : "failed" };
    },
  };

  return { repository, calls, claimed, failures };
}

test("an empty queue drains in one claim and stops", async () => {
  const queue = createQueueRepository({ queued: [] });

  const result = await drainOutcomeRefreshJobs(
    { repository: queue.repository, identity: WORKER },
    { maxIterations: 10 },
  );

  assert.deepEqual(result, { claimed: 0, succeeded: 0, failed: 0 });
  assert.deepEqual(queue.calls, ["claimRefreshJob"], "one claim, then out");
});

test("three queued jobs drain in three, then the fourth claim ends it", async () => {
  const queue = createQueueRepository({
    queued: [job("job-1"), job("job-2"), job("job-3")],
  });

  const result = await drainOutcomeRefreshJobs(
    { repository: queue.repository, identity: WORKER },
    { maxIterations: 10 },
  );

  assert.deepEqual(result, { claimed: 3, succeeded: 3, failed: 0 });
  assert.deepEqual(queue.claimed, [
    "worker-a:job-1",
    "worker-a:job-2",
    "worker-a:job-3",
  ]);
  assert.equal(queue.calls.filter((name) => name === "claimRefreshJob").length, 4);
});

test("a run that throws fails the job with a retry and the loop carries on", async () => {
  const queue = createQueueRepository({
    queued: [job("job-1"), job("job-2"), job("job-3")],
    failing: new Set(["job-2"]),
  });

  const result = await drainOutcomeRefreshJobs(
    { repository: queue.repository, identity: WORKER },
    { maxIterations: 10, retryAfterSeconds: 5 },
  );

  assert.deepEqual(result, { claimed: 3, succeeded: 2, failed: 1 });
  assert.equal(queue.failures.length, 1);
  assert.deepEqual(queue.failures[0], {
    jobId: "job-2",
    workerId: "worker-a",
    // The library's own closed code set, never a Postgres message.
    errorCode: "conflict",
    retry: true,
    retryAfterSeconds: 5,
  });
});

test("a job on its last attempt is failed without a retry", async () => {
  const queue = createQueueRepository({
    // `claim` increments, so an attempt count of 2 arrives at the loop as 3.
    queued: [job("job-poison", 2)],
    failing: new Set(["job-poison"]),
  });

  const result = await drainOutcomeRefreshJobs(
    { repository: queue.repository, identity: WORKER },
    { maxIterations: 5, maxAttempts: 3 },
  );

  assert.deepEqual(result, { claimed: 1, succeeded: 0, failed: 1 });
  assert.equal(queue.failures[0]?.retry, false, "the attempts are spent");
});

test("a job that keeps re-queuing stops at the iteration ceiling", async () => {
  const queue = createQueueRepository({
    queued: [job("job-spin")],
    failing: new Set(["job-spin"]),
    requeue: true,
  });

  const result = await drainOutcomeRefreshJobs(
    { repository: queue.repository, identity: WORKER },
    { maxIterations: 4, maxAttempts: 100 },
  );

  // Without the ceiling this repository would hand the same job back forever.
  assert.deepEqual(result, { claimed: 4, succeeded: 0, failed: 4 });
  assert.equal(queue.calls.filter((name) => name === "claimRefreshJob").length, 4);
});

test("a failing fail call does not take the drain down with it", async () => {
  const queue = createQueueRepository({
    queued: [job("job-1"), job("job-2")],
    failing: new Set(["job-1"]),
  });
  const repository: ApplicationsRepository = {
    ...queue.repository,
    failRefreshJob() {
      // The lease expired and another worker owns the row: `55000`.
      return Promise.reject(new ApplicationsError("conflict"));
    },
  };

  const result = await drainOutcomeRefreshJobs(
    { repository, identity: WORKER },
    { maxIterations: 5 },
  );

  assert.deepEqual(result, { claimed: 2, succeeded: 1, failed: 1 });
});

test("two concurrent drains never claim the same job", async () => {
  const queue = createQueueRepository({
    queued: [job("job-1"), job("job-2"), job("job-3"), job("job-4"), job("job-5"), job("job-6")],
  });
  const second: ApplicationsWorkerIdentity = Object.freeze({
    workerId: () => "worker-b",
  });

  const [left, right] = await Promise.all([
    drainOutcomeRefreshJobs(
      { repository: queue.repository, identity: WORKER },
      { maxIterations: 10 },
    ),
    drainOutcomeRefreshJobs(
      { repository: queue.repository, identity: second },
      { maxIterations: 10 },
    ),
  ]);

  assert.equal(left.claimed + right.claimed, 6);
  assert.equal(left.succeeded + right.succeeded, 6);

  const ids = queue.claimed.map((entry) => entry.split(":")[1]);
  assert.equal(new Set(ids).size, 6, "skip locked must not hand a row out twice");
  assert.ok(left.claimed > 0 && right.claimed > 0, "both workers did some of it");
});

test("the worker learns about a job only through claim", async () => {
  const queue = createQueueRepository({
    queued: [job("job-1"), job("job-2")],
    failing: new Set(["job-2"]),
  });

  await drainOutcomeRefreshJobs(
    { repository: queue.repository, identity: WORKER },
    { maxIterations: 5 },
  );

  // A list-then-claim loop would undo the database's skip-locked guarantee in
  // TypeScript, so the set of methods the drain touches is the assertion.
  assert.deepEqual(
    [...new Set(queue.calls)].sort(),
    ["claimRefreshJob", "failRefreshJob", "runRefreshJob"],
  );
});

test("a claim that fails outright stops the drain rather than spinning", async () => {
  const queue = createQueueRepository({ queued: [job("job-1")] });
  const repository: ApplicationsRepository = {
    ...queue.repository,
    claimRefreshJob() {
      return Promise.reject(new ApplicationsError("forbidden"));
    },
  };

  await assert.rejects(
    drainOutcomeRefreshJobs({ repository, identity: WORKER }, { maxIterations: 5 }),
    (error: unknown) => {
      assert.ok(error instanceof ApplicationsError);
      assert.equal(error.code, "forbidden");
      return true;
    },
  );
});

test("a negative iteration ceiling is refused rather than treated as infinite", async () => {
  const queue = createQueueRepository({ queued: [job("job-1")] });

  await assert.rejects(
    drainOutcomeRefreshJobs(
      { repository: queue.repository, identity: WORKER },
      { maxIterations: -1 },
    ),
    (error: unknown) => error instanceof ApplicationsError,
  );
  assert.deepEqual(queue.calls, []);
});
