import { registerCadenceProvider, registerJobHandler } from "@/lib/jobs/registry";

import { VAULT_SYNC_BANKS_JOB, runVaultSyncBanksJob, utcDateWindow } from "./sync-banks.ts";

/**
 * J6's registration into Phase 14's shared registry (INTERFACES §7: subject
 * `global`, window `YYYY-MM-DD`, nightly).
 *
 * Both halves carry `FEATURE_VAULT` as their owner flag. With the flag off the
 * scheduler skips the cadence provider entirely — `scheduler.ts` continues past
 * any provider whose owner flags are all off — so no tuple is produced and
 * nothing is enqueued. Registering the pair together is what satisfies
 * `scheduler.test.ts`'s "every job with a handler has a producer" assertion; the
 * flag is what keeps the pair inert until the flip.
 */
registerJobHandler(VAULT_SYNC_BANKS_JOB, runVaultSyncBanksJob, "FEATURE_VAULT");
registerCadenceProvider(
  VAULT_SYNC_BANKS_JOB,
  async (now) => [{ job: VAULT_SYNC_BANKS_JOB, subject: "global", window: utcDateWindow(now) }],
  "FEATURE_VAULT",
);
