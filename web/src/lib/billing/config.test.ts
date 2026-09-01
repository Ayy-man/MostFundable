import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  operatorGraceDays,
  operatorPrices,
} from "@/lib/billing/config";

describe("operator price resolution", () => {
  it("answers with the documented defaults on an empty environment", () => {
    const prices = operatorPrices({});

    assert.equal(prices.basePriceCents, 49_700);
    assert.equal(prices.seatPriceCents, 2_900);
    assert.equal(prices.basePriceRef, "mock_price_operator_base");
    assert.equal(prices.seatPriceRef, "mock_price_operator_seat");
    assert.equal(prices.currency, "usd");
  });

  it("prefers the organization's persisted cents over the documented default", () => {
    const prices = operatorPrices(
      {},
      { basePriceCents: 39_900, plan: "pro", seatPriceCents: 1_900 },
    );

    assert.equal(prices.basePriceCents, 39_900);
    assert.equal(prices.seatPriceCents, 1_900);
  });

  it("prefers an environment override over the organization's persisted cents", () => {
    const prices = operatorPrices(
      {
        OPERATOR_BASE_PRICE_CENTS: "59900",
        OPERATOR_SEAT_PRICE_CENTS: "3900",
      },
      { basePriceCents: 39_900, plan: "pro", seatPriceCents: 1_900 },
    );

    assert.equal(prices.basePriceCents, 59_900);
    assert.equal(prices.seatPriceCents, 3_900);
  });

  it("fails closed on a malformed or non-positive explicit override", () => {
    for (const env of [
      { OPERATOR_BASE_PRICE_CENTS: "four hundred ninety seven dollars" },
      { OPERATOR_SEAT_PRICE_CENTS: "-2900" },
      { OPERATOR_SEAT_PRICE_CENTS: "0" },
    ]) {
      assert.throws(
        () => operatorPrices(env, { basePriceCents: 39_900, plan: "pro", seatPriceCents: 1_900 }),
        /PRICING_CENTS_INVALID/,
      );
    }

    assert.equal(operatorPrices({ OPERATOR_BASE_PRICE_CENTS: "" }).basePriceCents, 49_700);
  });

  it("uses a bare price reference directly", () => {
    const prices = operatorPrices(
      {
        STRIPE_PRICE_OPERATOR_BASE: "price_bare_base",
        STRIPE_PRICE_OPERATOR_SEAT: "price_bare_seat",
      },
      { plan: "agency" },
    );

    assert.equal(prices.basePriceRef, "price_bare_base");
    assert.equal(prices.seatPriceRef, "price_bare_seat");
  });

  it("selects a price reference by tier when the key holds a plan list", () => {
    const env = {
      STRIPE_PRICE_OPERATOR_BASE: "pro=price_pro_base,agency=price_agency_base",
      STRIPE_PRICE_OPERATOR_SEAT: "pro=price_pro_seat,agency=price_agency_seat",
    };

    assert.equal(
      operatorPrices(env, { plan: "agency" }).basePriceRef,
      "price_agency_base",
    );
    assert.equal(
      operatorPrices(env, { plan: "pro" }).seatPriceRef,
      "price_pro_seat",
    );
  });

  it("keeps the documented reference when a plan list names no entry for the tier", () => {
    const prices = operatorPrices(
      { STRIPE_PRICE_OPERATOR_BASE: "pro=price_pro_base" },
      { plan: "trial" },
    );

    assert.equal(prices.basePriceRef, "mock_price_operator_base");
  });

  it("tolerates whitespace and an absent organization in a plan list", () => {
    const env = {
      STRIPE_PRICE_OPERATOR_BASE: " pro = price_pro_base , agency = price_agency_base ",
    };

    assert.equal(operatorPrices(env, { plan: "pro" }).basePriceRef, "price_pro_base");
    assert.equal(operatorPrices(env).basePriceRef, "mock_price_operator_base");
  });

  it("reads process.env when no environment is passed", () => {
    assert.equal(typeof operatorPrices().basePriceCents, "number");
  });
});

describe("operator grace window", () => {
  it("defaults to seven days", () => {
    assert.equal(operatorGraceDays({}), 7);
  });

  it("reads a configured window", () => {
    assert.equal(operatorGraceDays({ OPERATOR_GRACE_DAYS: "14" }), 14);
  });

  it("falls back rather than throwing on a malformed or negative window", () => {
    assert.equal(operatorGraceDays({ OPERATOR_GRACE_DAYS: "soon" }), 7);
    assert.equal(operatorGraceDays({ OPERATOR_GRACE_DAYS: "-3" }), 7);
    assert.equal(operatorGraceDays({ OPERATOR_GRACE_DAYS: "0" }), 7);
  });
});
