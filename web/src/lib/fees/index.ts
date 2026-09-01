// The public surface of the fee layer.
//
// Routes import from here and nowhere deeper, so the repository's client cast
// and the gate's SQLSTATE stay implementation detail. Nothing in this directory
// imports `@/lib/supabase/admin`, and `web/scripts/verify-source-gates.mjs`
// fails the build if that changes: the gate is a database trigger and the
// tenancy rules around it are RLS policies, so a client that bypasses RLS would
// make the whole proof vacuous for the one caller that matters.

export {
  LEGAL_GATE_CODE,
  LEGAL_GATE_SQLSTATE,
  LegalGateError,
  assertFeeChangeAllowed,
  isGatedFeeChange,
  mapLegalGateError,
} from "./legal-gate.ts";
export type { GatedFeeChange, LegalGateRefusal } from "./legal-gate.ts";

export { createFeesClient } from "./repository.ts";
export type { FeesRpcClient, RecordPaymentInput } from "./repository.ts";

export {
  RECEIVABLES_DEFAULT_LIMIT,
  RECEIVABLES_MAX_LIMIT,
  computeBalanceCents,
  computePaidCents,
  computeTotalCents,
  listOrgReceivables,
  readClientFees,
  readUpfrontGateState,
  recordPayment,
  reversePayment,
  setAgreement,
  setOrgDefault,
  setUpfrontApproval,
} from "./service.ts";
export type { FeeRepository, ServiceOptions } from "./service.ts";

export type {
  ClientFees,
  FeeAgreement,
  FeeAgreementInput,
  FeeAgreementSource,
  FeeAgreementStatus,
  FeeFailureReason,
  FeeLedger,
  FeeModel,
  FeePayment,
  FeePaymentMethod,
  FeeResult,
  OrgFeeDefault,
  OrgReceivable,
  UpfrontGateState,
} from "./types.ts";
