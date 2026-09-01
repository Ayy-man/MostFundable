import type { FeeModel, UpfrontGateState } from "./types.ts";

// The legal gate, in one module.
//
// This predicate mirrors `private.fee_agreement_legal_gate()` in
// supabase/migrations/091_fees_core.sql. The database is the authority: it is a
// BEFORE trigger, so it stops `service_role` and the table owner too, and no
// application bug can route around it. If this file and that trigger ever
// disagree, the trigger wins and this file is the bug.
//
// What this layer buys is the ordinary path — a route can answer 403 without a
// round trip, and can say *why* in a shape the client understands, instead of
// forwarding a Postgres error string.

/** The SQLSTATE the trigger raises. `PT403` is in the PostgREST `PTxyz` range,
 * so PostgREST maps it to HTTP 403 on its own; the default `P0001` would have
 * arrived as a 400. This constant is the only place the code appears in
 * TypeScript, and `web/scripts/verify-fee-legal-gate.mjs` enforces that. */
export const LEGAL_GATE_SQLSTATE = "PT403";

/** The message the trigger raises, and the `code` field every refusal carries
 * out to a caller. */
export const LEGAL_GATE_CODE = "legal_gate";

export interface GatedFeeChange {
  model: FeeModel;
  upfrontCents?: number | null;
  triggerCents?: number | null;
  /** Accepted so a caller can pass a whole agreement, and deliberately ignored:
   * a success amount is contingent on an outcome, which is the arrangement the
   * package model exists to be distinguished from. */
  successCents?: number | null;
}

export interface LegalGateRefusal {
  status: 403;
  code: typeof LEGAL_GATE_CODE;
}

export class LegalGateError extends Error {
  readonly status = 403 as const;
  readonly code = LEGAL_GATE_CODE;

  constructor() {
    super(LEGAL_GATE_CODE);
    this.name = "LegalGateError";
  }
}

/**
 * Whether a fee change carries an option that needs recorded legal sign-off.
 *
 * Three conditions, matching the trigger exactly: the package model whatever
 * its amounts, a positive amount payable before any outcome, and a positive
 * legacy trigger-payment amount on a non-custom model. For a custom flat
 * success fee, `triggerCents` is a funded-amount threshold rather than an
 * amount charged, so that one case does not require upfront-fee approval.
 */
export function isGatedFeeChange(change: GatedFeeChange): boolean {
  return (
    change.model === "package" ||
    (change.upfrontCents ?? 0) > 0 ||
    (change.model !== "custom" && (change.triggerCents ?? 0) > 0)
  );
}

/**
 * Throws when a gated change meets an organization with no recorded sign-off.
 *
 * Called before the repository so the ordinary refusal costs no round trip.
 * It is not the enforcement point — the trigger is — and removing this call
 * would make the route slower and less informative rather than permissive.
 */
export function assertFeeChangeAllowed(
  change: GatedFeeChange,
  gate: UpfrontGateState,
): void {
  if (isGatedFeeChange(change) && !gate.approved) {
    throw new LegalGateError();
  }
}

function readField(value: unknown, field: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const found = (value as Record<string, unknown>)[field];
  return typeof found === "string" ? found : null;
}

/**
 * Turns a refusal from either side into the one shape the routes answer with.
 *
 * Recognises the SQLSTATE first, since that is what PostgREST puts in `code`,
 * and falls back to an exact message match for a driver that surfaces the state
 * differently. Everything else returns null and propagates, because a fee route
 * turning an unrelated database error into a 403 would hide a real fault behind
 * a plausible-looking answer.
 */
export function mapLegalGateError(error: unknown): LegalGateRefusal | null {
  if (error instanceof LegalGateError) {
    return { status: 403, code: LEGAL_GATE_CODE };
  }
  if (readField(error, "code") === LEGAL_GATE_SQLSTATE) {
    return { status: 403, code: LEGAL_GATE_CODE };
  }
  if (readField(error, "message") === LEGAL_GATE_CODE) {
    return { status: 403, code: LEGAL_GATE_CODE };
  }
  return null;
}
