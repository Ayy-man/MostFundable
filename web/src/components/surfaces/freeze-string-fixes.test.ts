import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import {
  deriveOperatorBillingRows,
  deriveSaasMetrics,
  OPERATOR_FIXTURES,
} from "@/lib/demo/feedback-fixtures";
import { selectRevenueMetrics } from "@/lib/revenue/client";

const adminSource = fs.readFileSync(new URL("./admin.tsx", import.meta.url), "utf8");
const operatorSource = fs.readFileSync(new URL("./operator.tsx", import.meta.url), "utf8");
const fixtureSource = fs.readFileSync(
  new URL("../../lib/demo/feedback-fixtures.ts", import.meta.url),
  "utf8",
);

describe("freeze string fixes", () => {
  it("keeps the admin environment and review claims truthful", () => {
    for (const staleClaim of [
      "Environment separation",
      "Staging service key rotated",
      "Production credentials were not changed",
      "Distinct keys, databases, and deployment targets",
      "Rotate staging key",
      "Environment: staging",
      "Rotated staging service key",
    ]) {
      assert.equal(adminSource.includes(staleClaim), false, `stale environment claim: ${staleClaim}`);
    }

    for (const truth of [
      "Single production environment",
      "main deploys to production. No separate staging project, database, key set, or deployment target is configured.",
      "Review production service-key rotation?",
      "This demo records the review only. Rotating the production service key requires coordinated replacement across every production job and integration.",
      "Production key-rotation review recorded. No credential was changed in this demo.",
      'action: "Reviewed production service-key rotation"',
      'target: "environment.production"',
    ]) {
      assert.ok(adminSource.includes(truth), `missing environment truth: ${truth}`);
    }
  });

  it("keeps the Agency correction coupled without guessing the Pro price", () => {
    const apex = OPERATOR_FIXTURES.find((operator) => operator.id === "op-apex");
    const liberty = OPERATOR_FIXTURES.find((operator) => operator.id === "op-liberty");
    assert.ok(apex);
    assert.ok(liberty);
    assert.deepEqual(
      {
        additionalFees: apex.additionalFees,
        platformFee: apex.platformFee,
        referralSplit: apex.referralSplit,
      },
      { additionalFees: (apex.seats - apex.includedSeats) * 29, platformFee: 497, referralSplit: 49.7 },
    );
    assert.deepEqual(
      { platformFee: liberty.platformFee, referralSplit: liberty.referralSplit },
      { platformFee: 249, referralSplit: 24.9 },
    );
    assert.equal(deriveOperatorBillingRows().find((operator) => operator.id === "op-apex")?.payment, 555);
    assert.equal(fixtureSource.includes("platformFee: 4" + "99"), false);
    assert.equal(fixtureSource.includes("referralSplit: 49" + ".9"), false);
  });

  it("derives the corrected aggregate totals from fixture inputs", () => {
    const metrics = deriveSaasMetrics();
    assert.equal(metrics.platformMrr, 804);
    assert.equal(metrics.monthlyRecurringTotal, 11927);
    assert.equal(metrics.referralSplit, 74.6);
  });

  it("labels fixture prices while preserving live revenue selection", () => {
    for (const label of [
      "Agency placeholder: $497 base + $29 per additional seat, pending the pricing session. Pro: $249 unresolved fixture value.",
      "Agency is a $497 base + $29 per additional seat placeholder pending the pricing session; Pro $249 is an unresolved fixture value.",
    ]) {
      assert.ok(adminSource.includes(label), `missing admin fixture label: ${label}`);
    }
    assert.ok(
      operatorSource.includes(
        "Illustrative placeholder: $497 base + $29 per additional seat, pending the pricing session.",
      ),
    );
    assert.equal(adminSource.includes("$4" + "99"), false);
    assert.equal(operatorSource.includes("$4" + "99"), false);

    const fixture = deriveSaasMetrics();
    const live = {
      complete: true,
      enabled: true as const,
      incompleteCodes: [],
      monitoringShareTotalCents: 12_345,
      saasReferralTotalCents: 6_789,
    };
    assert.deepEqual(selectRevenueMetrics(fixture, live), {
      ...fixture,
      monitoringProfit: 123.45,
      referralSplit: 67.89,
    });
  });
});
