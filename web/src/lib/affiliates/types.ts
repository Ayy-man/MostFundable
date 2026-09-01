export const AFFILIATE_PAYMENT_STATUSES = [
  "not_ready",
  "pending",
  "submitted",
  "paid",
] as const;

export type AffiliatePaymentStatus = (typeof AFFILIATE_PAYMENT_STATUSES)[number];

export const AFFILIATE_STAGES = [
  "onboarding",
  "optimization",
  "ready",
  "applying",
  "funded",
  "graduate",
] as const;

export type AffiliateStage = (typeof AFFILIATE_STAGES)[number];

export type AffiliateViewRow = {
  expected_commission_cents: number | null;
  funded_amount_cents: number;
  payment_status: AffiliatePaymentStatus;
  stage: AffiliateStage;
  started_at: string;
};

export type AffiliatePortalRow = {
  expectedCommissionCents: number | null;
  fundedAmountCents: number;
  needsAttention: boolean;
  paymentStatus: AffiliatePaymentStatus;
  stage: AffiliateStage;
  startedAt: string;
};

export type AffiliateKpis = {
  active: number;
  fundingRecordedCents: number;
  inPipeline: number;
  sentLeads: number;
};

export type AffiliatePortal = {
  kpis: AffiliateKpis;
  rows: AffiliatePortalRow[];
};

export type AffiliateShare = {
  affiliateId: string;
  clientId: string;
  expectedCommissionCents: number | null;
  paymentStatus: AffiliatePaymentStatus;
};

export type AffiliateShareResult = AffiliateShare & { inserted: boolean };
export type AffiliateUpdateResult = AffiliateShare & { changed: boolean };

export type AffiliateRosterRow = {
  affiliate_id: string;
  profile_id: string;
  name: string;
  email: string;
  referral_slug: string;
  active: boolean;
  default_commission_bps: number;
  shared_clients: number;
  expected_commission_cents: number;
  paid_commission_cents: number;
};

export type AffiliateRosterEntry = {
  affiliateId: string;
  profileId: string;
  name: string;
  email: string;
  referralSlug: string;
  active: boolean;
  defaultCommissionBps: number;
  sharedClients: number;
  expectedCommissionCents: number;
  paidCommissionCents: number;
};

export type AffiliateStatementRow = {
  affiliateId: string;
  clientId: string;
  clientName: string;
  startedAt: string;
  stage: AffiliateStage;
  fundedAmountCents: number;
  expectedCommissionCents: number;
  paymentStatus: AffiliatePaymentStatus;
  commissionOverride: boolean;
};

export type AffiliateLifecyclePatch = {
  active?: boolean;
  defaultCommissionBps?: number;
};

export type AffiliateLifecycleResult = {
  affiliateId: string;
  active: boolean;
  defaultCommissionBps: number;
  changed: boolean;
};

export type ShareClientBody = { clientId: string };
export type UpdateShareBody = {
  expectedCommissionCents?: number | null;
  paymentStatus?: AffiliatePaymentStatus;
};

export type AffiliateErrorCode = "forbidden" | "invalid_payload" | "not_found" | "unexpected";

export class AffiliateError extends Error {
  readonly code: AffiliateErrorCode;

  constructor(
    code: AffiliateErrorCode,
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = "AffiliateError";
  }
}
