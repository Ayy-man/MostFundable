import "server-only";

import { featureFlag } from "@/lib/env";

import { VaultError, type BankCacheRow, type BankReadModelRow } from "./types.ts";

/**
 * This library's only Supabase seam, in the shape Phase 11's
 * `applications/repository.ts` established.
 *
 * Nothing else under `web/src/lib/vault/` mentions Supabase, so the sync core,
 * the read model and both drivers' mappers are testable against a fake with no
 * database and no environment. The admin client is reached only through a
 * dynamic import inside the function that needs it. `verify-source-gates.mjs`
 * explicitly names this repository whether the import is deferred or static.
 */

const READ_MODEL_COLUMNS =
  "bank_ref,name,products,bureau_pulls,qualification_summary,channel_type,channel_value," +
  "checking_required,checking_deposit_cents,checking_seasoning,rel_manager,rel_manager_tip," +
  "application_questions,source_updated_at,synced_at,heat_level,windows,last_outcome_at," +
  "approved_amount_cents_total,outcome_count_total";

interface PostgresErrorLike {
  code?: string;
  message?: string;
}

interface Result<Row> {
  data: Row | null;
  error: PostgresErrorLike | null;
}

interface Filter<Row> extends PromiseLike<Result<Row[]>> {
  eq(column: string, value: unknown): Filter<Row>;
  order(column: string, options: { ascending: boolean }): Filter<Row>;
  maybeSingle(): PromiseLike<Result<Row>>;
}

interface Db {
  from<Row>(table: string): {
    select(columns: string): Filter<Row>;
    upsert(values: readonly Record<string, unknown>[], options: { onConflict: string }): PromiseLike<Result<Row[]>>;
  };
}

function mapError(error: PostgresErrorLike | null | undefined): VaultError {
  if (error?.code === "42P01" || error?.code === "42501") {
    return new VaultError("configuration_error");
  }
  return new VaultError("failed");
}

/**
 * The seam Phase 6 and Phase 11 both use. With `FEATURE_REAL_AUTH` on the
 * cookie-scoped client carries the caller's JWT and migration 381's policy
 * decides the read; with the flag off — the committed default — the frozen demo
 * session has no JWT, so that client would be `anon`, which 381 revokes
 * outright. The admin client stands in, and the route's own role check is the
 * gate. The catalog is cross-tenant by design, so unlike the tracker there is
 * no per-organization predicate for the service layer to reapply.
 */
async function dataClient(): Promise<Db> {
  if (featureFlag("FEATURE_REAL_AUTH")) {
    const { createClient } = await import("@/lib/supabase/server");
    return (await createClient()) as unknown as Db;
  }
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient() as unknown as Db;
}

/** The sync writes as the job, never as a session. */
async function workerClient(): Promise<Db> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient() as unknown as Db;
}

export interface VaultRepository {
  listBanks(): Promise<readonly BankReadModelRow[]>;
  readBank(bankRef: string): Promise<BankReadModelRow | null>;
  upsertCacheRows(rows: readonly BankCacheRow[]): Promise<number>;
}

export const vaultRepository: VaultRepository = {
  async listBanks() {
    const db = await dataClient();
    const { data, error } = await db
      .from<BankReadModelRow>("bank_read_model")
      .select(READ_MODEL_COLUMNS)
      .order("name", { ascending: true });
    if (error) throw mapError(error);
    return data ?? [];
  },

  async readBank(bankRef) {
    const db = await dataClient();
    const { data, error } = await db
      .from<BankReadModelRow>("bank_read_model")
      .select(READ_MODEL_COLUMNS)
      .eq("bank_ref", bankRef)
      .maybeSingle();
    if (error) throw mapError(error);
    return data ?? null;
  },

  /**
   * Upsert, never delete. A lender that has left VAULT arrives here as a row
   * with `is_active: false`, so migration 383's foreign key never sees an
   * orphan and a client's application history survives the lender leaving.
   */
  async upsertCacheRows(rows) {
    if (rows.length === 0) return 0;
    const db = await workerClient();
    const { error } = await db
      .from<BankCacheRow>("banks_cache")
      .upsert(rows as unknown as Record<string, unknown>[], { onConflict: "bank_ref" });
    if (error) throw mapError(error);
    return rows.length;
  },
};
