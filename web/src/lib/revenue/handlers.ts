import { timingSafeEqual } from "node:crypto";

import { isJobName, validateJobTuple } from "@/lib/jobs/definitions";
import { parseAccrualWindow } from "./config.ts";

import type { OperatorIntentReconciliation } from "@/lib/billing/service-operator";
import type { DrainJobsResult, JobDrainFailure } from "@/lib/jobs/drainer";
import type { ScheduleResult } from "@/lib/jobs/scheduler";
import type { JobName } from "@/lib/jobs/types";
import type { RevenueKpis, RevenueRpcClient } from "./types.ts";

const privateHeaders = { "Cache-Control": "private, no-store" };

/**
 * The same fact as `export const maxDuration` in the tick route, which has to be
 * a literal for Next.js to read it out of the build output. `routes.test.ts`
 * asserts the two agree rather than trusting this comment.
 */
export const TICK_FUNCTION_LIMIT_MS = 300_000;

/**
 * Held back from the drain for everything else the tick owes: the schedule step
 * and the operator-intent reconciliation that both run before it, cold start,
 * and writing the response. Without it the drain would budget itself right up to
 * the platform ceiling and lose the race it exists to win.
 */
const TICK_DRAIN_RESERVE_MS = 60_000;

type AdminSession = { role: "platform_admin" };

type RevenueHandlerDependencies = {
  createClient: () => Promise<RevenueRpcClient>;
  drain: (maxJobs: number, budgetMs: number) => Promise<DrainJobsResult>;
  env: Readonly<Record<string, string | undefined>>;
  now: () => Date;
  monotonicNow: () => number;
  readKpis: (window: string, client: RevenueRpcClient) => Promise<RevenueKpis>;
  requirePlatformAdmin: () => Promise<AdminSession>;
  runNow: (job: JobName, subject: string, window: string) => Promise<DrainJobsResult>;
  schedule: (now: Date) => Promise<ScheduleResult>;
  /**
   * R5C-06: operator subscription intents reach `created`, `failed` or `review` on a tick
   * rather than only inside a later `POST /api/billing/subscription`. Job names are frozen
   * (INTERFACES §7), so this is a tick step and not a new catalog job.
   */
  reconcileOperatorIntents: () => Promise<OperatorIntentReconciliation>;
};

const NO_OPERATOR_INTENTS: OperatorIntentReconciliation = {
  completed: 0, examined: 0, failed: 0, parked: 0, unresolved: 0,
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { headers: privateHeaders, status });
}

export function revenueFeatureOffResponse(): Response {
  return new Response(null, { status: 404 });
}

function authResponse(error: unknown): Response | null {
  if (!error || typeof error !== "object") return null;
  const status = (error as { status?: unknown }).status;
  if (status === 401) return json({ error: { code: "unauthenticated" } }, 401);
  if (status === 403) return json({ error: { code: "forbidden" } }, 403);
  return null;
}

async function defaultRequirePlatformAdmin(): Promise<AdminSession> {
  const { requireRole } = await import("@/lib/auth/session");
  await requireRole("platform_admin");
  return { role: "platform_admin" };
}

async function defaultCreateClient(): Promise<RevenueRpcClient> {
  const { createClient } = await import("@/lib/supabase/server");
  return await createClient() as unknown as RevenueRpcClient;
}

const defaults: RevenueHandlerDependencies = {
  createClient: defaultCreateClient,
  async drain(maxJobs, budgetMs) {
    const { drainJobs } = await import("@/lib/jobs/drainer");
    return drainJobs({ budgetMs, maxJobs });
  },
  env: process.env,
  now: () => new Date(),
  monotonicNow: Date.now,
  async readKpis(window, client) {
    return (await import("./kpis.ts")).readRevenueKpis(window, client);
  },
  requirePlatformAdmin: defaultRequirePlatformAdmin,
  async runNow(job, subject, window) {
    return (await import("@/lib/jobs/run-now")).runNow(job, subject, window);
  },
  async schedule(now) {
    return (await import("@/lib/jobs/scheduler")).enqueueDueJobs(now);
  },
  async reconcileOperatorIntents() {
    const { featureFlag } = await import("@/lib/env");
    if (!featureFlag("FEATURE_BILLING")) return NO_OPERATOR_INTENTS;
    const { reconcileStaleOperatorIntents } = await import("@/lib/billing/service-operator");
    return reconcileStaleOperatorIntents();
  },
};

