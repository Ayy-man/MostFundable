/**
 * The drain loop over `outcome_refresh_jobs`.
 *
 * Same shape as `web/src/lib/analysis/worker.ts:260`: injected collaborators, a
 * bounded iteration count, claim → run → fail, and a stop as soon as a claim
 * comes back empty.
 *
 * The queue's real guarantee lives in `public.claim_outcome_refresh_job`, which
 * selects one queued row `for update skip locked`. Two workers running at once
 * therefore cannot receive the same job — provided this file never learns about
 * a job any other way. There is deliberately no list, no peek and no read of
 * the jobs table here: a loop that listed ids and then claimed them by id would
 * hand back the interleaving the database just ruled out.
 */

import { randomUUID } from "node:crypto";

import { ApplicationsError } from "./types.ts";

import type { ApplicationsRepository, ApplicationsWorkerIdentity } from "./ports.ts";
import type { OutcomeRefreshJob } from "./types.ts";

/** A recompute is one bank and a handful of aggregates, so the lease is short. */
export const DEFAULT_LEASE_SECONDS = 60;
export const DEFAULT_RETRY_AFTER_SECONDS = 30;
/**
 * The ceiling on one drain. A job that fails and re-queues is available again
 * immediately in the worst case, so without a bound a single poison job would
 * spin this loop for as long as the process lived.
 */
export const DEFAULT_MAX_ITERATIONS = 25;
/** After this many attempts a failure stops being retried and the job parks. */
export const DEFAULT_MAX_ATTEMPTS = 3;

const PROCESS_WORKER_ID = randomUUID();

export const processWorkerIdentity: ApplicationsWorkerIdentity = Object.freeze({
  workerId(): string {
    return PROCESS_WORKER_ID;
  },
});

export interface OutcomeRefreshWorkerDependencies {
  repository: ApplicationsRepository;
  identity: ApplicationsWorkerIdentity;
}

export interface DrainOutcomeRefreshJobsOptions {
  maxIterations?: number;
  leaseSeconds?: number;
  retryAfterSeconds?: number;
  maxAttempts?: number;
  target?: { bankRef: string; changeId: string };
}

export interface DrainOutcomeRefreshJobsResult {
  claimed: number;
  succeeded: number;
  failed: number;
  pending?: number;
  terminal?: number;
}

async function defaultDependencies(): Promise<OutcomeRefreshWorkerDependencies> {
  const { supabaseApplicationsRepository } = await import("./repository.ts");
  return {
    repository: supabaseApplicationsRepository,
    identity: processWorkerIdentity,
  };
}

function dependencies(
  supplied?: Partial<OutcomeRefreshWorkerDependencies>,
): Promise<OutcomeRefreshWorkerDependencies> {
  if (supplied?.repository !== undefined) {
    return Promise.resolve({
      repository: supplied.repository,
      identity: supplied.identity ?? processWorkerIdentity,
    });
  }
  return defaultDependencies();
}

/**
 * A code short enough for the 64-character column and drawn from this library's
 * closed set, so an error message from Postgres never reaches the jobs table.
 */
function failureCode(error: unknown): string {
  return error instanceof ApplicationsError ? error.code : "worker_failed";
}

async function failJob(
  repository: ApplicationsRepository,
  job: OutcomeRefreshJob,
  workerId: string,
  error: unknown,
  retryAfterSeconds: number,
  maxAttempts: number,
): Promise<void> {
  try {
    await repository.failRefreshJob({
      jobId: job.id,
      workerId,
      errorCode: failureCode(error),
      // `attemptCount` is the count the claim already incremented, so this
      // compares attempts spent against attempts allowed.
      retry: job.attemptCount < maxAttempts,
      retryAfterSeconds,
    });
  } catch {
    // The lease may already have expired and been taken by another worker, in
    // which case the durable row is authoritative and this worker has nothing
    // left to say about the job. Swallowed for the same reason
    // `analysis/worker.ts:230` swallows it: the next bounded drain resolves it.
  }
}

/**
 * Drain the refresh queue.
 *
 * Stops on the first empty claim or on the iteration ceiling. A claim that
 * errors is not a job-level problem — the queue itself is unreachable — so it
 * propagates rather than being retried in a loop that cannot make progress.
 *
 * The feature flag is the caller's gate, not this function's: the routes that
 * drain inline (`maxIterations: 1`) have already answered `503` when the flag
 * is off, and duplicating the check here would need an environment the tests
 * deliberately do without.
 */
export async function drainOutcomeRefreshJobs(
  supplied?: Partial<OutcomeRefreshWorkerDependencies>,
  options: DrainOutcomeRefreshJobsOptions = {},
): Promise<DrainOutcomeRefreshJobsResult> {
  const deps = await dependencies(supplied);
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const leaseSeconds = options.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
  const retryAfterSeconds = options.retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  if (!Number.isInteger(maxIterations) || maxIterations < 0) {
    throw new ApplicationsError("failed");
  }

  const workerId = deps.identity.workerId();
  const result: DrainOutcomeRefreshJobsResult = {
    claimed: 0,
    succeeded: 0,
    failed: 0,
  };

  for (let index = 0; index < maxIterations; index += 1) {
    const job = await deps.repository.claimRefreshJob(workerId, leaseSeconds, options.target);
    // Null is an empty queue, which is the ordinary end of a drain.
    if (job === null) {
      if (options.target) result.pending = 1;
      break;
    }
    if (job.status === "succeeded" || job.status === "failed") {
      result.terminal = 1;
      break;
    }
    result.claimed += 1;

    try {
      await deps.repository.runRefreshJob(job.id, workerId);
      result.succeeded += 1;
    } catch (error) {
      result.failed += 1;
      await failJob(
        deps.repository,
        job,
        workerId,
        error,
        retryAfterSeconds,
        maxAttempts,
      );
    }
  }

  return result;
}
