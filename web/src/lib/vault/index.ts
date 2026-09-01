import "server-only";

import { fixtureVaultDriver } from "./fixture-driver.ts";
import { toDetailPayload, toListRow } from "./read-model.ts";
import { vaultRepository, type VaultRepository } from "./repository.ts";
import { planSync } from "./sync.ts";
import {
  VaultError,
  type BankDetailPayload,
  type BankListRow,
  type VaultDriver,
} from "./types.ts";

/**
 * The BANK VAULT read model's public surface: two reads for the routes and one
 * sync for the job. Everything else in this directory is an implementation
 * detail, and nothing outside it may import those files.
 *
 * §10's "the driver is chosen once, at module load" is satisfied by the const
 * below. No caller anywhere branches on which driver is in play — that is the
 * whole point of the convention, and it is why the fixture arm and the real arm
 * exercise the same sync core.
 */

let driverPromise: Promise<VaultDriver> | null = null;

async function vaultDriver(): Promise<VaultDriver> {
  if (driverPromise === null) {
    driverPromise = (async () => {
      const { vaultDriverName } = await import("./env.ts");
      if (vaultDriverName() === "fixture") return fixtureVaultDriver;
      const { supabaseVaultDriver } = await import("./supabase-driver.ts");
      return supabaseVaultDriver;
    })();
  }
  return driverPromise;
}

export async function listBanks(
  deps: { repository: VaultRepository } = { repository: vaultRepository },
): Promise<BankListRow[]> {
  const rows = await deps.repository.listBanks();
  return rows.map(toListRow);
}

export async function readBank(
  bankRef: string,
  deps: { repository: VaultRepository } = { repository: vaultRepository },
): Promise<BankDetailPayload> {
  const row = await deps.repository.readBank(bankRef);
  if (row === null) throw new VaultError("not_found");
  return toDetailPayload(row);
}

export interface VaultSyncResult {
  driver: VaultDriver["name"];
  read: number;
  written: number;
  rejected: { bankRef: string; reason: string }[];
}

/**
 * J6's body. Reads the whole catalog from whichever driver §10 selected,
 * normalizes it through the shared sync core and upserts it.
 *
 * Idempotent by construction rather than by bookkeeping: the same catalog
 * produces the same rows, and the upsert is keyed on the lender handle. The
 * job's own (job, subject, window) key stops a second run inside one night; this
 * makes a second run harmless if one happens anyway.
 */
export async function runVaultSyncBanks(
  deps: {
    driver?: VaultDriver;
    now?: Date;
    repository?: VaultRepository;
  } = {},
): Promise<VaultSyncResult> {
  const driver = deps.driver ?? (await vaultDriver());
  const repository = deps.repository ?? vaultRepository;
  const records = await driver.listBanks();
  const plan = planSync(records, {
    source: driver.name === "fixture" ? "fixture" : "vault",
    syncedAt: (deps.now ?? new Date()).toISOString(),
  });
  const written = await repository.upsertCacheRows(plan.rows);
  return { driver: driver.name, read: records.length, written, rejected: plan.rejected };
}

export { VaultError } from "./types.ts";
export type {
  BankApplicationQuestion,
  BankChannel,
  BankDetailPayload,
  BankHeatLevel,
  BankListRow,
  BankWindowKey,
  BankWindowSummary,
} from "./types.ts";
