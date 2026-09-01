import { assertFeeChangeAllowed, mapLegalGateError } from "./legal-gate.ts";
import * as repository from "./repository.ts";
import { resolveConfiguredPrice, resolvePercentage } from "@/lib/pricing";

import type { FeesRpcClient, RecordPaymentInput } from "./repository.ts";
import type {
  ClientFees,
  FeeAgreement,
  FeeAgreementInput,
  FeePayment,
  FeeResult,
  OrgFeeDefault,
  OrgReceivable,
  UpfrontGateState,
} from "./types.ts";

// The mechanism layer. Everything a fee route has to get right lives here, so
// the handlers in plan 12-06 are argument parsing and a status code.

/** Everything the service needs from the outside. Injected so `npm test` runs
 * the arithmetic and the gate ordering with no database in sight. */
export interface FeeRepository {
  setUpfrontApproval: typeof repository.setUpfrontApproval;
  readUpfrontGateState: typeof repository.readUpfrontGateState;
  readOrgDefault: typeof repository.readOrgDefault;
  setAgreement: typeof repository.setAgreement;
  setOrgDefault: typeof repository.setOrgDefault;
  recordPayment: typeof repository.recordPayment;
  reversePayment: typeof repository.reversePayment;
  readClientFees: typeof repository.readClientFees;
  listOrgReceivables: typeof repository.listOrgReceivables;
}

const DEFAULT_REPOSITORY: FeeRepository = repository;

export const RECEIVABLES_DEFAULT_LIMIT = 50;
export const RECEIVABLES_MAX_LIMIT = 200;

// ---------------------------------------------------------------------------
// Arithmetic.
//
// This mirrors private.fee_recompute_total and private.fee_recompute_paid in
// supabase/migrations/091_fees_core.sql. The database is what actually fills
// the ledger — the numbers below are for previewing a change a caller has not
// saved yet, and for anything reading a fee agreement without a ledger row.
// ---------------------------------------------------------------------------

interface TotalInput {
  model: FeeAgreementInput["model"];
  status?: FeeAgreementInput["status"];
  pct?: number | null;
  upfrontCents?: number | null;
  successCents?: number | null;
  triggerCents?: number | null;
  customTotalCents?: number | null;
}

/**
 * What the agreement totals against an approved outcome of `outcomeBasisCents`.
 *
 * Money stays an integer number of cents the whole way through. A percentage is
 * applied as hundredths of a percent — `numeric(5,2)` in the column, so two
 * decimal places is the whole domain — which keeps the multiplication in
 * integers and leaves exactly one rounding step, matching the single `round()`
 * in the SQL.
 */
export function computeTotalCents(
  agreement: TotalInput | null,
  outcomeBasisCents: number,
): number {
  if (agreement === null) return 0;
  // A withdrawn agreement owes nothing. Payments already recorded against it
  // stay and drive the balance negative, which is the honest reading: the money
  // moved, and the agreement did not.
  if (agreement.status === "void") return 0;

  switch (agreement.model) {
    case "percentage": {
      const percentage = agreement.pct === null || agreement.pct === undefined
        ? 0
        : resolvePercentage("fee_percentage", { config: agreement.pct }).value ?? 0;
      const hundredthsOfAPercent = Math.round(percentage * 100);
      const basis = Math.max(0, Math.trunc(outcomeBasisCents));
      const upfront = agreement.upfrontCents === null || agreement.upfrontCents === undefined
        ? 0
        : resolveConfiguredPrice("fee_upfront", agreement.upfrontCents).valueCents;
      return upfront + Math.round((basis * hundredthsOfAPercent) / 10_000);
    }
    case "custom": {
      const threshold = agreement.triggerCents === null || agreement.triggerCents === undefined
        ? null
        : resolveConfiguredPrice("fee_trigger", agreement.triggerCents).valueCents;
      const upfront = agreement.upfrontCents === null || agreement.upfrontCents === undefined
        ? 0
        : resolveConfiguredPrice("fee_upfront", agreement.upfrontCents).valueCents;
      if (threshold !== null && Math.max(0, Math.trunc(outcomeBasisCents)) < threshold) {
        return upfront;
      }
      const success = agreement.customTotalCents === null || agreement.customTotalCents === undefined
        ? 0
        : resolveConfiguredPrice("fee_custom_total", agreement.customTotalCents).valueCents;
      return upfront + success;
    }
    case "package":
      return (
        (agreement.upfrontCents === null || agreement.upfrontCents === undefined
          ? 0 : resolveConfiguredPrice("fee_upfront", agreement.upfrontCents).valueCents) +
        (agreement.successCents === null || agreement.successCents === undefined
          ? 0 : resolveConfiguredPrice("fee_success", agreement.successCents).valueCents) +
        (agreement.triggerCents === null || agreement.triggerCents === undefined
          ? 0 : resolveConfiguredPrice("fee_trigger", agreement.triggerCents).valueCents)
      );
    default: {
      // Exhaustive: adding a model to FeeModel fails to compile here until
      // someone decides what it totals.
      const unreachable: never = agreement.model;
      throw new Error(`FEES_UNKNOWN_MODEL:${String(unreachable)}`);
    }
  }
}

/** The sum of what was actually received. A reversed payment is still a row and
 * still visible; it just stops counting. */
export function computePaidCents(payments: readonly FeePayment[]): number {
  return payments
    .filter((payment) => payment.reversedAt === null)
    .reduce((sum, payment) => sum + Math.trunc(payment.amountCents), 0);
}

