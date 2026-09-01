import { isRevenueIncompleteCode, parseAccrualWindow } from "./config.ts";

import type { RevenueKpis, RevenueRpcClient } from "./types.ts";

export async function readRevenueKpis(
  window: string,
  client: RevenueRpcClient,
): Promise<RevenueKpis> {
  const { data, error } = await client.rpc("revenue_read_kpis", {
    p_accrual_month: parseAccrualWindow(window),
  });
  if (error) throw new Error("REVENUE_DATABASE_ERROR");
  const value = Array.isArray(data) ? data[0] : data;
  if (!value || typeof value !== "object") throw new Error("REVENUE_KPI_INVALID");
  const row = value as Record<string, unknown>;
  const monitoring = row.monitoring_share_total_cents;
  const referral = row.saas_referral_total_cents;
  const codes = Array.isArray(row.incomplete_codes) ? row.incomplete_codes : [];
  if (
    typeof monitoring !== "number" || !Number.isSafeInteger(monitoring) || monitoring < 0
    || typeof referral !== "number" || !Number.isSafeInteger(referral) || referral < 0
    || typeof row.is_complete !== "boolean"
    || !codes.every(isRevenueIncompleteCode)
  ) throw new Error("REVENUE_KPI_INVALID");
  return {
    complete: row.is_complete,
    incompleteCodes: [...new Set(codes)].sort(),
    monitoringShareTotalCents: monitoring,
    saasReferralTotalCents: referral,
  };
}
