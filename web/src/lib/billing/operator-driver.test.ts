import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveBillingSignal, nextMembership } from "@/lib/billing/operator-ladder";
import {
  createMockOperatorAdapter,
  replayDunningFixture,
} from "@/lib/billing/operator-mock";
import { DUNNING_FIXTURE_STREAM } from "@/lib/billing/fixtures/dunning-stream";
import type { OperatorMembership } from "@/lib/billing/types";
import { createStripeOperatorAdapter } from "@/lib/billing/operator-stripe";
import type Stripe from "stripe";

const START = {
  basePriceRef: "mock_price_operator_base",
  billingCustomerRef: "mock_cus_org_1",
  orgId: "70000000-0000-0000-0000-000000000001",
  orgName: "Northbridge Funding Group",
  operationId: "70000000-0000-0000-0000-0000000000ff",
  ownerEmail: "owner@northbridge.test",
  seatPriceRef: "mock_price_operator_seat",
  seatQuantity: 2,
};

describe("the mock operator driver", () => {
  it("creates a subscription with a base item and a seat item, and no third item", async () => {
    const adapter = createMockOperatorAdapter();
    const snapshot = await adapter.startOperatorSubscription(START);

    assert.match(snapshot.subscriptionRef, /^mock_sub_/);
    assert.equal(snapshot.customerRef, START.billingCustomerRef);
    assert.match(String(snapshot.baseItemRef), /^mock_si_base_/);
    assert.match(String(snapshot.seatItemRef), /^mock_si_seat_/);
    assert.equal(snapshot.seatQuantity, 2);
    assert.equal(snapshot.status, "active");
    assert.equal(snapshot.cancelAtPeriodEnd, false);
    assert.ok(snapshot.currentPeriodEnd);
  });

  it("returns the identical result for a repeated organization start", async () => {
    const adapter = createMockOperatorAdapter();
    const first = await adapter.startOperatorSubscription(START);
    const second = await adapter.startOperatorSubscription({
      ...START,
      seatQuantity: 9,
    });

    assert.deepEqual(second, first);
  });

  it("records a requested seat quantity against the seat item", async () => {
    const adapter = createMockOperatorAdapter();
    const created = await adapter.startOperatorSubscription(START);
    const updated = await adapter.updateSeatQuantity({
      idempotencyKey: "operator:org-1:seats:5",
      quantity: 5,
      seatItemRef: String(created.seatItemRef),
      subscriptionRef: created.subscriptionRef,
    });

    assert.equal(updated.quantity, 5);
    assert.equal(updated.seatItemRef, created.seatItemRef);

    const read = await adapter.readOperatorSubscription({
      subscriptionRef: created.subscriptionRef,
    });
    assert.equal(read?.seatQuantity, 5);
  });

  it("accepts a seat count decrease down to zero", async () => {
    const adapter = createMockOperatorAdapter();
    const created = await adapter.startOperatorSubscription(START);
    const updated = await adapter.updateSeatQuantity({
      idempotencyKey: "operator:org-1:seats:0",
      quantity: 0,
      seatItemRef: String(created.seatItemRef),
      subscriptionRef: created.subscriptionRef,
    });

    assert.equal(updated.quantity, 0);
  });

  it("cancels at period end without ending the subscription immediately", async () => {
    const adapter = createMockOperatorAdapter();
    const created = await adapter.startOperatorSubscription(START);

    const scheduled = await adapter.cancelOperatorSubscription({
      atPeriodEnd: true,
      subscriptionRef: created.subscriptionRef,
    });
    assert.equal(scheduled.status, "active");
    assert.equal(scheduled.cancelledAt, null);

    const immediate = await adapter.cancelOperatorSubscription({
      atPeriodEnd: false,
      subscriptionRef: created.subscriptionRef,
    });
    assert.equal(immediate.status, "canceled");
    assert.ok(immediate.cancelledAt);
  });

  it("answers null for a subscription reference it has never seen", async () => {
    const adapter = createMockOperatorAdapter();
    assert.equal(
      await adapter.readOperatorSubscription({ subscriptionRef: "mock_sub_absent" }),
      null,
    );
  });
});