/** Negative when more was recorded than was owed. Recording what actually
 * happened is more useful than refusing to, and an operator reading a negative
 * balance learns something true. */
export function computeBalanceCents(totalCents: number, paidCents: number): number {
  return totalCents - paidCents;
}

// ---------------------------------------------------------------------------
// Orchestration.
// ---------------------------------------------------------------------------

export interface ServiceOptions {
  repository?: FeeRepository;
}

function repo(options: ServiceOptions): FeeRepository {
  return options.repository ?? DEFAULT_REPOSITORY;
}

function resolveFeeInput<T extends Omit<FeeAgreementInput, "status">>(input: T): T {
  return {
    ...input,
    pct: input.pct === null ? null : resolvePercentage("fee_percentage", { config: input.pct }).value,
    upfrontCents: input.upfrontCents === null ? null : resolveConfiguredPrice("fee_upfront", input.upfrontCents).valueCents,
    successCents: input.successCents === null ? null : resolveConfiguredPrice("fee_success", input.successCents).valueCents,
    triggerCents: input.triggerCents === null ? null : resolveConfiguredPrice("fee_trigger", input.triggerCents).valueCents,
    customTotalCents: input.customTotalCents === null ? null : resolveConfiguredPrice("fee_custom_total", input.customTotalCents).valueCents,
  };
}

export function readClientFees(
  client: FeesRpcClient,
  clientId: string,
  options: ServiceOptions = {},
): Promise<FeeResult<ClientFees>> {
  return repo(options).readClientFees(client, clientId);
}

export function listOrgReceivables(
  client: FeesRpcClient,
  orgId: string,
  limit: number = RECEIVABLES_DEFAULT_LIMIT,
  offset = 0,
  options: ServiceOptions = {},
): Promise<FeeResult<OrgReceivable[]>> {
  const bounded = Math.min(Math.max(1, Math.trunc(limit)), RECEIVABLES_MAX_LIMIT);
  const from = Math.max(0, Math.trunc(offset));
  return repo(options).listOrgReceivables(client, orgId, bounded, from);
}

export function readUpfrontGateState(
  client: FeesRpcClient,
  orgId: string,
  options: ServiceOptions = {},
): Promise<FeeResult<UpfrontGateState>> {
  return repo(options).readUpfrontGateState(client, orgId);
}

export function readOrgDefault(
  client: FeesRpcClient,
  orgId: string,
  options: ServiceOptions = {},
): Promise<FeeResult<OrgFeeDefault | null>> {
  return repo(options).readOrgDefault(client, orgId);
}

export function setUpfrontApproval(
  client: FeesRpcClient,
  orgId: string,
  approved: boolean,
  signoffRef: string | null,
  options: ServiceOptions = {},
): Promise<FeeResult<UpfrontGateState>> {
  return repo(options).setUpfrontApproval(client, orgId, approved, signoffRef);
}

/**
 * Writes a client's fee agreement, checking the gate before any draft, active,
 * or reactivation write. A void write is the deliberate exception because it
 * withdraws the terms and recomputes the amount due to zero.
 *
 * The pre-check is a courtesy, not the enforcement: it saves a round trip and
 * lets the route answer with a reason. The trigger behind
 * `fees_set_agreement` decides, and its refusal is mapped identically, so a
 * caller cannot tell which of the two stopped them — and deleting the pre-check
 * would make this slower, not permissive.
 */
export async function setAgreement(
  client: FeesRpcClient,
  clientId: string,
  orgId: string,
  input: FeeAgreementInput,
  options: ServiceOptions = {},
): Promise<FeeResult<FeeAgreement>> {
  const resolvedInput = resolveFeeInput(input);

  // Voiding withdraws the agreement and recomputes the amount due to zero. It
  // must remain possible after a legal approval is revoked; reactivation still
  // takes the ordinary path below and has to earn the gate again.
  if (resolvedInput.status === "void") {
    return repo(options).setAgreement(client, clientId, resolvedInput);
  }

  const gate = await repo(options).readUpfrontGateState(client, orgId);
  if (!gate.ok) return gate;

  try {
    assertFeeChangeAllowed(resolvedInput, gate.value);
  } catch (error) {
    if (mapLegalGateError(error) !== null) return { ok: false, reason: "legal_gate" };
    throw error;
  }

  return repo(options).setAgreement(client, clientId, resolvedInput);
}

export async function setOrgDefault(
  client: FeesRpcClient,
  orgId: string,
  input: Omit<FeeAgreementInput, "status">,
  options: ServiceOptions = {},
): Promise<FeeResult<OrgFeeDefault>> {
  const gate = await repo(options).readUpfrontGateState(client, orgId);
  if (!gate.ok) return gate;
  const resolvedInput = resolveFeeInput(input);

  try {
    assertFeeChangeAllowed(resolvedInput, gate.value);
  } catch (error) {
    if (mapLegalGateError(error) !== null) return { ok: false, reason: "legal_gate" };
    throw error;
  }

  return repo(options).setOrgDefault(client, orgId, resolvedInput);
}

export function recordPayment(
  client: FeesRpcClient,
  clientId: string,
  input: RecordPaymentInput,
  options: ServiceOptions = {},
): Promise<FeeResult<FeePayment>> {
  return repo(options).recordPayment(client, clientId, input);
}

export function reversePayment(
  client: FeesRpcClient,
  paymentId: string,
  options: ServiceOptions = {},
): Promise<FeeResult<FeePayment>> {
  return repo(options).reversePayment(client, paymentId);
}
