import "server-only";

import { parseSettingRow } from "./settings.ts";

import type {
  GovernedSettingKey,
  SettingsRepository,
  SettingRow,
} from "./settings-types.ts";

type RawSettingRow = {
  key: unknown;
  value: unknown;
  updated_by: unknown;
  updated_at: unknown;
};

interface SettingsDb {
  from(table: "settings"): {
    select(columns: "key,value,updated_by,updated_at"): {
      in(column: "key", keys: readonly GovernedSettingKey[]): PromiseLike<{
        data: RawSettingRow[] | null;
        error: unknown;
      }>;
    };
  };
  rpc(name: "admin_set_setting", args: {
    p_key: GovernedSettingKey;
    p_value: number;
    p_actor: string;
  }): PromiseLike<{ data: RawSettingRow[] | null; error: unknown }>;
}

export function createSettingsRepository(
  createClient?: () => unknown | Promise<unknown>,
): SettingsRepository {
  let db: Promise<SettingsDb> | null = null;
  const client = () => (db ??= (async () => {
    if (createClient) return await createClient() as SettingsDb;
    const { createAdminClient } = await import("@/lib/supabase/admin");
    return createAdminClient() as unknown as SettingsDb;
  })());
  return {
    async read(keys): Promise<readonly SettingRow[]> {
      if (keys.length === 0) return Object.freeze([]);
      const { data, error } = await (await client())
        .from("settings")
        .select("key,value,updated_by,updated_at")
        .in("key", keys);
      if (error) throw new Error("ADMIN_SETTINGS_READ_FAILED");
      return Object.freeze((data ?? []).map(parseSettingRow));
    },
    async write(key, value, actorId): Promise<SettingRow> {
      const { data, error } = await (await client()).rpc("admin_set_setting", {
        p_key: key,
        p_value: value,
        p_actor: actorId,
      });
      if (error) throw new Error("ADMIN_SETTINGS_WRITE_FAILED");
      if (!data || data.length !== 1) throw new Error("ADMIN_SETTINGS_RESULT_INVALID");
      return parseSettingRow(data[0]);
    },
  };
}
