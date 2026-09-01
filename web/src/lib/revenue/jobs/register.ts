import { registerCadenceProvider, registerJobHandler } from "@/lib/jobs/registry";

import { runBillingAccrual } from "../accruals.ts";

import type { CadenceProvider } from "@/lib/jobs/types";
import type { RevenueRepository } from "../types.ts";

export function utcMonth(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function justClosedUtcMonth(now: Date): string {
  return utcMonth(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
}

export function createBillingAccrualCadenceProvider(
  repository: Pick<RevenueRepository, "listAccrualOrgIds">,
): CadenceProvider {
  return async (now) => (await repository.listAccrualOrgIds()).map((orgId) => ({
    job: "billing.accruals" as const,
    subject: `org:${orgId}`,
    window: justClosedUtcMonth(now),
  }));
}

registerJobHandler("billing.accruals", runBillingAccrual, "FEATURE_REVENUE");
registerCadenceProvider("billing.accruals", async (now) => {
  const { productionRevenueRepository } = await import("../repository.ts");
  return createBillingAccrualCadenceProvider(productionRevenueRepository())(now);
}, "FEATURE_REVENUE");
