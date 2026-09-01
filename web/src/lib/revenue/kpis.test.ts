import assert from "node:assert/strict";
import test from "node:test";

import { readRevenueKpis } from "./kpis.ts";

import type { RevenueRpcClient } from "./types.ts";

function client(data: unknown, error: { code?: string } | null = null): RevenueRpcClient {
  return { async rpc() { return { data, error }; } };
}

test("KPI service returns ledger totals and completeness only", async () => {
  assert.deepEqual(await readRevenueKpis("2026-08", client([{
    incomplete_codes: [],
    is_complete: true,
    monitoring_share_total_cents: 4_200,
    saas_referral_total_cents: 8_400,
  }])), {
    complete: true,
    incompleteCodes: [],
    monitoringShareTotalCents: 4_200,
    saasReferralTotalCents: 8_400,
  });
});

test("enabled zero remains distinguishable by completeness metadata", async () => {
  const complete = await readRevenueKpis("2026-08", client([{
    incomplete_codes: [], is_complete: true,
    monitoring_share_total_cents: 0, saas_referral_total_cents: 0,
  }]));
  const incomplete = await readRevenueKpis("2026-08", client([{
    incomplete_codes: ["operator_rows_missing", "operator_rows_missing"], is_complete: false,
    monitoring_share_total_cents: 0, saas_referral_total_cents: 0,
  }]));
  assert.equal(complete.complete, true);
  assert.equal(incomplete.complete, false);
  assert.deepEqual(incomplete.incompleteCodes, ["operator_rows_missing"]);
});

test("malformed rows, invalid months, and database failures reject", async () => {
  await assert.rejects(() => readRevenueKpis("2026-8", client([])), /REVENUE_WINDOW_INVALID/);
  await assert.rejects(() => readRevenueKpis("2026-08", client([])), /REVENUE_KPI_INVALID/);
  await assert.rejects(() => readRevenueKpis("2026-08", client([{
    incomplete_codes: ["unknown"], is_complete: false,
    monitoring_share_total_cents: null, saas_referral_total_cents: 0,
  }])), /REVENUE_KPI_INVALID/);
  await assert.rejects(() => readRevenueKpis("2026-08", client(null, { code: "42501" })), /REVENUE_DATABASE_ERROR/);
});
