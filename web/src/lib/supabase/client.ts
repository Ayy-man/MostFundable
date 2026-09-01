import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/lib/db/types";
import { publicEnv } from "@/lib/env";

function requirePublicConfig(
  value: string | undefined,
  key: "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_ANON_KEY",
): string {
  if (!value?.trim()) {
    throw new Error(`Missing ${key}`);
  }

  return value.trim();
}

export function createClient() {
  const url = requirePublicConfig(
    publicEnv.supabaseUrl(),
    "NEXT_PUBLIC_SUPABASE_URL",
  );
  const anonKey = requirePublicConfig(
    publicEnv.supabaseAnonKey(),
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  );

  return createBrowserClient<Database>(url, anonKey);
}
