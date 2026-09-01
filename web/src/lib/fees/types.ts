// Narrow row and domain shapes for the fee schema.
//
// `@/lib/db/types` is generated and stale (INTERFACES §3), and regenerating it
// against a shared local stack would pull in three sibling phases' tables, so
// nothing here is re-exported from it. These are hand-written and deliberately
// narrow: they describe the columns this phase reads, not the tables.
//
// Every union below matches a Postgres enum label byte for byte. They are
// string-literal unions rather than TypeScript `enum` declarations, which
// `web/scripts/verify-source-gates.mjs` bans outright.

export type FeeModel = "percentage" | "package" | "custom";

export type FeeAgreementStatus = "draft" | "active" | "void";

export type FeePaymentMethod =
  | "bank_transfer"
  | "card"
  | "check"
  | "cash"
  | "other";

export type FeeAgreementSource =
  | "workspace_default"
  | "operator_override"
  | "platform_admin";

/** What a route may set. `source` is absent on purpose: the RPC stamps it from
 * the caller's app role, so it is not something a request can claim. */
export interface FeeAgreementInput {
  model: FeeModel;
  pct: number | null;
  upfrontCents: number | null;
  successCents: number | null;
  /** For `custom`, the funded outcome threshold at which the flat fee is due. */
  triggerCents: number | null;
  customTotalCents: number | null;
  status: FeeAgreementStatus;
}

export interface FeeAgreement {
  clientId: string;
  orgId: string;
  model: FeeModel;
  pct: number | null;
  upfrontCents: number | null;
  successCents: number | null;
  triggerCents: number | null;
  customTotalCents: number | null;
  status: FeeAgreementStatus;
  source: FeeAgreementSource;
  createdAt: string;
  updatedAt: string;
}

export interface FeeLedger {
  clientId: string;
  orgId: string;
  totalCents: number;
  paidCents: number;
  outcomeBasisCents: number;
  outcomeBasisSource: string | null;
  /** Total minus paid. Negative when more was recorded than was owed, which is
   * a fact worth showing rather than an error worth refusing. */
  balanceCents: number;
  updatedAt: string;
}

export interface FeePayment {
  id: string;
  clientId: string;
  orgId: string;
  amountCents: number;
  receivedOn: string;
  method: FeePaymentMethod;
  reference: string | null;
  note: string | null;
  recordedBy: string | null;
  recordedAt: string;
  reversedAt: string | null;
  reversedBy: string | null;
}

export interface OrgFeeDefault {
  orgId: string;
  model: FeeModel;
  pct: number | null;
  upfrontCents: number | null;
  successCents: number | null;
  triggerCents: number | null;
  customTotalCents: number | null;
  updatedBy: string | null;
  updatedAt: string;
}

/** The legal gate as the application sees it. A missing `org_flags` row and an
 * unreadable one both arrive here as `approved: false`, because the RPC
 * collapses them — two ways of saying "not approved" is one more than the
 * number that can stay consistent. */
export interface UpfrontGateState {
  approved: boolean;
  signoffRef: string | null;
  approvedAt: string | null;
}

export interface ClientFees {
  clientId: string;
  agreement: FeeAgreement | null;
  ledger: FeeLedger | null;
  payments: FeePayment[];
}

export interface OrgReceivable {
  clientId: string;
  displayName: string;
  model: FeeModel | null;
  status: FeeAgreementStatus | null;
  /** Recorded funded outcome used to calculate percentage and triggered fees. */
  outcomeBasisCents: number;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  lastPaymentOn: string | null;
}

/** Why a fee operation did not happen. Each maps to exactly one HTTP status in
 * plan 12-06's routes, so the routes never inspect a database error. */
export type FeeFailureReason = "legal_gate" | "forbidden" | "not_found";

export type FeeResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: FeeFailureReason };
