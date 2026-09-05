import "server-only";

/**
 * The three things the admin System health panel can actually observe.
 *
 * The panel used to render a fixture list of platform elements, every one of
 * them pinned to a "Not monitored" pill — a health board that reported nothing
 * about the platform's health. These three checks are the ones this deployment
 * can answer honestly: the admin database answers a trivial read, the job queue
 * has completed a tick recently, and each service is on a real driver or a mock
 * one.
 *
 * Everything below the reads is pure and takes its clock, its rows and its
 * environment as arguments, so the thresholds are testable without a database.
 *
 * Nothing here may carry a credential or a provider hostname into the response:
 * the driver tile names services and driver names taken from the frozen driver
 * table, never the environment values that select them, and a failed read is
 * reported as a fixed sentence rather than the database's own error text.
 */

import { resolveDriver, resolveDriverFromSpec, type EnvSource } from "@/lib/env";
import { PLAN_DRIVER_SPEC } from "@/lib/llm/driver";

export type AdminHealthStatus = "ok" | "degraded" | "unknown";

export type AdminHealthCheckId = "database" | "jobs" | "drivers";

export type AdminHealthTile = {
  id: AdminHealthCheckId;
  label: string;
  status: AdminHealthStatus;
  detail: string;
};

export type AdminHealth = { tiles: readonly AdminHealthTile[] };

/**
 * The newest completed tick and the recent failure count, as read off
 * `background_jobs`. `lastCompletedAt` counts only `succeeded` and `skipped`:
 * a tick that failed is not evidence the queue is draining, and it is already
 * counted on the other field.
 */
export type JobQueuePulse = {
  lastCompletedAt: string | null;
  failedLast24h: number;
};

/** One service's resolved driver. `live` is "not the mock fallback". */
export type DriverStatus = { service: string; driver: string; live: boolean };

export type AdminHealthInput = {
  /** `true` when a trivial admin read came back, `false` when it refused, `null` when it was not attempted. */
  database: boolean | null;
  jobs: JobQueuePulse | null;
  drivers: readonly DriverStatus[] | null;
  now: Date;
};

/** Older than this, the newest completed tick stops being evidence of a draining queue. */
export const JOB_STALE_AFTER_MS = 30 * 60 * 1000;

export const JOB_FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Terminal statuses that count as a completed tick. */
export const COMPLETED_JOB_STATUSES = ["succeeded", "skipped"] as const;

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/** A whole-unit age, coarse on purpose: the tile is a pill, not a stopwatch. */
function age(milliseconds: number): string {
  const minutes = Math.max(0, Math.floor(milliseconds / 60_000));
  if (minutes < 60) return plural(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return plural(hours, "hour");
  return plural(Math.floor(hours / 24), "day");
}

function failureClause(failed: number): string {
  return failed === 0
    ? "no failures in the last 24 hours"
    : `${plural(failed, "failure")} in the last 24 hours`;
}

export function databaseTile(reachable: boolean | null): AdminHealthTile {
  if (reachable === null) {
    return {
      id: "database",
      label: "Database",
      status: "unknown",
      detail: "The admin database was not checked on this request.",
    };
  }
  return {
    id: "database",
    label: "Database",
    status: reachable ? "ok" : "degraded",
    detail: reachable
      ? "The service-scoped admin client answered a trivial read."
      : "The service-scoped admin client did not answer a trivial read.",
  };
}

export function jobQueueTile(pulse: JobQueuePulse | null, now: Date): AdminHealthTile {
  if (pulse === null) {
    return {
      id: "jobs",
      label: "Job queue",
      status: "unknown",
      detail: "The background job queue could not be read.",
    };
  }
  const completedAt = pulse.lastCompletedAt === null ? Number.NaN : Date.parse(pulse.lastCompletedAt);
  if (!Number.isFinite(completedAt)) {
    return {
      id: "jobs",
      label: "Job queue",
      status: "unknown",
      detail: `No background job has completed yet · ${failureClause(pulse.failedLast24h)}.`,
    };
  }
  const elapsed = now.getTime() - completedAt;
  const stale = elapsed > JOB_STALE_AFTER_MS;
  return {
    id: "jobs",
    label: "Job queue",
    status: stale ? "degraded" : "ok",
    detail: stale
      ? `Newest completed tick is ${age(elapsed)} old, past the 30-minute threshold · ${failureClause(pulse.failedLast24h)}.`
      : `Newest completed tick ${age(elapsed)} ago · ${failureClause(pulse.failedLast24h)}.`,
  };
}

export function driversTile(drivers: readonly DriverStatus[] | null): AdminHealthTile {
  if (drivers === null || drivers.length === 0) {
    return {
      id: "drivers",
      label: "Drivers",
      status: "unknown",
      detail: "Driver selection could not be resolved from this deployment's environment.",
    };
  }
  const mock = drivers.filter((entry) => !entry.live);
  const live = drivers.filter((entry) => entry.live);
  if (mock.length === 0) {
    return {
      id: "drivers",
      label: "Drivers",
      status: "ok",
      detail: `Live: ${live.map((entry) => `${entry.service} (${entry.driver})`).join(", ")}.`,
    };
  }
  const liveClause = live.length === 0
    ? "none live"
    : `live: ${live.map((entry) => `${entry.service} (${entry.driver})`).join(", ")}`;
  return {
    id: "drivers",
    label: "Drivers",
    status: "degraded",
    detail: `Mock: ${mock.map((entry) => entry.service).join(", ")} · ${liveClause}.`,
  };
}

export function buildAdminHealth(input: AdminHealthInput): AdminHealth {
  return {
    tiles: [
      databaseTile(input.database),
      jobQueueTile(input.jobs, input.now),
      driversTile(input.drivers),
    ],
  };
}

/**
 * The five services this panel reports on, in the order they are shown.
 *
 * `assistant` is the `ai` row of the frozen table and `plan` has its own
 * selector, for the reason `llm/driver.ts` gives at length: sharing one key
 * between the plan engine and the assistants once moved the plan engine onto a
 * path that fails every run.
 */
export function readEnvDrivers(env: EnvSource = process.env): readonly DriverStatus[] | null {
  try {
    const resolved: readonly [string, string][] = [
      ["billing", resolveDriver("billing", env)],
      ["email", resolveDriver("email", env)],
      ["crs", resolveDriver("crs", env)],
      ["plan", resolveDriverFromSpec("plan", PLAN_DRIVER_SPEC, env)],
      ["assistant", resolveDriver("ai", env)],
    ];
    return resolved.map(([service, driver]) => ({ service, driver, live: driver !== "mock" }));
  } catch {
    // A `MisconfiguredDriverError` names environment keys in its message, so it
    // is swallowed here rather than carried into an HTTP body.
    return null;
  }
}

type CountPayload = { count: number | null; error: unknown };
interface CountQuery extends PromiseLike<CountPayload> {
  eq(column: string, value: unknown): CountQuery;
  gte(column: string, value: unknown): CountQuery;
}
type DataPayload = { data: unknown[] | null; error: unknown };
interface DataQuery extends PromiseLike<DataPayload> {
  in(column: string, values: readonly unknown[]): DataQuery;
  order(column: string, options: { ascending: boolean }): DataQuery;
  limit(count: number): DataQuery;
}
interface HealthTable {
  select(columns: string, options: { count: "exact"; head: true }): CountQuery;
  select(columns: string): DataQuery;
}
interface HealthDb {
  from(table: "orgs" | "background_jobs"): HealthTable;
}

async function defaultClient(): Promise<HealthDb> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient() as unknown as HealthDb;
}

