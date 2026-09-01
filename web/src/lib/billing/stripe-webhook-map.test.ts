// stripe-webhook-map.test.ts — the mapping from a provider event to routing keys.
//
// Built over hand-written event objects rather than live SDK calls, because the
// defect this suite exists to pin (G10-01) was a disagreement between our shape
// and Stripe's, and a fixture generated from our own mock could not have caught
// it. Every shape below is read off the pinned SDK's `Invoices.d.ts` and
// `Subscriptions.d.ts` at `2026-07-29.dahlia`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type Stripe from "stripe";

import { mapWebhook } from "@/lib/billing/stripe";

function event(type: string, object: Record<string, unknown>): Stripe.Event {
  return {
    created: 1_786_000_000,
    data: { object },
    id: `evt_${type.replace(/[^a-z]/g, "_")}`,
    type,
  } as unknown as Stripe.Event;
}

describe("mapWebhook on the pinned api version", () => {
  it("resolves an invoice's subscription from parent.subscription_details", () => {
    const parsed = mapWebhook(
      event("invoice.paid", {
        attempt_count: 0,
        customer: "cus_dahlia",
        parent: {
          subscription_details: { subscription: "sub_from_parent" },
          type: "subscription_details",
        },
      }),
    );

    assert.equal(parsed.subscriptionRef, "sub_from_parent");
    assert.equal(parsed.customerRef, "cus_dahlia");
    assert.equal(parsed.eventType, "invoice.paid");
  });

  it("resolves it when the parent reference is expanded to an object", () => {
    const parsed = mapWebhook(
      event("invoice.paid", {
        parent: {
          subscription_details: {
            subscription: { id: "sub_expanded", object: "subscription" },
          },
          type: "subscription_details",
        },
      }),
    );

    assert.equal(parsed.subscriptionRef, "sub_expanded");
  });

  it("still resolves the legacy top-level field, so nothing that works today stops", () => {
    const parsed = mapWebhook(
      event("invoice.paid", {
        customer: "cus_legacy",
        subscription: "sub_legacy_top_level",
      }),
    );

    assert.equal(parsed.subscriptionRef, "sub_legacy_top_level");
  });

  it("prefers the parent reference over a legacy field when both are present", () => {
    const parsed = mapWebhook(
      event("invoice.paid", {
        parent: {
          subscription_details: { subscription: "sub_from_parent" },
          type: "subscription_details",
        },
        subscription: "sub_legacy_top_level",
      }),
    );

    assert.equal(parsed.subscriptionRef, "sub_from_parent");
  });

  it("reads an invoice with no subscription parent as carrying no subscription", () => {
    const parsed = mapWebhook(
      event("invoice.paid", {
        parent: { quote_details: { quote: "qt_1" }, subscription_details: null, type: "quote_details" },
      }),
    );

    assert.equal(parsed.subscriptionRef, null);
  });

  it("uses the object id on a subscription event", () => {
    const parsed = mapWebhook(
      event("customer.subscription.updated", {
        cancel_at_period_end: true,
        customer: { id: "cus_expanded", object: "customer" },
        id: "sub_object_id",
        items: { data: [{ current_period_end: 1_790_000_000, id: "si_base" }] },
        status: "past_due",
      }),
    );

    assert.equal(parsed.subscriptionRef, "sub_object_id");
    assert.equal(parsed.customerRef, "cus_expanded");
    assert.equal(parsed.subscriptionStatus, "past_due");
    assert.equal(parsed.cancelAtPeriodEnd, true);
    assert.equal(
      parsed.currentPeriodEnd,
      new Date(1_790_000_000 * 1000).toISOString(),
    );
  });

  it("carries a failed invoice's retry signals", () => {
    const parsed = mapWebhook(
      event("invoice.payment_failed", {
        attempt_count: 2,
        next_payment_attempt: 1_786_300_000,
        parent: {
          subscription_details: { subscription: "sub_failing" },
          type: "subscription_details",
        },
        status: "open",
      }),
    );

    assert.equal(parsed.attemptCount, 2);
    assert.equal(
      parsed.nextPaymentAttemptAt,
      new Date(1_786_300_000 * 1000).toISOString(),
    );
  });

  it("carries a null next attempt as null rather than dropping the field", () => {
    const parsed = mapWebhook(
      event("invoice.payment_failed", {
        attempt_count: 4,
        next_payment_attempt: null,
        parent: {
          subscription_details: { subscription: "sub_failing" },
          type: "subscription_details",
        },
      }),
    );

    assert.equal(parsed.nextPaymentAttemptAt, null);
    assert.equal(parsed.attemptCount, 4);
  });

  it("leaves lane B's routing keys exactly where they were", () => {
    const parsed = mapWebhook(
      event("setup_intent.succeeded", {
        customer: "cus_consumer",
        id: "seti_1",
        setup_intent: "seti_1",
      }),
    );

    assert.equal(parsed.setupIntentRef, "seti_1");
    assert.equal(parsed.customerRef, "cus_consumer");
    assert.equal(parsed.subscriptionRef, null);
    assert.equal(parsed.createdAt, new Date(1_786_000_000 * 1000).toISOString());
  });
});
