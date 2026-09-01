import { resolveDriver } from "@/lib/env";

import type { VaultDriverName } from "./types.ts";

/**
 * §10's driver choice, made once at module load by `index.ts` holding the
 * result in a module-level const. `resolveDriver` already throws when
 * `VAULT_DRIVER=supabase` and a required key is missing, so by the time the
 * real driver reads an environment variable the choice has been validated.
 */
export function vaultDriverName(env: NodeJS.ProcessEnv = process.env): VaultDriverName {
  return resolveDriver("vault", env as Record<string, string | undefined>);
}

/**
 * Read a key the selected driver declared it needs. The throw is a boot error
 * with the key's name and no value — a driver key belongs in Vercel env and
 * never in a log line, a message or this repository.
 */
export function requireEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`VAULT_ENV_MISSING:${name}`);
  }
  return value.trim();
}
