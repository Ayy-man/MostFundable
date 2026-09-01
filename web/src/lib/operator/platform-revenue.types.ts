export const CONSUMER_PLAN_STATUSES = [
  "authorized",
  "active",
  "cancelled",
  "failed",
  "review_required",
] as const;

export type ConsumerPlanStatus = (typeof CONSUMER_PLAN_STATUSES)[number];

export interface OperatorPlanRosterRow {
  readonly activatedAt: string | null;
  readonly cancelledAt: string | null;
  readonly clientId: string;
  readonly clientName: string;
  readonly currency: string | null;
  readonly priceCents: number | null;
  readonly status: ConsumerPlanStatus | null;
  readonly updatedAt: string | null;
}

export interface OperatorRevenueLedgerMonth {
  readonly amountCents: number | null;
  readonly baseAmountCents: number;
  readonly incompleteCode: string | null;
  readonly isComplete: boolean;
  readonly pctSnapshot: number | null;
  readonly settlementStatus: "accrued" | "exported" | "paid" | "reversed";
  readonly sourceRowCount: number;
}

export interface OperatorPlatformRevenue {
  readonly ledger: OperatorRevenueLedgerMonth | null;
  readonly month: string;
  readonly roster: readonly OperatorPlanRosterRow[];
}