export interface HealthRepository {
  /** `false` rather than a throw: an unreachable database is this check's answer, not its error. */
  pingDatabase(): Promise<boolean>;
  readJobPulse(now: Date): Promise<JobQueuePulse | null>;
}

export function createHealthRepository(
  createClient: () => unknown | Promise<unknown> = defaultClient,
): HealthRepository {
  let clientPromise: Promise<HealthDb> | null = null;
  const client = () => (clientPromise ??= Promise.resolve(createClient()).then((value) => value as HealthDb));
  return {
    async pingDatabase() {
      try {
        const db = await client();
        const { error } = await db.from("orgs").select("id", { count: "exact", head: true });
        return !error;
      } catch {
        return false;
      }
    },
    async readJobPulse(now) {
      try {
        const db = await client();
        const since = new Date(now.getTime() - JOB_FAILURE_WINDOW_MS).toISOString();
        const [completed, failed] = await Promise.all([
          db
            .from("background_jobs")
            .select("completed_at")
            .in("status", COMPLETED_JOB_STATUSES)
            .order("completed_at", { ascending: false })
            .limit(1),
          db
            .from("background_jobs")
            .select("id", { count: "exact", head: true })
            .eq("status", "failed")
            .gte("completed_at", since),
        ]);
        if (completed.error || failed.error || !Array.isArray(completed.data)) return null;
        const row = completed.data[0] as Record<string, unknown> | undefined;
        const lastCompletedAt = typeof row?.completed_at === "string" ? row.completed_at : null;
        return { failedLast24h: failed.count ?? 0, lastCompletedAt };
      } catch {
        return null;
      }
    },
  };
}

export interface AdminHealthDependencies {
  pingDatabase(): Promise<boolean>;
  readJobPulse(now: Date): Promise<JobQueuePulse | null>;
  readDrivers(): readonly DriverStatus[] | null;
  now(): Date;
}

export function healthDefaults(): AdminHealthDependencies {
  const repository = createHealthRepository();
  return {
    now: () => new Date(),
    pingDatabase: () => repository.pingDatabase(),
    readDrivers: () => readEnvDrivers(),
    readJobPulse: (now) => repository.readJobPulse(now),
  };
}

export async function readAdminHealth(
  overrides: Partial<AdminHealthDependencies> = {},
): Promise<AdminHealth> {
  const deps = { ...healthDefaults(), ...overrides };
  const now = deps.now();
  const [database, jobs] = await Promise.all([deps.pingDatabase(), deps.readJobPulse(now)]);
  return buildAdminHealth({ database, drivers: deps.readDrivers(), jobs, now });
}
