import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { paidRefreshDriverVisible, paidRefreshPurchasesReady } from "./paid-refresh-availability.ts";

const STRIPE = {
  BILLING_DRIVER: "stripe",
  CONSUMER_MONITORING_PRICE_REF: "price_monitoring",
  NODE_ENV: "production",
  STRIPE_PRICE_OPERATOR_BASE: "price_base",
  STRIPE_PRICE_OPERATOR_SEAT: "price_seat",
  STRIPE_SECRET_KEY: "secret",
  STRIPE_WEBHOOK_SECRET: "webhook",
} as const;

const PRODUCTION_READY = {
  ...STRIPE,
  CRS_API_KEY: "api-key",
  CRS_BASE_URL: "https://sandbox.crs.example",
  CRS_DRIVER: "sandbox",
  CRS_SECRET: "secret",
} as const;

describe("paid refresh production availability", () => {
  it("fails closed unless production has both Stripe and sandbox CRS", () => {
    assert.equal(paidRefreshPurchasesReady({ NODE_ENV: "production" }), false);
    assert.equal(paidRefreshPurchasesReady({ BILLING_DRIVER: "stripe", NODE_ENV: "production" }), false);
    assert.equal(paidRefreshPurchasesReady(STRIPE), false);
    assert.equal(paidRefreshPurchasesReady({ ...STRIPE, CRS_DRIVER: "mock" }), false);
    assert.equal(paidRefreshPurchasesReady(PRODUCTION_READY), true);
  });

  it("keeps deterministic mock billing limited to non-production environments", () => {
    assert.equal(paidRefreshPurchasesReady({ NODE_ENV: "test" }), true);
    assert.equal(paidRefreshDriverVisible("mock", { NODE_ENV: "test" }), true);
    assert.equal(paidRefreshDriverVisible("mock", { NODE_ENV: "production" }), false);
    assert.equal(paidRefreshDriverVisible("stripe", { NODE_ENV: "production" }), true);
  });
});
