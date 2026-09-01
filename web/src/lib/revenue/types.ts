export const REVENUE_INCOMPLETE_CODES = [
  "monitoring_split_unset",
  "paid_invoice_evidence_missing",
  "platform_subscription_missing",
  "consumer_subscriptions_missing",
  "operator_rows_missing",
  "referral_rows_missing",
] as const;

export type RevenueIncompleteCode = (typeof REVENUE_INCOMPLETE_CODES)[number];

export type ConsumerSubscriptionInput = {
  provider: "mock" | "stripe";
  priceCents: number;
};

export type OperatorSubscriptionInput = {
  provider: "mock" | "stripe";
  seatQuantity: number;
  status: string;
};

export type SaasReferralInput = {
  base: "platform_subscription" | "consumer_subscriptions";
  id: string;
  months: 12;
  pct: number;
  referredOrgId: string;
  referrerOrgId: string;
  startedAt: string;
};

export type RevenueAccrualInputs = {
  consumerSubscriptions: readonly ConsumerSubscriptionInput[];
  operatorOrgId: string;
  operatorSubscription: OperatorSubscriptionInput | null;
  orgBasePriceCents: number;
  orgSeatPriceCents: number;
  referral: SaasReferralInput | null;
  refundAmountCents: number;
};

export type OperatorAccrualSnapshot = {
  amountCents: number | null;
  baseAmountCents: number;
  incompleteCode: RevenueIncompleteCode | null;
  isComplete: boolean;
  operatorOrgId: string;
  pctSnapshot: number | null;
  sourceRowCount: number;
};

export type ReferralAccrualSnapshot = {
  accrualMonth: string;
  amountCents: number;
  baseAmountCents: number;
  baseSnapshot: SaasReferralInput["base"];
  cycleNumber: number;
  incompleteCode: RevenueIncompleteCode | null;
  isComplete: boolean;
  pctSnapshot: number;
  referredOrgId: string;
  referrerOrgId: string;
  saasReferralId: string;
  sourceRowCount: number;
};

export type PostBillingAccrualInput = {
  accrualMonth: string;
  operator: OperatorAccrualSnapshot;
  referrals: readonly ReferralAccrualSnapshot[];
};

export type PostBillingAccrualResult = {
  operatorRows: number;
  referralRows: number;
};

export type RevenueKpis = {
  complete: boolean;
  incompleteCodes: RevenueIncompleteCode[];
  monitoringShareTotalCents: number;
  saasReferralTotalCents: number;
};

export type RevenueHandlerResult = {
  status: "ok" | "skipped" | "failed";
  rows?: number;
};

export const SETTLEMENT_STATUSES = ["accrued", "exported", "paid", "reversed"] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];
export type LedgerKind = "operator" | "referral";
export type SettlementRow = {
  ledger: LedgerKind;
  ledgerId: string;
  status: SettlementStatus;
};
export type SettlementMarkInput = SettlementRow & {
  actorId: string;
  expectedStatus: "accrued" | "exported";
};
export type SettlementMarkVerdict =
  | { applied: true; row: SettlementRow }
  | { applied: false; reason: "not_found"; row: null }
  | { applied: false; reason: "incomplete" | "stale"; row: SettlementRow };

export interface RevenueRepository {
  listAccrualOrgIds(): Promise<readonly string[]>;
  postBillingAccrual(input: PostBillingAccrualInput): Promise<PostBillingAccrualResult>;
  readAccrualInputs(operatorOrgId: string, accrualMonth: string): Promise<RevenueAccrualInputs>;
}

export interface SettlementRepository {
  readSettlementStatus(kind: LedgerKind, ledgerId: string): Promise<SettlementRow | null>;
  markSettlement(input: SettlementMarkInput): Promise<SettlementMarkVerdict>;
}

export type RevenueRpcClient = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { code?: string | null } | null }>;
};
