import assert from "node:assert/strict";
import { test } from "node:test";

import { summarizeAffiliateRows } from "@/lib/affiliates/kpis";
import type { AffiliateViewRow } from "@/lib/affiliates/types";

const base: AffiliateViewRow = {
  expected_commission_cents: null,
  funded_amount_cents: 100,
  payment_status: "not_ready",
  stage: "onboarding",
  started_at: "2026-08-10",
};

test("affiliate KPI formulas and UTC seven-day boundary are exact", () => {
  const result = summarizeAffiliateRows([
    base,
    { ...base, funded_amount_cents: 200, stage: "optimization", started_at: "2026-08-11" },
    { ...base, funded_amount_cents: 300, stage: "ready" },
    { ...base, funded_amount_cents: 400, stage: "applying" },
    { ...base, funded_amount_cents: 500, stage: "funded" },
    { ...base, funded_amount_cents: 600, stage: "graduate" },
  ], new Date("2026-08-17T23:59:59.000Z"));
  assert.deepEqual(result.kpis, {
    active: 5,
    fundingRecordedCents: 2100,
    inPipeline: 3,
    sentLeads: 6,
  });
  assert.equal(result.rows[0]?.needsAttention, true);
  assert.equal(result.rows[1]?.needsAttention, false);
  assert.deepEqual(Object.keys(result.rows[0] ?? {}).sort(), [
    "expectedCommissionCents", "fundedAmountCents", "needsAttention",
    "paymentStatus", "stage", "startedAt",
  ]);
});

test("six days is not attention and unsafe totals fail closed", () => {
  assert.equal(
    summarizeAffiliateRows([{ ...base, started_at: "2026-08-11" }], new Date("2026-08-17T00:01:00Z")).rows[0]?.needsAttention,
    false,
  );
  assert.throws(() => summarizeAffiliateRows([
    { ...base, funded_amount_cents: Number.MAX_SAFE_INTEGER },
    { ...base, funded_amount_cents: 1 },
  ], new Date()), RangeError);
});
