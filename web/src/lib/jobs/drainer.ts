import { randomUUID } from "node:crypto";

import { enabledHandlerJobs, getJobHandler } from "./registry.ts";
import { JOB_NAMES } from "./definitions.ts";

import type { JobsRepository, JobName } from "./types.ts";

const MAX_JOBS = 25;
const MAX_ATTEMPTS = 3;
const LEASE_SECONDS = 60;

/**
 * Wall clock a whole drain may spend, measured from entry.
 *
 * `JOB_TICK_DEADLINE_MS` bounds only the tick's *batch loop*: it is read between
 * batches, so it cannot stop work already in flight, and nothing else bounded a
 * drain at all. That left the platform's function ceiling as the only limit, and
 * a ceiling is not a bound — when it fires the process is killed mid-handler, so
 * no `fail()` is written, no failure is logged, the tick's schedule result is
 * lost and every row queued behind the slow one in the same batch never runs.
 * Measured on production 2026-08-22: `GET /api/revenue/jobs/tick` returned 504
 * "Task timed out after 300 seconds" at 07:30:32, and one `analysis.run` handler
 * ran 150,495ms at 08:15:08 — two of those in a batch is the ceiling.
 *
 * A budget the drainer enforces itself turns that into a recorded, retryable
 * `handler_deadline` and lets the rest of the tick finish. It sits below the
 * 300-second route ceiling on purpose, so the drain is what stops rather than
 * the platform; the tick narrows it further from its own elapsed time.
 */
const DEFAULT_BUDGET_MS = 240_000;

/**
 * Thrown into the drain loop by `withDeadline`, never by a handler. The catch
 * below tells it apart from a handler's own throw so the two get different
 * `error_code`s: `handler_deadline` says the work was still running when its
 * budget ran out, which is a different obligation from `handler_threw`.
 */
class JobDeadlineExceeded extends Error {
  constructor() {
    super("JOB_HANDLER_DEADLINE");
    this.name = "JobDeadlineExceeded";
  }
}

async function withDeadline<T>(work: Promise<T>, budgetMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // `Promise.race` subscribes to both, so a handler that rejects after losing
    // the race is still handled and never surfaces as an unhandled rejection.
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new JobDeadlineExceeded()), Math.max(0, budgetMs));
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export type JobLog = Readonly<{
  attempt: number;
  code: string | null;
  /** The handler's own domain code, when it named one (G-KB-01). */
  detail?: string | null;
  durationMs: number;
  job: JobName;
  rows: number;
  status: "ok" | "skipped" | "failed";
  /** True when this attempt burned the last of MAX_ATTEMPTS: the obligation is dead. */
  terminal?: boolean;
}>;

/**
 * One failed attempt, in the shape `handleRevenueTick` already reports schedule
 * failures in. G-KB-01: `failed` was a bare count, so a job failing on every
 * run for weeks and a job succeeding produced tick bodies that differed by one
 * integer nobody was reading.
 */
export type JobDrainFailure = Readonly<{
  attempt: number;
  code: string;
  detail: string | null;
  job: JobName;
  terminal: boolean;
}>;

export type DrainJobsResult = {
  claimed: number;
  failed: number;
  retried: number;
  skipped: number;
  succeeded: number;
  /**
   * Optional so a test double can stay a five-field literal; readers treat an
   * absent list as an empty one.
   */
  failures?: readonly JobDrainFailure[];
  /**
   * Rows leased by this drain that it ran out of budget before starting. They
   * cost no attempt — migration 336 counts the attempt at the first `renew`,
   * which a deferred row never reaches — and their leases expire into migration
   * 251's reclaim, so the obligation stays whole. Present only when non-zero, for
   * the same reason `failures` is optional.
   */
  deferred?: number;
};

type DrainerDependencies = {
  allowedJobs?: ReadonlySet<JobName>;
  logger?: (event: JobLog) => void;
  repository: JobsRepository;
};

type DrainOptions = {
  /** Wall clock this drain may spend in total; see `DEFAULT_BUDGET_MS`. */
  budgetMs?: number;
  /** Drain exactly this queued job (run-now) instead of the FIFO head; nothing else is claimed. */
  jobId?: string;
  maxJobs?: number;
  now?: () => number;
  workerId?: string;
};

function boundedMax(value: number | undefined): number {
  if (value === undefined) return MAX_JOBS;
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(MAX_JOBS, Math.trunc(value)));
}

function retryDelay(attempt: number): number {
  return Math.min(900, 30 * (2 ** Math.max(0, attempt - 1)));
}

/**
 * G-KB-01: the production drainer had no logger at all, so a handler that
 * failed left nothing behind but a row in `background_jobs` nobody queries and
 * a `failed` counter in a 200 response. `vault.reimport_kb` failed on every
 * weekly run from Phase 8 to 2026-08-22 and no line anywhere in the platform
 * said so.
 *
 * One `console.error` per failed attempt is all this needs to be: on Vercel
 * that lands in the deployment's runtime logs, which is the surface the
 * integration session already reads (it is where the fifteen-minute cron
 * cadence was measured for G-R5-OWN-05), and it is searchable by job name. Successful
 * drains stay silent, because a log every fifteen minutes for the ordinary case
 * is the kind of noise that trains people to stop reading.
 */
export function logJobFailure(event: JobLog): void {
  if (event.status !== "failed") return;
  console.error(
    `[jobs] ${event.job} attempt ${event.attempt} ${event.terminal ? "failed terminally" : "failed"}` +
      `: ${event.code ?? "unknown"}${event.detail ? ` (${event.detail})` : ""}` +
      ` after ${event.durationMs}ms`,
  );
}

