import { operatorPrices } from "@/lib/billing/config";
import { resolvePercentage } from "@/lib/pricing";

import {
  parseAccrualWindow,
  parseOperatorSubject,
  percentageAmountCents,
  referralCycle,
  resolveMonitoringSplit,
  resolveReferralBase,
} from "./config.ts";

import type { EnvSource } from "@/lib/env";
import type {
  ConsumerSubscriptionInput,
  OperatorAccrualSnapshot,
  ReferralAccrualSnapshot,
  RevenueHandlerResult,
  RevenueIncompleteCode,
  RevenueRepository,
} from "./types.ts";

export type RevenueLog = Readonly<{
  code: string | null;
  durationMs: number;
  job: "billing.accruals";
  rows: number;
  status: RevenueHandlerResult["status"];
}>;

export type BillingAccrualOptions = {
  env?: EnvSource;
  logger?: (event: RevenueLog) => void;
  now?: () => number;
  repository?: RevenueRepository;
};

type Basis = {
  baseAmountCents: number;
  incompleteCode: RevenueIncompleteCode | null;
  isComplete: boolean;
  sourceRowCount: number;
};

function consumerBasis(
  rows: readonly ConsumerSubscriptionInput[],
  refundAmountCents: number,
): Basis {
  if (rows.length === 0) {
    return { baseAmountCents: 0, incompleteCode: "consumer_subscriptions_missing", isComplete: false, sourceRowCount: 0 };
  }
  if (rows.some((row) => row.provider === "stripe")) {
    return { baseAmountCents: 0, incompleteCode: "paid_invoice_evidence_missing", isComplete: false, sourceRowCount: 0 };
  }
  return {
    baseAmountCents: Math.max(
      0,
      rows.reduce((sum, row) => sum + row.priceCents, 0) - refundAmountCents,
    ),
    incompleteCode: null,
    isComplete: true,
    sourceRowCount: rows.length,
  };
}

function operatorSnapshot(
  operatorOrgId: string,
  basis: Basis,
  pctSnapshot: number | null,
): OperatorAccrualSnapshot {
  if (pctSnapshot === null) {
    return {
      amountCents: null,
      baseAmountCents: basis.baseAmountCents,
      incompleteCode: "monitoring_split_unset",
      isComplete: false,
      operatorOrgId,
      pctSnapshot: null,
      sourceRowCount: basis.sourceRowCount,
    };
  }
  return {
    amountCents: percentageAmountCents(basis.baseAmountCents, pctSnapshot),
    baseAmountCents: basis.baseAmountCents,
    incompleteCode: basis.incompleteCode,
    isComplete: basis.isComplete,
    operatorOrgId,
    pctSnapshot,
    sourceRowCount: basis.sourceRowCount,
  };
}

export async function runBillingAccrual(
  subject: string,
  window: string,
  options: BillingAccrualOptions = {},
): Promise<RevenueHandlerResult> {
  const started = options.now?.() ?? Date.now();
  let status: RevenueHandlerResult["status"] = "failed";
  let rows = 0;
  let code: string | null = null;
  try {
    const operatorOrgId = parseOperatorSubject(subject);
    const accrualMonth = parseAccrualWindow(window);
    const env = options.env ?? process.env;
    const repository = options.repository
      ?? (await import("./repository.ts")).productionRevenueRepository();
    const inputs = await repository.readAccrualInputs(operatorOrgId, accrualMonth);
    const monitoringBasis = consumerBasis(
      inputs.consumerSubscriptions,
      inputs.refundAmountCents,
    );
    const split = resolveMonitoringSplit(env);
    const operator = operatorSnapshot(operatorOrgId, monitoringBasis, split);
    const referrals: ReferralAccrualSnapshot[] = [];

    if (inputs.referral) {
      const cycleNumber = referralCycle(inputs.referral.startedAt, accrualMonth);
      if (cycleNumber !== null) {
        const configuredBase = resolveReferralBase(env);
        const baseSnapshot = inputs.referral.base ?? configuredBase;
        let basis: Basis;
        if (baseSnapshot === "consumer_subscriptions") {
          basis = monitoringBasis;
        } else if (
          inputs.operatorSubscription
          && ["active", "trialing"].includes(inputs.operatorSubscription.status)
        ) {
          const prices = operatorPrices(env, {
            basePriceCents: inputs.orgBasePriceCents,
            seatPriceCents: inputs.orgSeatPriceCents,
          });
          basis = {
            baseAmountCents: prices.basePriceCents
              + prices.seatPriceCents * inputs.operatorSubscription.seatQuantity,
            incompleteCode: null,
            isComplete: true,
            sourceRowCount: 1,
          };
        } else {
          basis = {
            baseAmountCents: 0,
            incompleteCode: "platform_subscription_missing",
            isComplete: false,
            sourceRowCount: 0,
          };
        }
        const referralPercentage = resolvePercentage("saas_referral", {
          config: inputs.referral.pct,
        }).value;
        if (referralPercentage === null) throw new Error("REVENUE_PERCENT_INVALID");
        referrals.push({
          accrualMonth,
          amountCents: percentageAmountCents(basis.baseAmountCents, referralPercentage),
          baseAmountCents: basis.baseAmountCents,
          baseSnapshot,
          cycleNumber,
          incompleteCode: basis.incompleteCode,
          isComplete: basis.isComplete,
          pctSnapshot: referralPercentage,
          referredOrgId: inputs.referral.referredOrgId,
          referrerOrgId: inputs.referral.referrerOrgId,
          saasReferralId: inputs.referral.id,
          sourceRowCount: basis.sourceRowCount,
        });
      }
    }

    const posted = await repository.postBillingAccrual({ accrualMonth, operator, referrals });
    rows = posted.operatorRows + posted.referralRows;
    status = rows === 0 ? "skipped" : "ok";
    return rows === 0 ? { status } : { status, rows };
  } catch (error) {
    code = error instanceof Error && /^[A-Z0-9_]{1,64}$/.test(error.message)
      ? error.message
      : "REVENUE_ACCRUAL_FAILED";
    return { status: "failed" };
  } finally {
    options.logger?.({
      code,
      durationMs: Math.max(0, (options.now?.() ?? Date.now()) - started),
      job: "billing.accruals",
      rows,
      status,
    });
  }
}
