import "server-only";

import {
  MisconfiguredDriverError,
  resolveDriverFromSpec,
  type DriverSpec,
  type EnvSource,
} from "@/lib/env";

import { createFixtureKbSource } from "./fixture-source.ts";
import { KbDomainError, type KbSourceDriver } from "./types.ts";

/**
 * The KB source's own driver table (G-KB-01).
 *
 * It used to have none: `createKbSourceDriver` resolved `resolveDriver("vault")`
 * and treated anything other than `fixture` as "a real source was asked for".
 * That made two services share one selector, and Phase 8 then set
 * `VAULT_DRIVER=supabase` on production so the bank sync could read the CCA
 * VAULT project. From that flip the weekly `vault.reimport_kb` job took the
 * throwing arm on every run, `kb_articles` stayed empty on hosted, and every
 * assistant answer degraded to the "not enough verified knowledge-base context"
 * boilerplate — with nothing anywhere naming the cause, because the throw was
 * swallowed into `{status:"failed", rows:0}`.
 *
 * So the KB source selects on `KB_SOURCE_DRIVER` and nothing else. Flipping the
 * vault to its real driver now says nothing at all about where KB articles come
 * from, which is the property that was missing.
 *
 * `vault_supabase` is named but deliberately unbuilt: the CCA VAULT KB tables'
 * shape has never been verified against `SourceArticle`, so selecting it still
 * refuses with `KB_SOURCE_SHAPE_UNVERIFIED` rather than importing rows nobody
 * has checked for consumer PII. That refusal is the point — it is a fail-closed
 * arm reached only by someone who typed the selector, not a state a different
 * service's configuration can put the importer into. Its `requires` list is
 * still the VAULT credentials, because when the shape is verified those are the
 * keys the driver will read with, and preflighting them keeps the failure at
 * selection rather than mid-import.
 *
 * §10's frozen table stays untouched; this is a one-row table resolved through
 * the same `env.ts` semantics (blank is unset, a present key never
 * auto-upgrades, an unknown value throws).
 */
export const KB_SOURCE_DRIVERS = {
  selector: "KB_SOURCE_DRIVER",
  values: ["fixture", "vault_supabase"],
  fallback: "fixture",
  requires: { vault_supabase: ["VAULT_SUPABASE_URL", "VAULT_SERVICE_KEY"] },
} as const satisfies DriverSpec;

export type KbSourceDriverName = (typeof KB_SOURCE_DRIVERS)["values"][number];

export interface KbSourceOptions {
  readonly onRealSourceRequested?: () => void;
}

export function resolveKbSourceDriver(env: EnvSource = process.env): KbSourceDriverName {
  return resolveDriverFromSpec("kb_source", KB_SOURCE_DRIVERS, env);
}

export function createKbSourceDriver(
  env: EnvSource = process.env,
  options: KbSourceOptions = {},
): KbSourceDriver {
  const selected = resolveKbSourceDriver(env);
  if (selected === "fixture") return createFixtureKbSource();
  options.onRealSourceRequested?.();
  throw new KbDomainError("KB_SOURCE_SHAPE_UNVERIFIED");
}

export { MisconfiguredDriverError };