function withDefaults(overrides: Partial<RevenueHandlerDependencies>): RevenueHandlerDependencies {
  return { ...defaults, ...overrides };
}

function currentUtcMonth(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function handleRevenueKpis(
  request: Request,
  overrides: Partial<RevenueHandlerDependencies> = {},
): Promise<Response> {
  const deps = withDefaults(overrides);
  try {
    await deps.requirePlatformAdmin();
  } catch (error) {
    return authResponse(error) ?? json({ error: { code: "internal_error" } }, 500);
  }
  const requested = new URL(request.url).searchParams.get("window") ?? currentUtcMonth(deps.now());
  let window: string;
  try {
    parseAccrualWindow(requested);
    window = requested;
  } catch {
    return json({ error: { code: "window_invalid" } }, 400);
  }
  try {
    const kpis = await deps.readKpis(window, await deps.createClient());
    return json({
      complete: kpis.complete,
      enabled: true,
      incompleteCodes: kpis.incompleteCodes,
      monitoringShareTotalCents: kpis.monitoringShareTotalCents,
      saasReferralTotalCents: kpis.saasReferralTotalCents,
    });
  } catch {
    return json({ error: { code: "revenue_read_failed" } }, 500);
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export async function handleRevenueRunNow(
  request: Request,
  overrides: Partial<RevenueHandlerDependencies> = {},
): Promise<Response> {
  const deps = withDefaults(overrides);
  try {
    await deps.requirePlatformAdmin();
  } catch (error) {
    return authResponse(error) ?? json({ error: { code: "internal_error" } }, 500);
  }
  let body: Record<string, unknown> | null = null;
  try {
    body = record(await request.json());
  } catch {
    // Mapped to one closed bad-request shape below.
  }
  if (!body || Object.keys(body).sort().join(",") !== "job,subject,window"
    || typeof body.job !== "string" || !isJobName(body.job)
    || typeof body.subject !== "string" || typeof body.window !== "string") {
    return json({ error: { code: "job_tuple_invalid" } }, 400);
  }
  try {
    const tuple = validateJobTuple({ job: body.job, subject: body.subject, window: body.window });
    const result = await deps.runNow(tuple.job, tuple.subject, tuple.window);
    return json({
      claimed: result.claimed,
      completed: result.succeeded + result.skipped,
      failed: result.failed,
      retried: result.retried,
      status: result.failed > 0 ? "failed" : result.retried > 0 ? "retrying" : "complete",
    });
  } catch (error) {
    if (error instanceof Error && error.message === "JOB_TUPLE_INVALID") {
      return json({ error: { code: "job_tuple_invalid" } }, 400);
    }
    return json({ error: { code: "job_run_failed" } }, 500);
  }
}

function exactBearer(header: string | null, configured: string): boolean {
  const expected = Buffer.from(`Bearer ${configured}`, "utf8");
  const received = Buffer.from(header ?? "", "utf8");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export async function handleRevenueTick(
  request: Request,
  overrides: Partial<RevenueHandlerDependencies> = {},
): Promise<Response> {
  const deps = withDefaults(overrides);
  // Taken before the schedule and reconciliation steps, because the drain's
  // budget is what is left of the invocation once those have run, not what was
  // available when they started.
  const invokedAt = deps.monotonicNow();
  const secret = deps.env.CRON_SECRET;
  if (!secret?.trim()) return json({ error: { code: "cron_unconfigured" } }, 503);
  if (!exactBearer(request.headers.get("authorization"), secret)) {
    return json({ error: { code: "unauthorized" } }, 401);
  }
  // R4C-04: scheduling and draining are independent obligations. A producer that fails must
  // not stop work already durable in `background_jobs` from running, so the schedule is
  // isolated here and its failures are reported alongside the drain rather than instead of it.
  let scheduled: ScheduleResult;
  try {
    scheduled = await deps.schedule(deps.now());
  } catch {
    scheduled = {
      failures: [{ count: 1, job: "scheduler", reason: "JOB_SCHEDULE_FAILED", scope: "scheduler" }],
      jobs: 0,
      providers: 0,
    };
  }
  // R5C-06: isolated for the same reason the schedule is — an unreachable billing provider
  // must not stop durable work from draining.
  let operatorIntents: OperatorIntentReconciliation;
  try {
    operatorIntents = await deps.reconcileOperatorIntents();
  } catch {
    operatorIntents = { ...NO_OPERATOR_INTENTS, failed: 1 };
  }
  try {
    const configuredDeadline = Number(deps.env.JOB_TICK_DEADLINE_MS);
    const deadlineMs = Number.isInteger(configuredDeadline) && configuredDeadline > 0 && configuredDeadline <= 55_000
      ? configuredDeadline
      : 45_000;
    const startedAt = deps.monotonicNow();
    // What is left of the invocation for draining. The batch deadline above and
    // this are different bounds and were conflated before: the deadline decides
    // whether to start *another batch* and is read only between batches, so it
    // could never stop a handler already running. This one travels into the
    // drain and bounds the work itself.
    const drainBudgetMs = () =>
      TICK_FUNCTION_LIMIT_MS - TICK_DRAIN_RESERVE_MS - (deps.monotonicNow() - invokedAt);
    const total: DrainJobsResult = { claimed: 0, failed: 0, retried: 0, skipped: 0, succeeded: 0 };
    const drainFailures: JobDrainFailure[] = [];
    let batches = 0;
    let batchClaimed = 0;
    let deferred = 0;
    do {
      const drained = await deps.drain(25, Math.max(0, drainBudgetMs()));
      batches += 1;
      batchClaimed = drained.claimed;
      total.claimed += drained.claimed;
      total.failed += drained.failed;
      total.retried += drained.retried;
      total.skipped += drained.skipped;
      total.succeeded += drained.succeeded;
      deferred += drained.deferred ?? 0;
      drainFailures.push(...(drained.failures ?? []));
    } while (
      batchClaimed === 25
      && deps.monotonicNow() - startedAt < deadlineMs
      && drainBudgetMs() > 0
    );
    const counts = {
      batches,
      claimed: total.claimed,
      completed: total.succeeded + total.skipped,
      deferred,
      drainFailures,
      failed: total.failed,
      operatorIntents,
      // A deferred row is work this invocation leased and handed back untouched,
      // which is the same thing a full batch means: come back.
      remaining: batchClaimed === 25 || deferred > 0,
      retried: total.retried,
      scheduled: scheduled.jobs,
      scheduleFailures: scheduled.failures,
    };
    // A partial schedule is retryable, and the counts stay in the body so the retry is
    // informed rather than blind.
    if (scheduled.failures.length > 0) {
      return json({ ...counts, error: { code: "job_schedule_partial" } }, 503);
    }
    // G-KB-01: a job that burned its last attempt is dead until somebody acts. Reporting
    // that inside a 200 is what let `vault.reimport_kb` fail every week from Phase 8 with
    // nothing anywhere saying so, so a terminal drain failure fails the tick — the Vercel
    // cron dashboard then shows a failed invocation, which is the same place the fifteen-
    // minute cadence was measured from. A retryable failure stays a 200: the next tick is
    // the response to it, and 503ing on ordinary contention would train people to ignore
    // the signal. This deliberately mirrors the partial-schedule branch above rather than
    // inventing a second convention.
    if (drainFailures.some((failure) => failure.terminal)) {
      return json({ ...counts, error: { code: "job_drain_terminal" } }, 503);
    }
    return json(counts);
  } catch {
    return json({ error: { code: "job_tick_failed" } }, 500);
  }
}
