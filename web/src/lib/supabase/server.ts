import {
  createServerClient,
  type CookieMethodsServer,
} from "@supabase/ssr";
import { cookies } from "next/headers";

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

export function createServerClientWithCookies(
  cookieMethods: CookieMethodsServer,
) {
  const url = requirePublicConfig(
    publicEnv.supabaseUrl(),
    "NEXT_PUBLIC_SUPABASE_URL",
  );
  const anonKey = requirePublicConfig(
    publicEnv.supabaseAnonKey(),
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  );

  return createServerClient<Database>(url, anonKey, {
    cookies: cookieMethods,
  });
}

export async function createClient() {
  const url = requirePublicConfig(
    publicEnv.supabaseUrl(),
    "NEXT_PUBLIC_SUPABASE_URL",
  );
  const anonKey = requirePublicConfig(
    publicEnv.supabaseAnonKey(),
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  );
  const cookieStore = await cookies();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot write cookies; Phase 2 owns active refresh.
        }
      },
    },
  });
}
