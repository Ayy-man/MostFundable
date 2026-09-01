import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { setupIntentKey, subscriptionKey } from "./ids";
import { createMockAdapter } from "./mock";
import { createStripeAdapter } from "./stripe";
import type { BillingAdapter } from "./types";

function contract(
  name: string,
  make: () => BillingAdapter,
  options: { skip: false | string },
) {
  describe(`billing contract — ${name}`, () => {
    it("authorizes a card without returning charge or subscription fields", { skip: options.skip }, async () => {
      const result = await make().createSetupIntent({
        clientId: "client-a",
        email: "consumer@example.test",
        enrollmentId: "enrollment-a",
        fullName: "Demo Consumer",
      });
      assert.ok(result.customerRef, "card authorization returned no customer reference");
      assert.ok(result.setupIntentRef, "card authorization returned no setup-intent reference");
      assert.ok(!("amount" in result), "card authorization unexpectedly returned an amount");
      assert.ok(!("amountCents" in result), "card authorization unexpectedly returned an amount in cents");
      assert.ok(!("subscriptionRef" in result), "card authorization unexpectedly created a subscription");
    });

    it("reuses the same subscription for a repeated deterministic key", { skip: options.skip }, async () => {
      const adapter = make();
      const request = {
        customerRef: "mock_cus_clienta",
        enrollmentId: "enrollment-a",
        idempotencyKey: subscriptionKey("enrollment-a"),
        operationId: subscriptionKey("enrollment-a"),
        paymentMethodRef: "mock_pm_enrollmenta",
        priceRef: "mock_price_monitoring",
      };
      const first = await adapter.startSubscription(request);
      const second = await adapter.startSubscription(request);
      assert.equal(
        second.subscriptionRef,
        first.subscriptionRef,
        "a retry produced a second subscription reference",
      );
    });

    it("separates setup-intent and subscription idempotency keys", { skip: options.skip }, () => {
      assert.notEqual(
        setupIntentKey("enrollment-a"),
        subscriptionKey("enrollment-a"),
        "authorization and subscription calls share an idempotency key",
      );
    });

    it("rejects a webhook with no signature", { skip: options.skip }, async () => {
      await assert.rejects(
        make().parseWebhook("{}", null),
        "the billing driver accepted an unsigned webhook",
      );
    });

    it("returns a payment-method reference after card confirmation", { skip: options.skip }, async () => {
      const result = await make().confirmCard({
        demoCardLast4: "4242",
        setupIntentRef: "mock_seti_enrollmenta",
      });
      assert.ok(
        result.paymentMethodRef,
        "card confirmation returned no payment-method reference",
      );
    });
  });
}

const stripeKey = process.env.STRIPE_SECRET_KEY;

contract("mock", createMockAdapter, { skip: false });
contract("stripe", () => createStripeAdapter(stripeKey as string), {
  skip: stripeKey
    ? false
    : "STRIPE_SECRET_KEY absent — real-driver contract skipped, not failed",
});
