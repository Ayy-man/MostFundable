import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/types";
import { publicEnv } from "@/lib/env";

function requireServerConfig(value: string | undefined, key: string): string {
  if (!value?.trim()) {
    throw new Error(`Missing ${key}`);
  }

  return value.trim();
}

export function createAdminClient() {
  const url = requireServerConfig(
    publicEnv.supabaseUrl(),
    "NEXT_PUBLIC_SUPABASE_URL",
  );
  const serviceRoleKey = requireServerConfig(
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    "SUPABASE_SERVICE_ROLE_KEY",
  );

  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
