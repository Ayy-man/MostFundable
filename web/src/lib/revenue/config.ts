import type { EnvSource } from "@/lib/env";
import {
  resolvePercentage as resolvePricingPercentage,
  resolveReferralBase as resolvePricingReferralBase,
} from "@/lib/pricing";

import type { RevenueIncompleteCode } from "./types.ts";

// Postgres `uuid` shape, not strict RFC-4122: seeded ids carry zero version/variant nibbles (GAPS G-3B-06/07).
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export type { ReferralBase } from "@/lib/pricing";

export function resolveMonitoringSplit(env: EnvSource = process.env): number | null {
  try {
    return resolvePricingPercentage("monitoring_split", { env }).value;
  } catch (error) {
    if (error instanceof Error && error.message === "PRICING_PERCENT_INVALID") {
      throw new Error("MONITORING_SPLIT_PCT_INVALID");
    }
    throw error;
  }
}

export function resolveReferralBase(env: EnvSource = process.env): import("@/lib/pricing").ReferralBase {
  try {
    return resolvePricingReferralBase({ env }).value;
  } catch (error) {
    if (error instanceof Error && error.message === "PRICING_REFERRAL_BASE_INVALID") {
      throw new Error("SAAS_REFERRAL_BASE_INVALID");
    }
    throw error;
  }
}

export function parseOperatorSubject(subject: string): string {
  if (!subject.startsWith("org:")) throw new Error("REVENUE_SUBJECT_INVALID");
  const orgId = subject.slice(4);
  if (!UUID_PATTERN.test(orgId)) throw new Error("REVENUE_SUBJECT_INVALID");
  return orgId.toLowerCase();
}

export function parseAccrualWindow(window: string): string {
  const match = MONTH_PATTERN.exec(window);
  if (!match) throw new Error("REVENUE_WINDOW_INVALID");
  return `${match[1]}-${match[2]}-01`;
}

function monthParts(value: string): [number, number] {
  const normalized = value.length === 7 ? parseAccrualWindow(value) : value;
  const match = /^(\d{4})-(0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.exec(normalized);
  if (!match) throw new Error("REVENUE_WINDOW_INVALID");
  return [Number(match[1]), Number(match[2])];
}

export function referralCycle(startedAt: string, accrualMonth: string): number | null {
  const [startYear, startMonth] = monthParts(startedAt);
  const [year, month] = monthParts(accrualMonth);
  const cycle = (year - startYear) * 12 + month - startMonth + 1;
  return cycle >= 1 && cycle <= 12 ? cycle : null;
}

export function percentageAmountCents(baseAmountCents: number, pct: number): number {
  if (!Number.isSafeInteger(baseAmountCents) || baseAmountCents < 0) {
    throw new Error("REVENUE_CENTS_INVALID");
  }
  const hundredths = Math.round(pct * 100);
  if (!Number.isSafeInteger(hundredths) || hundredths < 0 || hundredths > 10_000) {
    throw new Error("REVENUE_PERCENT_INVALID");
  }
  const amount = Math.round((baseAmountCents * hundredths) / 10_000);
  if (!Number.isSafeInteger(amount)) throw new Error("REVENUE_CENTS_INVALID");
  return amount;
}

export function isRevenueIncompleteCode(value: unknown): value is RevenueIncompleteCode {
  return [
    "monitoring_split_unset",
    "paid_invoice_evidence_missing",
    "platform_subscription_missing",
    "consumer_subscriptions_missing",
    "operator_rows_missing",
    "referral_rows_missing",
  ].includes(value as RevenueIncompleteCode);
}
