import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveConfiguredPrice,
  resolvePercentage,
  resolvePrice,
  resolveReferralBase,
} from "./index.ts";

describe("pricing resolver", () => {
  it("returns every decided price placeholder with provenance", () => {
    assert.deepEqual(resolvePrice("consumer_monitoring", { env: {} }), {
      key: "consumer_monitoring", valueCents: 4_900, currency: "usd", source: "placeholder",
      priceRef: "mock_price_monitoring", priceRefSource: "placeholder",
    });
    assert.equal(resolvePrice("force_pull", { env: {} }).valueCents, 1_900);
    assert.equal(resolvePrice("operator_base", { env: {} }).valueCents, 49_700);
    assert.equal(resolvePrice("operator_seat", { env: {} }).valueCents, 2_900);
  });

  it("uses env before persisted config and config before placeholder", () => {
    assert.deepEqual(
      resolvePrice("operator_base", { env: { OPERATOR_BASE_PRICE_CENTS: "59900" }, config: 39_900 }),
      {
        key: "operator_base", valueCents: 59_900, currency: "usd", source: "env",
        priceRef: "mock_price_operator_base", priceRefSource: "placeholder",
      },
    );
    assert.equal(resolvePrice("operator_base", { env: {}, config: 39_900 }).source, "config");
  });

  it("resolves bare and tiered references without guessing an absent tier", () => {
    assert.equal(resolvePrice("operator_base", {
      env: { STRIPE_PRICE_OPERATOR_BASE: "price_base" },
    }).priceRef, "price_base");
    assert.equal(resolvePrice("operator_base", {
      env: { STRIPE_PRICE_OPERATOR_BASE: "pro=price_pro,agency=price_agency" }, plan: "agency",
    }).priceRef, "price_agency");
    assert.equal(resolvePrice("operator_base", {
      env: { STRIPE_PRICE_OPERATOR_BASE: "pro=price_pro" }, plan: "trial",
    }).priceRef, "mock_price_operator_base");
  });

  it("keeps the decided 40 placeholder separate from an effective null split", () => {
    assert.deepEqual(resolvePercentage("monitoring_split", { env: {} }), {
      key: "monitoring_split", value: null, placeholder: 40, source: "ruled_null",
    });
    assert.equal(resolvePercentage("monitoring_split", { env: { MONITORING_SPLIT_PCT: "20.50" } }).value, 20.5);
    assert.equal(resolvePercentage("monitoring_split", { env: {}, config: 35 }).source, "config");
  });

  it("passes authoritative fee and referral values through as config", () => {
    assert.deepEqual(resolveConfiguredPrice("fee_success", 250_000), {
      key: "fee_success", valueCents: 250_000, currency: "usd", source: "config",
      priceRef: null, priceRefSource: null,
    });
    assert.equal(resolvePercentage("saas_referral", { config: 20 }).source, "config");
    assert.equal(resolvePercentage("fee_percentage", { config: 12.5 }).value, 12.5);
  });

  it("resolves referral base through env, config and the ratified placeholder", () => {
    assert.deepEqual(resolveReferralBase({ env: {} }), { value: "platform_subscription", source: "placeholder" });
    assert.deepEqual(resolveReferralBase({ env: {}, configRef: "consumer_subscriptions" }), { value: "consumer_subscriptions", source: "config" });
    assert.deepEqual(resolveReferralBase({ env: { SAAS_REFERRAL_BASE: "consumer_subscriptions" } }), { value: "consumer_subscriptions", source: "env" });
  });

  it("rejects malformed, fractional, negative and out-of-bound values without echoing input", () => {
    for (const raw of ["12.5", "-1", "100000001", "private-value"]) {
      assert.throws(
        () => resolvePrice("force_pull", { env: { FORCE_PULL_PRICE_CENTS: raw } }),
        (error) => error instanceof Error && error.message === "PRICING_CENTS_INVALID" && !error.message.includes(raw),
      );
    }
    for (const raw of ["-1", "100.01", "20.001", "private-value"]) {
      assert.throws(() => resolvePercentage("monitoring_split", { env: { MONITORING_SPLIT_PCT: raw } }), /PRICING_PERCENT_INVALID/);
    }
    assert.throws(() => resolveConfiguredPrice("fee_upfront", -1), /PRICING_CENTS_INVALID/);
    assert.throws(() => resolvePercentage("fee_percentage", { config: 10.001 }), /PRICING_PERCENT_INVALID/);
  });

  it("returns frozen exact-key results", () => {
    const result = resolvePrice("force_pull", { env: {} });
    assert.equal(Object.isFrozen(result), true);
    assert.deepEqual(Object.keys(result).sort(), ["currency", "key", "priceRef", "priceRefSource", "source", "valueCents"]);
    assert.equal(Number.isInteger(result.valueCents), true);
  });
});
