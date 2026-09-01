import type { JobHandlerResult } from "@/lib/jobs/types";

/** INTERFACES §7's key for J6's bank half. */
export const VAULT_SYNC_BANKS_JOB = "vault.sync_banks" as const;

/** The §7 window for a nightly job: the UTC calendar date. */
export function utcDateWindow(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * The queue's view of J6.
 *
 * The sync itself lives in `@/lib/vault` and is imported dynamically, so this
 * module — which `register.ts` loads at process start through
 * `jobs/register.ts` — pulls in no Supabase client and no driver until a job
 * actually runs.
 *
 * The §7 window is not a parameter here. It keys the job row — one run per UTC
 * date — but the sync itself always reads the whole catalog as it stands now,
 * so a handler that branched on the date would be pretending to a history VAULT
 * does not expose.
 *
 * A run that reads a catalog and writes nothing reports `skipped` rather than
 * `ok`: "the sync ran and VAULT had nothing" and "the sync ran and wrote the
 * catalog" are different facts, and the drainer's row count is where anyone
 * would look to tell them apart.
 */
export async function runVaultSyncBanksJob(subject: string): Promise<JobHandlerResult> {
  if (subject !== "global") return { status: "skipped", rows: 0 };
  const { runVaultSyncBanks } = await import("../index.ts");
  const result = await runVaultSyncBanks();
  return { status: result.written > 0 ? "ok" : "skipped", rows: result.written };
}
