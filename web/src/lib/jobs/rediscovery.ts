import { REDISCOVERY_MEMBER_JOBS, validateJobTuple } from "./definitions.ts";
import { composeCadenceProvider, getHandlerOwnerFlags } from "./registry.ts";

import type { CadenceProvider, JobName, JobTuple } from "./types.ts";

/**
 * R5C-02 / R5C-03 / R5D-01 — the rediscovery path for the whole on-demand row-id-window
 * class, wired once from the derived member set rather than three times by hand.
 *
 * A dated cadence rediscovers an obligation by minting the next window. A row-id window has
 * no next window — the tuple identity *is* the row — so `enqueue_background_job` hands the
 * same exhausted tuple back forever and the obligation dies with it. Migration 370 re-arms
 * the outer tuple and its bridged inner row together; this module is the cadence that calls
 * it, and it registers itself for every member of `REDISCOVERY_MEMBER_JOBS`, so a future
 * definition of that shape is covered with no edit here.
 *
 * Registration composes rather than replaces: `notifications.dispatch` already produces
 * queued-outbox tuples, and rediscovery is an additional source for the same job, not a
 * substitute for the domain's own discovery.
 */

type RpcResult = PromiseLike<{ data: unknown; error: unknown }>;
type AdminClient = { rpc(name: string, args: Record<string, unknown>): RpcResult };

async function productionClient(): Promise<AdminClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient() as unknown as AdminClient;
}

export type RediscoveryDependencies = {
  createClient: () => AdminClient | Promise<AdminClient>;
};

export async function rediscoverRowWindowJobs(
  job: JobName,
  now: Date,
  deps: Partial<RediscoveryDependencies> = {},
): Promise<readonly JobTuple[]> {
  const client = await (deps.createClient ?? productionClient)();
  const { data, error } = await client.rpc("rediscover_row_window_jobs", {
    p_jobs: [job],
    p_now: now.toISOString(),
  });
  if (error || !Array.isArray(data)) throw new Error("JOB_REDISCOVERY_READ_FAILED");
  return data.map((row) => {
    const record = (row ?? {}) as Record<string, unknown>;
    if (record.job !== job || typeof record.subject !== "string" || typeof record.window !== "string") {
      throw new Error("JOB_REDISCOVERY_ROW_INVALID");
    }
    // The sweep only ever re-arms a tuple that is already durable, so anything that fails the
    // shared validator here means the row-id window and the frozen pattern have diverged.
    return validateJobTuple({ job, subject: record.subject, window: record.window });
  });
}

export function createRediscoveryProvider(
  job: JobName,
  deps: Partial<RediscoveryDependencies> = {},
): CadenceProvider {
  return async (now) => rediscoverRowWindowJobs(job, now, deps);
}

/**
 * Called once from `register.ts`, after every domain module has registered its handlers, so
 * the owner flags a member's rediscovery runs under are the member's own handler flags. A
 * member with no handler has nothing to rediscover into and is left alone.
 */
export function registerRowWindowRediscovery(deps: Partial<RediscoveryDependencies> = {}): void {
  for (const job of REDISCOVERY_MEMBER_JOBS) {
    const flags = getHandlerOwnerFlags().get(job);
    if (!flags || flags.size === 0) continue;
    composeCadenceProvider(job, createRediscoveryProvider(job, deps), [...flags]);
  }
}
