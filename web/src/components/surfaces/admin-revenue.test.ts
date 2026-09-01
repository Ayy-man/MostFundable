import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import { revenuePresentation, selectRevenueMetrics } from "@/lib/revenue/client";
import { deriveSaasMetrics } from "@/lib/demo/feedback-fixtures";

const source = fs.readFileSync(new URL("./admin.tsx", import.meta.url), "utf8");

describe("admin revenue branches", () => {
  /**
   * The four earnings figures used to render `formatDemoMoney(metrics.*)` off
   * `deriveSaasMetrics()`. They no longer do: platform MRR is summed from the
   * `orgs` plan and seat columns, monitoring share and SaaS referral share come
   * from the revenue ledger, and the combined recurring total has no recorded
   * source at all. This guard therefore asserts the absence of the fixture
   * expressions and the presence of the durable ones — the labels either side
   * of them are still frozen and still checked.
   */
  it("renders no earnings figure from the demo fixture module", () => {
    for (const expression of [
      "metrics.monthlyRecurringTotal",
      "metrics.platformMrr",
      "metrics.monitoringProfit",
      "metrics.referralSplit",
      "deriveSaasMetrics",
    ]) assert.equal(source.includes(expression), false, `fixture earnings expression is back: ${expression}`);
    assert.ok(source.includes("/api/admin/saas-metrics"), "the durable subscription total is never read");
    assert.ok(source.includes("saasRead.platformMrrCents"), "platform MRR no longer renders the durable total");
    assert.ok(
      source.includes("monitoringShareTotalCents") && source.includes("saasReferralTotalCents"),
      "the ledger share values are no longer read from the revenue payload",
    );
  });

  it("retains the exact flag-off labels and notices", () => {
    for (const literal of [
      "Illustrative fixture assumptions: Agency is a $497 base + $29 per additional seat placeholder pending the pricing session; Pro $249 is an unresolved fixture value. The operator monitoring share is",
      "Monitoring profit",
      "Referral split",
      "Monthly monitoring profit",
      "Monthly referral split",
    ]) assert.ok(source.includes(literal), `missing frozen flag-off source: ${literal}`);
  });

  it("a figure with no recorded source renders a dash, never a zero", () => {
    // The recurring total needs monitoring subscription revenue, which no table
    // records, so its value is a literal dash with the reason beside it.
    assert.ok(
      source.includes('{ label: "Monthly recurring total", value: "—"'),
      "the recurring total renders a number again",
    );
    assert.ok(
      source.includes("monitoring subscription revenue has no recorded source"),
      "the dash no longer states why it is a dash",
    );
  });

  it("returns the original fixture values and labels while live state is null", () => {
    const fixture = deriveSaasMetrics();
    assert.equal(selectRevenueMetrics(fixture, null), fixture);
    assert.deepEqual(revenuePresentation(null), {
      complete: true,
      enabled: false,
      failed: false,
      monitoringLabel: "Monitoring profit",
      referralLabel: "Referral split",
    });
  });

  it("changes only the two targeted values and labels after enablement", () => {
    const fixture = deriveSaasMetrics();
    const live = {
      complete: true,
      enabled: true as const,
      incompleteCodes: [],
      monitoringShareTotalCents: 11_100,
      saasReferralTotalCents: 2_200,
    };
    const selected = selectRevenueMetrics(fixture, live);
    assert.deepEqual(
      Object.keys(selected).filter((key) => selected[key as keyof typeof selected] !== fixture[key as keyof typeof fixture]).sort(),
      ["monitoringProfit", "referralSplit"],
    );
    assert.deepEqual(revenuePresentation(live), {
      complete: true,
      enabled: true,
      failed: false,
      monitoringLabel: "Monthly monitoring share",
      referralLabel: "Monthly SaaS referral share",
    });
  });

  it("renders enabled incomplete zeroes with an explicit notice source", () => {
    assert.ok(source.includes("Revenue ledger data is incomplete. Missing monitoring-share or SaaS-referral inputs are shown as zero."));
  });

  it("fetches the private billing mode only inside BillingView and renders no off node", () => {
    const billingStart = source.indexOf("function BillingView");
    const billingEnd = source.indexOf("function SecurityView", billingStart);
    const billing = source.slice(billingStart, billingEnd);
    assert.match(billing, /fetch\("\/api\/billing\/config", \{ cache: "no-store" \}\)/);
    // The mode is a tri-state since the failed-read disclosure fix: "test"
    // renders the test-mode line, "unknown" renders its own notice, and the
    // flag-off 404 stays a known live-labelled state, never a failure.
    assert.match(billing, /stripeMode === "test" \? <p[^>]*>Stripe test mode<\/p> : null/);
    assert.match(billing, /stripeMode === "unknown" \? <p[^>]*>Billing configuration could not be read/);
    assert.equal((billing.match(/Stripe test mode/g) ?? []).length, 1);
    assert.equal(source.slice(0, billingStart).includes("/api/billing/config"), false);
  });
});
