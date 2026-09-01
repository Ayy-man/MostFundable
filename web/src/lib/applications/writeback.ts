/**
 * The VAULT write-back arm, selected by the INTERFACES §10 driver table.
 *
 * The durable record of an approved outcome is the `vault_writeback_outbox` row
 * that `public.review_outcome` already inserted, tagged `source = 'mostfundable'`
 * by a check constraint. This module's only job is what happens *after* that
 * row exists, and on the default arm the answer is deliberately "nothing":
 * `fixture` leaves the row exactly where the database put it.
 *
 * Two rules hold on every path:
 *
 * 1. `deliver` never throws. A review is a correction to a lender's counted
 *    history and an unreachable third-party database must not be able to block
 *    it (T-11-20), so a transport problem comes back as a value.
 * 2. No credential is read, logged, echoed or returned here. The two keys are
 *    checked for presence and handed to the client factory; nothing formats
 *    them, and the failure codes below name a condition rather than a value.
 */

import { MisconfiguredDriverError, resolveDriver } from "@/lib/env";
import type { EnvSource } from "@/lib/env";

import type {
  VaultWritebackDeliveryResult,
  VaultWritebackDriver,
} from "./ports.ts";
import type { VaultWritebackRow } from "./types.ts";

/**
 * A configuration gap and a transport failure are different facts and the
 * caller acts on them differently, so they never share a code. `configuration`
 * means nothing was attempted; `transport` means an attempt was made and did
 * not land.
 */
export const WRITEBACK_CONFIGURATION_FAILURE = "configuration_error";
export const WRITEBACK_TRANSPORT_FAILURE = "transport";

/**
 * The narrowest slice of a Supabase client this arm uses. Declaring it here
 * rather than importing `SupabaseClient` keeps the module free of a runtime
 * dependency on `@supabase/supabase-js` and lets a test inject a spy.
 */
export interface VaultClientLike {
  from(table: string): {
    insert(values: Record<string, unknown>): PromiseLike<{
      error: { message?: string } | null;
    }>;
  };
}

export type VaultClientFactory = (
  url: string,
  serviceKey: string,
) => Promise<VaultClientLike>;

export interface VaultWritebackDriverOptions {
  /** Injected by tests so the "constructs nothing" case is observable. */
  createClient?: VaultClientFactory;
}

/**
 * The resolved arm, computed once at construction.
 *
 * `unconfigured` is what an explicit `VAULT_DRIVER=supabase` with a missing or
 * blank key collapses to. `resolveDriver` throws in that case by design — an
 * explicit selector that cannot be honoured must be visible rather than
 * silently downgraded — and this module turns the throw into a state instead of
 * propagating it, because a driver that throws at construction would take the
 * whole review route down with it.
 */
type ResolvedArm =
  | { kind: "fixture" }
  | { kind: "supabase"; url: string; serviceKey: string }
  | { kind: "unconfigured" };

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}

function resolveArm(env: EnvSource): ResolvedArm {
  let selected: "fixture" | "supabase";
  try {
    selected = resolveDriver("vault", env);
  } catch (error) {
    // A `MisconfiguredDriverError` is the expected shape here and its message
    // names environment keys only, never values. Any other error is still not
    // worth throwing out of a constructor, so both land on the same arm.
    if (!(error instanceof MisconfiguredDriverError)) throw error;
    return { kind: "unconfigured" };
  }

  if (selected === "fixture") return { kind: "fixture" };

  const url = env.VAULT_SUPABASE_URL;
  const serviceKey = env.VAULT_SERVICE_KEY;
  // `resolveDriver` already rejects a supabase selector with either key
  // missing, so reaching this branch with a blank key should be impossible.
  // The check stays because "impossible" here would mean handing the client
  // factory an empty string and letting the failure surface as transport.
  if (isBlank(url) || isBlank(serviceKey)) return { kind: "unconfigured" };

  return { kind: "supabase", url: url as string, serviceKey: serviceKey as string };
}

/**
 * The default client factory for the `supabase` arm.
 *
 * Imported dynamically and only once an arm with both keys has been resolved,
 * so a deployment with no VAULT configuration never loads it.
 */
const defaultCreateClient: VaultClientFactory = async (url, serviceKey) => {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  }) as unknown as VaultClientLike;
};

/**
 * Deliver one outbox row to the CCA VAULT.
 *
 * The two target tables come from `docs/backend/CURRENT-STATE.md:44` and are
 * marked `UNVERIFIED-FOR-ACCOUNT` in `.planning/pre-flight/phase-11.md` P-08
 * (checked 2026-08-16): no project-scoped VAULT read key exists on this side,
 * so no column list, no nullability and no `source` column has been read from
 * the live schema. This arm is written against the table names only.
 *
 * The row's `payload` is inserted verbatim. It is the object
 * `private.vault_writeback_payload_valid(jsonb)` already accepted, so its key
 * set is the single gate on what leaves this system (T-11-18); adding a field
 * here would route around that gate. If the real schema rejects the insert, the
 * result is `transport` and the outbox row stays for a replay.
 *
 * Verifying the shape against the live schema is key-arrival work — KA-11-1 in
 * `.planning/lanes/phase-11.md` — and until then this path reports SKIPPED.
 */
async function deliverToVault(
  row: VaultWritebackRow,
  arm: { url: string; serviceKey: string },
  createClient: VaultClientFactory,
): Promise<VaultWritebackDeliveryResult> {
  try {
    const client = await createClient(arm.url, arm.serviceKey);
    const { error } = await client.from(row.target).insert(row.payload);
    if (error) {
      return { state: "failed", failureCode: WRITEBACK_TRANSPORT_FAILURE };
    }
    return { state: "delivered" };
  } catch {
    // Deliberately no `error` in scope beyond this point: a client constructed
    // from a URL and a service key can put either into a thrown message, and
    // this function's contract is a code, not a message.
    return { state: "failed", failureCode: WRITEBACK_TRANSPORT_FAILURE };
  }
}

/**
 * Build the write-back driver for one environment.
 *
 * `env` is a required argument rather than a default read from the ambient
 * process environment, and that is load-bearing: this module reads no ambient
 * environment at all, which is what makes the driver-selection tests total and
 * what stops a key dropped into a deployment from changing behaviour without a
 * selector change (T-11-19). A test asserts the file text, so do not spell the
 * ambient accessor out here either — it will match.
 */
export function createVaultWritebackDriver(
  env: EnvSource,
  options: VaultWritebackDriverOptions = {},
): VaultWritebackDriver {
  const arm = resolveArm(env);
  const createClient = options.createClient ?? defaultCreateClient;

  return Object.freeze({
    deliver(row: VaultWritebackRow): Promise<VaultWritebackDeliveryResult> {
      if (arm.kind === "supabase") {
        return deliverToVault(row, arm, createClient);
      }

      if (arm.kind === "unconfigured") {
        // Nothing was attempted, so the row has not failed — it is still
        // exactly as durable as it was a moment ago. Reporting `failed` here
        // would misfile a configuration gap as a delivery error and would put
        // a `failure_code` on a row that nobody tried to send.
        return Promise.resolve({
          state: "recorded",
          failureCode: WRITEBACK_CONFIGURATION_FAILURE,
        });
      }

      // The fixture arm. It writes nothing anywhere, on purpose: the outbox row
      // is the record, and leaving it alone is the honest result for a system
      // with no VAULT credentials.
      return Promise.resolve({ state: "recorded" });
    },
  });
}