async function productionDependencies(): Promise<DrainerDependencies> {
  await import("./register.ts");
  const { productionJobsRepository } = await import("./repository.ts");
  return { allowedJobs: enabledHandlerJobs(), logger: logJobFailure, repository: productionJobsRepository() };
}

export async function drainJobs(
  options: DrainOptions = {},
  supplied?: DrainerDependencies,
): Promise<DrainJobsResult> {
  const deps = supplied ?? await productionDependencies();
  const maxJobs = boundedMax(options.maxJobs);
  const workerId = options.workerId ?? randomUUID();
  const clock = options.now ?? Date.now;
  const budgetMs = Number.isFinite(options.budgetMs) ? (options.budgetMs as number) : DEFAULT_BUDGET_MS;
  const openedAt = clock();
  const allowedJobs = [...(deps.allowedJobs ?? new Set(JOB_NAMES))];
  const claimed = options.jobId
    ? await deps.repository.claimOne({ allowedJobs, jobId: options.jobId, leaseSeconds: LEASE_SECONDS, workerId })
    : await deps.repository.claim({ allowedJobs, leaseSeconds: LEASE_SECONDS, maxJobs, workerId });
  const failures: JobDrainFailure[] = [];
  const result: DrainJobsResult = { claimed: claimed.length, failed: 0, failures, retried: 0, skipped: 0, succeeded: 0 };

  for (const row of claimed.slice(0, MAX_JOBS)) {
    const started = clock();
    const remainingMs = budgetMs - (started - openedAt);
    if (remainingMs <= 0) {
      // Deliberately before `renew`: that is where migration 336 counts the
      // attempt, so a row this drain never starts spends none of its three. The
      // lease it is still holding expires into migration 251's reclaim.
      result.deferred = (result.deferred ?? 0) + 1;
      continue;
    }
    let code: string | null = null;
    let detail: string | null = null;
    let terminal = false;
    let rows = 0;
    let status: JobLog["status"] = "failed";
    let attemptCount = row.attemptCount;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    try {
      const handler = getJobHandler(row.job);
      if (!handler) {
        code = "handler_unregistered";
        terminal = true;
        failures.push({ attempt: attemptCount, code, detail: null, job: row.job, terminal });
        await deps.repository.fail({
          errorCode: code,
          jobId: row.id,
          retry: false,
          retryAfterSeconds: 0,
          workerId,
        });
        result.failed += 1;
        continue;
      }
      const renewed = await deps.repository.renew({ jobId: row.id, leaseSeconds: LEASE_SECONDS, workerId });
      if (!renewed.renewed) {
        code = "lease_lost";
        result.failed += 1;
        continue;
      }
      attemptCount = renewed.attemptCount ?? row.attemptCount;
      heartbeat = setInterval(() => {
        void deps.repository.renew({ jobId: row.id, leaseSeconds: LEASE_SECONDS, workerId }).catch(() => undefined);
      }, LEASE_SECONDS * 500);
      const handled = await withDeadline(handler(row.subject, row.window), remainingMs);
      clearInterval(heartbeat);
      heartbeat = null;
      rows = Number.isInteger(handled.rows) && (handled.rows ?? 0) >= 0 ? handled.rows ?? 0 : 0;
      if (handled.status === "ok" || handled.status === "skipped") {
        status = handled.status;
        await deps.repository.complete({
          jobId: row.id,
          rows,
          status: handled.status === "ok" ? "succeeded" : "skipped",
          workerId,
        });
        if (handled.status === "ok") result.succeeded += 1;
        else result.skipped += 1;
      } else {
        code = "handler_failed";
        detail = typeof handled.code === "string" && handled.code.trim() !== "" ? handled.code : null;
        const retry = attemptCount < MAX_ATTEMPTS;
        terminal = !retry;
        failures.push({ attempt: attemptCount, code, detail, job: row.job, terminal });
        await deps.repository.fail({
          errorCode: code,
          jobId: row.id,
          retry,
          retryAfterSeconds: retryDelay(attemptCount),
          workerId,
        });
        if (retry) result.retried += 1;
        else result.failed += 1;
      }
    } catch (error) {
      // A budget that ran out is not a handler that threw: the work may well be
      // fine and simply longer than one invocation can hold, so it keeps the
      // ordinary three-attempt retry and says so in its own code.
      code = error instanceof JobDeadlineExceeded ? "handler_deadline" : "handler_threw";
      // `detail` stays null here on purpose. A thrown error's message is
      // arbitrary text from inside a domain — the drainer test plants
      // "private text" and asserts it never reaches a log line — and this
      // value now travels further than the log, into the tick response body.
      // A handler that wants to be diagnosable returns `{status:"failed", code}`
      // with a closed domain constant instead of throwing.
      const retry = attemptCount < MAX_ATTEMPTS;
      terminal = !retry;
      failures.push({ attempt: attemptCount, code, detail, job: row.job, terminal });
      try {
        await deps.repository.fail({
          errorCode: code,
          jobId: row.id,
          retry,
          retryAfterSeconds: retryDelay(attemptCount),
          workerId,
        });
        if (retry) result.retried += 1;
        else result.failed += 1;
      } catch {
        result.failed += 1;
        code = "finalize_failed";
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      deps.logger?.({
        attempt: attemptCount,
        code,
        detail,
        durationMs: Math.max(0, clock() - started),
        job: row.job,
        rows,
        status,
        terminal,
      });
    }
  }
  return result;
}
