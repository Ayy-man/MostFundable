import "server-only";

import {
  AdminBankCatalogError,
  type AdminBankCatalogContent,
  type AdminBankCatalogCreateInput,
  type AdminBankCatalogEntry,
  type AdminBankCatalogPayload,
  type AdminBankCatalogRepository,
} from "./bank-catalog-types.ts";
import {
  adminBankCatalogPayload,
  parseAdminBankCatalogDatabaseRow,
} from "./bank-catalog-validate.ts";

export const ADMIN_BANK_CATALOG_COLUMNS =
  "catalog_id,bank_ref,name,products,bureau_pulls,qualification_summary," +
  "channel_type,channel_value,checking_required,checking_deposit_cents," +
  "checking_seasoning,rel_manager,rel_manager_tip,application_questions," +
  "source_updated_at,is_active,source_is_active,source,has_override," +
  "outcome_referenced,synced_at,updated_at";

type DatabaseError = { code?: string; message?: string } | null;
type Result = { data: unknown[] | null; error: DatabaseError };

interface CatalogQuery extends PromiseLike<Result> {
  order(column: string, options: { ascending: boolean }): CatalogQuery;
}

interface CatalogDatabase {
  from(table: "admin_bank_catalog_read_model"): {
    select(columns: string): CatalogQuery;
  };
  rpc(
    name:
      | "admin_create_bank_catalog_entry"
      | "admin_set_bank_catalog_status"
      | "admin_update_bank_catalog_entry",
    args: {
      p_actor: string;
      p_bank_ref: string;
      p_is_active?: boolean;
      p_payload?: AdminBankCatalogPayload;
    },
  ): PromiseLike<Result>;
}

function mappedError(error: DatabaseError, operation: "read" | "write"): AdminBankCatalogError {
  const message = error?.message ?? "";
  if (error?.code === "23505" || message.includes("BANK_CATALOG_ALREADY_EXISTS")) {
    return new AdminBankCatalogError(409, "bank_catalog_already_exists");
  }
  if (error?.code === "P0002" || message.includes("BANK_CATALOG_NOT_FOUND")) {
    return new AdminBankCatalogError(404, "bank_catalog_not_found");
  }
  if (error?.code === "22023" || message.includes("BANK_CATALOG_INPUT_INVALID")) {
    return new AdminBankCatalogError(400, "bank_catalog_input_invalid");
  }
  if (error?.code === "42501" || message.includes("BANK_CATALOG_ACTOR_FORBIDDEN")) {
    return new AdminBankCatalogError(403, "forbidden");
  }
  return new AdminBankCatalogError(500, `bank_catalog_${operation}_failed`);
}

function one(data: unknown[] | null): AdminBankCatalogEntry {
  if (!Array.isArray(data) || data.length !== 1) {
    throw new AdminBankCatalogError(500, "bank_catalog_result_invalid");
  }
  try {
    return parseAdminBankCatalogDatabaseRow(data[0]);
  } catch {
    throw new AdminBankCatalogError(500, "bank_catalog_result_invalid");
  }
}

export function createAdminBankCatalogRepository(
  createClient?: () => unknown | Promise<unknown>,
): AdminBankCatalogRepository {
  let database: Promise<CatalogDatabase> | null = null;
  const db = () => (database ??= (async () => {
    if (createClient) return await createClient() as CatalogDatabase;
    const { createAdminClient } = await import("@/lib/supabase/admin");
    return createAdminClient() as unknown as CatalogDatabase;
  })());

  async function write(
    name:
      | "admin_create_bank_catalog_entry"
      | "admin_set_bank_catalog_status"
      | "admin_update_bank_catalog_entry",
    args: {
      p_actor: string;
      p_bank_ref: string;
      p_is_active?: boolean;
      p_payload?: AdminBankCatalogPayload;
    },
  ): Promise<AdminBankCatalogEntry> {
    const { data, error } = await (await db()).rpc(name, args);
    if (error) throw mappedError(error, "write");
    return one(data);
  }

  return {
    async list() {
      const { data, error } = await (await db())
        .from("admin_bank_catalog_read_model")
        .select(ADMIN_BANK_CATALOG_COLUMNS)
        .order("name", { ascending: true })
        .order("bank_ref", { ascending: true });
      if (error) throw mappedError(error, "read");
      try {
        return Object.freeze((data ?? []).map(parseAdminBankCatalogDatabaseRow));
      } catch {
        throw new AdminBankCatalogError(500, "bank_catalog_result_invalid");
      }
    },

    async create(actorId: string, input: AdminBankCatalogCreateInput) {
      return write("admin_create_bank_catalog_entry", {
        p_actor: actorId,
        p_bank_ref: input.bankRef,
        p_payload: adminBankCatalogPayload(input),
      });
    },

    async update(actorId: string, bankRef: string, content: AdminBankCatalogContent) {
      return write("admin_update_bank_catalog_entry", {
        p_actor: actorId,
        p_bank_ref: bankRef,
        p_payload: adminBankCatalogPayload(content),
      });
    },

    async setStatus(actorId: string, bankRef: string, isActive: boolean) {
      return write("admin_set_bank_catalog_status", {
        p_actor: actorId,
        p_bank_ref: bankRef,
        p_is_active: isActive,
      });
    },
  };
}
