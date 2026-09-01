import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";

import { createMockAdapter } from "./mock.ts";
import { createRefundRepository } from "./repository-refunds.ts";
import { recordRefundObservation, RefundObservationError } from "./refunds.ts";
import { mapWebhook } from "./stripe.ts";
import type { ParsedWebhook } from "./types.ts";
import type Stripe from "stripe";

const EVENT: ParsedWebhook = {
  amountRefundedCents: 2_500,
  chargeRef: "ch_refund",
  createdAt: "2026-08-16T00:00:00.000Z",
  currency: "usd",
  customerRef: "cus_refund",
  eventId: "evt_refund",
  eventType: "charge.refunded",
  setupIntentRef: null,
  subscriptionRef: "sub_refund",
};

describe("refund observation", () => {
  it("claims full, partial and duplicate cumulative observations once each", async () => {
    for (const [amount, reason] of [[10_000, "recorded"], [2_500, "recorded"], [2_500, "duplicate"]] as const) {
      const calls: unknown[] = [];
      assert.equal(await recordRefundObservation({ ...EVENT, amountRefundedCents: amount }, {
        async record(input) {
          calls.push(input);
          return { attributed: true, orgId: "11111111-1111-4111-8111-111111111111", reason, recorded: reason === "recorded" };
        },
      }), true);
      assert.equal(calls.length, 1);
    }
  });

  it("returns false without repository access for every other event type", async () => {
    let calls = 0;
    assert.equal(await recordRefundObservation({ ...EVENT, eventType: "invoice.paid" }, {
      async record() { calls += 1; throw new Error(); },
    }), false);
    assert.equal(calls, 0);
  });

  it("rejects missing, negative, fractional and wrong-currency metadata privately", async () => {
    for (const event of [
      { ...EVENT, chargeRef: undefined },
      { ...EVENT, amountRefundedCents: -1 },
      { ...EVENT, amountRefundedCents: 1.5 },
      { ...EVENT, currency: "eur" },
      { ...EVENT, chargeRef: "provider\npoison" },
    ]) {
      await assert.rejects(recordRefundObservation(event), (error: unknown) =>
        error instanceof RefundObservationError && !error.message.includes("provider"));
    }
  });

  it("maps only a Stripe Charge refund and follows an expanded invoice parent", () => {
    const parsed = mapWebhook({
      created: 1_786_838_400,
      data: { object: {
        amount_refunded: 2_500,
        currency: "usd",
        customer: "cus_refund",
        id: "ch_refund",
        invoice: { parent: { subscription_details: { subscription: "sub_refund" }, type: "subscription_details" } },
      } },
      id: "evt_refund",
      type: "charge.refunded",
    } as unknown as Stripe.Event);
    assert.deepEqual({
      amount: parsed.amountRefundedCents,
      charge: parsed.chargeRef,
      currency: parsed.currency,
      customer: parsed.customerRef,
      subscription: parsed.subscriptionRef,
    }, { amount: 2_500, charge: "ch_refund", currency: "usd", customer: "cus_refund", subscription: "sub_refund" });
  });

  it("mirrors the same narrow refund shape through the signed mock", async () => {
    const key = "test-signing-value";
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const raw = JSON.stringify({
      amount_refunded: 2_500,
      charge_ref: "ch_refund",
      created: Number(timestamp),
      currency: "usd",
      customer: "cus_refund",
      id: "evt_refund",
      subscription: "sub_refund",
      type: "charge.refunded",
    });
    const signature = createHmac("sha256", key).update(`${timestamp}.${raw}`).digest("hex");
    const parsed = await createMockAdapter({ webhookSigningValue: key }).parseWebhook(raw, `t=${timestamp},v1=${signature}`);
    assert.equal(parsed.chargeRef, "ch_refund");
    assert.equal(parsed.amountRefundedCents, 2_500);
    assert.equal(parsed.currency, "usd");
  });

  it("maps database and corrupt response values to closed repository errors", async () => {
    for (const response of [
      { data: null, error: { message: "provider secret detail" } },
      { data: { attributed: true, org_id: null, reason_code: "recorded", recorded: false }, error: null },
    ]) {
      await assert.rejects(
        createRefundRepository({ async rpc() { return response; } }).record({
          amountRefundedCents: 2_500,
          chargeRef: "ch_refund",
          currency: "usd",
          customerRef: null,
          eventId: "evt_refund",
          occurredAt: EVENT.createdAt,
          subscriptionRef: null,
        }),
        (error: unknown) => error instanceof Error && !error.message.includes("secret detail"),
      );
    }
  });
});