describe("the dunning fixture stream", () => {
  it("stores bodies only — no signature and no absolute timestamp", () => {
    const serialised = JSON.stringify(DUNNING_FIXTURE_STREAM);

    assert.doesNotMatch(serialised, /"v1="|"t="|signature/i);
    assert.doesNotMatch(serialised, /"created"/);
    assert.doesNotMatch(serialised, /\b1[6-9]\d{8}\b/);
  });

  it("walks the whole ladder, then repeats and reorders", async () => {
    const parsed = await replayDunningFixture();

    assert.equal(parsed.length, DUNNING_FIXTURE_STREAM.length);

    const expected: Array<OperatorMembership | "unchanged"> = [
      "current",
      "past_due",
      "grace",
      "deactivated",
      "current",
      "grace",
      "past_due",
    ];

    let membership: OperatorMembership = "trial";
    parsed.forEach((event, index) => {
      const outcome = nextMembership(membership, deriveBillingSignal(event));
      membership = outcome.membership;
      assert.equal(
        membership,
        expected[index],
        `${DUNNING_FIXTURE_STREAM[index]?.label} landed on ${membership}`,
      );
    });
  });

  it("carries a verbatim duplicate of the grace event", async () => {
    const parsed = await replayDunningFixture();
    const graceEvents = parsed.filter((event) => event.eventId === parsed[2]?.eventId);

    assert.equal(graceEvents.length, 2);
    assert.equal(graceEvents[0]?.eventId, graceEvents[1]?.eventId);
  });

  it("carries an out-of-order event older than the one before it", async () => {
    const parsed = await replayDunningFixture();
    const last = parsed.at(-1);
    const previous = parsed.at(-2);

    assert.ok(last && previous);
    assert.ok(
      last.createdAt < previous.createdAt,
      "the final fixture event must be older than the one delivered before it",
    );
  });

  it("resolves every invoice subscription through the pinned parent shape", async () => {
    const parsed = await replayDunningFixture();

    for (const event of parsed) {
      assert.equal(event.subscriptionRef, "mock_sub_operator_dunning");
    }
  });

  it("signs at replay time, so two replays carry different signatures and both verify", async () => {
    const signedAt = new Date();
    const first = await replayDunningFixture({ signedAt });
    const second = await replayDunningFixture({ signedAt: new Date(signedAt.getTime() + 1_000) });

    assert.equal(first.length, second.length);
    assert.equal(first[0]?.eventId, second[0]?.eventId);
  });

  it("refuses a body altered after signing", async () => {
    await assert.rejects(replayDunningFixture({ tamper: true }));
  });
});

describe("the Stripe operator descriptor seam", () => {
  it("updates only the base Price Product before direct subscription creation", async () => {
    const calls: Array<{ name: string; value: unknown }> = [];
    const client = {
      prices: { async retrieve(id: string) { calls.push({ name: "price", value: id }); return { product: "prod_base" }; } },
      products: { async update(id: string, value: unknown) { calls.push({ name: "product", value: { id, value } }); return {}; } },
      subscriptions: {
        async create(value: unknown, options: unknown) {
          calls.push({ name: "subscription", value: { options, value } });
          return {
            cancel_at_period_end: false,
            canceled_at: null,
            customer: "cus_test",
            id: "sub_test",
            items: { data: [
              { id: "si_base", current_period_end: 1_800_000_000, price: { id: "price_base" }, quantity: 1 },
              { id: "si_seat", current_period_end: 1_800_000_000, price: { id: "price_seat" }, quantity: 2 },
            ] },
            status: "active",
          };
        },
      },
    } as unknown as Stripe;
    await createStripeOperatorAdapter("unused", "MOSTFUNDABLE", client).startOperatorSubscription({
      ...START,
      basePriceRef: "price_base",
      seatPriceRef: "price_seat",
    });
    assert.deepEqual(calls.map((call) => call.name), ["price", "product", "subscription"]);
    assert.deepEqual(calls[1]?.value, { id: "prod_base", value: { statement_descriptor: "MOSTFUNDABLE" } });
    assert.deepEqual((calls[2]?.value as { options: unknown }).options, {
      idempotencyKey: `operator:${START.orgId}:subscription:${START.operationId}`,
    });
    assert.equal(JSON.stringify(calls[2]?.value).includes("MOSTFUNDABLE"), false);
  });
});

const credentialsPresent = Boolean(
  process.env.STRIPE_SECRET_KEY &&
    process.env.STRIPE_WEBHOOK_SECRET &&
    process.env.STRIPE_OPERATOR_CUSTOMER_REF,
);

describe(
  "the real Stripe operator driver",
  { skip: credentialsPresent ? false : "no Stripe credentials" },
  () => {
    it("creates a subscription with exactly two items", async () => {
      const { createStripeOperatorAdapter } = await import(
        "@/lib/billing/operator-stripe"
      );
      const adapter = createStripeOperatorAdapter(
        process.env.STRIPE_SECRET_KEY as string,
      );
      const snapshot = await adapter.startOperatorSubscription({
        ...START,
        basePriceRef: process.env.STRIPE_PRICE_OPERATOR_BASE as string,
        billingCustomerRef: process.env.STRIPE_OPERATOR_CUSTOMER_REF as string,
        seatPriceRef: process.env.STRIPE_PRICE_OPERATOR_SEAT as string,
      });

      assert.ok(snapshot.baseItemRef);
      assert.ok(snapshot.seatItemRef);
      assert.match(snapshot.subscriptionRef, /^sub_/);
    });

    it("changes a seat quantity in one call", async () => {
      const { createStripeOperatorAdapter } = await import(
        "@/lib/billing/operator-stripe"
      );
      const adapter = createStripeOperatorAdapter(
        process.env.STRIPE_SECRET_KEY as string,
      );
      const snapshot = await adapter.startOperatorSubscription({
        ...START,
        basePriceRef: process.env.STRIPE_PRICE_OPERATOR_BASE as string,
        billingCustomerRef: process.env.STRIPE_OPERATOR_CUSTOMER_REF as string,
        seatPriceRef: process.env.STRIPE_PRICE_OPERATOR_SEAT as string,
      });
      const updated = await adapter.updateSeatQuantity({
        idempotencyKey: `operator:${START.orgId}:seats:3`,
        quantity: 3,
        seatItemRef: String(snapshot.seatItemRef),
        subscriptionRef: snapshot.subscriptionRef,
      });

      assert.equal(updated.quantity, 3);
    });
  },
);
