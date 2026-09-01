import {
  type AffiliatePortal,
  type AffiliatePortalRow,
  type AffiliateViewRow,
} from "@/lib/affiliates/types";

const PIPELINE_STAGES = new Set(["optimization", "ready", "applying"]);
const DAY_MS = 24 * 60 * 60 * 1000;

function utcDay(value: Date): number {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

function mappedRow(row: AffiliateViewRow, now: Date): AffiliatePortalRow {
  const startedAt = new Date(`${row.started_at}T00:00:00.000Z`);
  const ageDays = Number.isNaN(startedAt.getTime())
    ? -1
    : Math.floor((utcDay(now) - startedAt.getTime()) / DAY_MS);
  return {
    expectedCommissionCents: row.expected_commission_cents,
    fundedAmountCents: row.funded_amount_cents,
    needsAttention: row.stage === "onboarding" && ageDays >= 7,
    paymentStatus: row.payment_status,
    stage: row.stage,
    startedAt: row.started_at,
  };
}

export function summarizeAffiliateRows(
  sourceRows: readonly AffiliateViewRow[],
  now: Date,
): AffiliatePortal {
  let fundingRecordedCents = 0;
  for (const row of sourceRows) {
    if (!Number.isSafeInteger(row.funded_amount_cents) || row.funded_amount_cents < 0) {
      throw new RangeError("Affiliate funding total is outside the safe integer range.");
    }
    fundingRecordedCents += row.funded_amount_cents;
    if (!Number.isSafeInteger(fundingRecordedCents)) {
      throw new RangeError("Affiliate funding total is outside the safe integer range.");
    }
  }

  return {
    kpis: {
      active: sourceRows.filter((row) => row.stage !== "graduate").length,
      fundingRecordedCents,
      inPipeline: sourceRows.filter((row) => PIPELINE_STAGES.has(row.stage)).length,
      sentLeads: sourceRows.length,
    },
    rows: sourceRows.map((row) => mappedRow(row, now)),
  };
}
