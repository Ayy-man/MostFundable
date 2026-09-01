import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  OPERATOR_MEMBERSHIP_VALUES,
  OPERATOR_SUBSCRIPTION_STATUSES,
  deriveBillingSignal,
  nextMembership,
} from "@/lib/billing/operator-ladder";
import type { OperatorMembership, ParsedWebhook } from "@/lib/billing/types";

const EVENT_TYPES = [
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
] as const;

const DEACTIVATING_STATUSES = new Set([
  "unpaid",
  "canceled",
  "incomplete_expired",
]);

/**
 * The expected rung for one cell of the cross product, read straight off the
 * D-04 table rather than computed the way the implementation computes it. A
 * `null` means "membership unchanged, unknown_status" — the escape row.
 */
function expectedRung(
  eventType: string,
  status: string,
  retriesExhausted: boolean,
): OperatorMembership | null {
  if (eventType === "invoice.paid") return "current";
  if (eventType === "invoice.payment_failed") {
    return retriesExhausted ? "grace" : "past_due";
  }
  if (eventType === "customer.subscription.deleted") return "deactivated";
  if (status === "active") return "current";
  if (status === "trialing") return "trial";
  if (status === "past_due") return "past_due";
  if (DEACTIVATING_STATUSES.has(status)) return "deactivated";
  return null;
}

function event(
  eventType: string,
  status: string,
  retriesExhausted: boolean,
  occurredAt = "2026-08-16T00:00:00.000Z",
): ParsedWebhook {
  return {
    createdAt: occurredAt,
    customerRef: "mock_cus_ladder",
    eventId: `evt_${eventType}_${status}_${retriesExhausted ? "spent" : "remaining"}`,
    eventType,
    nextPaymentAttemptAt: retriesExhausted
      ? null
      : "2026-08-19T00:00:00.000Z",
    setupIntentRef: null,
    subscriptionRef: "mock_sub_ladder",
    subscriptionStatus: status,
  };
}

describe("the rung mapping", () => {
  it("carries the five rungs and the eight provider statuses verbatim", () => {
    assert.deepEqual(OPERATOR_MEMBERSHIP_VALUES, [
      "trial",
      "current",
      "past_due",
      "grace",
      "deactivated",
    ]);
    assert.deepEqual(OPERATOR_SUBSCRIPTION_STATUSES, [
      "trialing",
      "active",
      "incomplete",
      "incomplete_expired",
      "past_due",
      "canceled",
      "unpaid",
      "paused",
    ]);
  });

  // The full cross product, so a row of D-04 cannot be quietly dropped: five
  // event types × eight statuses × two retry states is eighty cases, and each
  // one is checked from every starting rung that could precede it.
  for (const eventType of EVENT_TYPES) {
    for (const status of OPERATOR_SUBSCRIPTION_STATUSES) {
      for (const retriesExhausted of [false, true]) {
        const expected = expectedRung(eventType, status, retriesExhausted);
        const retries = retriesExhausted ? "no retry scheduled" : "a retry scheduled";

        it(`maps ${eventType} with status ${status} and ${retries} to ${expected ?? "no change"}`, () => {
          for (const current of OPERATOR_MEMBERSHIP_VALUES) {
            const outcome = nextMembership(
              current,
              deriveBillingSignal(event(eventType, status, retriesExhausted)),
            );

            if (expected === null) {
              assert.equal(outcome.membership, current);
              assert.equal(outcome.reasonCode, "unknown_status");
            } else {
              assert.equal(outcome.membership, expected);
              assert.equal(outcome.reasonCode, "applied");
            }
          }
        });
      }
    }
  }
});

describe("the statuses that must leave the rung alone", () => {
  for (const status of ["paused", "incomplete", "future_status_we_do_not_know"]) {
    it(`records ${status} rather than mapping it to a rung`, () => {
      const outcome = nextMembership(
        "past_due",
        deriveBillingSignal(event("customer.subscription.updated", status, false)),
      );

      assert.equal(outcome.membership, "past_due");
      assert.equal(outcome.reasonCode, "unknown_status");
    });
  }

  it("leaves the rung alone when a subscription event carries no status at all", () => {
    const outcome = nextMembership("current", {
      attemptCount: 0,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      kind: "subscription_updated",
      occurredAt: "2026-08-16T00:00:00.000Z",
      retriesExhausted: false,
      status: null,
      subscriptionRef: "mock_sub_ladder",
    });

    assert.equal(outcome.membership, "current");
    assert.equal(outcome.reasonCode, "unknown_status");
  });
});

describe("deriveBillingSignal", () => {
  it("treats an absent next payment attempt on a failed invoice as retries spent", () => {
    const withoutField = deriveBillingSignal({
      createdAt: "2026-08-16T00:00:00.000Z",
      customerRef: null,
      eventId: "evt_no_field",
      eventType: "invoice.payment_failed",
      setupIntentRef: null,
      subscriptionRef: "mock_sub_ladder",
    });

    assert.equal(withoutField.retriesExhausted, true);
    assert.equal(withoutField.kind, "invoice_payment_failed");
  });

  it("treats a scheduled next payment attempt as retries remaining", () => {
    const signal = deriveBillingSignal(
      event("invoice.payment_failed", "past_due", false),
    );

    assert.equal(signal.retriesExhausted, false);
    assert.equal(signal.status, "past_due");
    assert.equal(signal.subscriptionRef, "mock_sub_ladder");
  });

  it("reports an unrecognized provider status as a raw string rather than dropping it", () => {
    const signal = deriveBillingSignal(
      event("customer.subscription.updated", "future_status_we_do_not_know", false),
    );

    assert.equal(signal.status, "future_status_we_do_not_know");
  });

  it("classifies an event type it does not route as unrelated", () => {
    const signal = deriveBillingSignal({
      createdAt: "2026-08-16T00:00:00.000Z",
      customerRef: null,
      eventId: "evt_setup_intent",
      eventType: "setup_intent.succeeded",
      setupIntentRef: "mock_seti_x",
      subscriptionRef: null,
    });

    assert.equal(signal.kind, "unrelated");
    assert.equal(
      nextMembership("current", signal).reasonCode,
      "unknown_status",
    );
  });

  it("prefers the event's own timestamp for ordering", () => {
    const signal = deriveBillingSignal(
      event("invoice.paid", "active", false, "2027-01-01T12:00:00.000Z"),
    );

    assert.equal(signal.occurredAt, "2027-01-01T12:00:00.000Z");
  });
});

describe("the reinstatement rung", () => {
  it("walks the whole ladder and comes back", () => {
    const walk: Array<[ParsedWebhook, OperatorMembership]> = [
      [event("customer.subscription.updated", "active", false), "current"],
      [event("invoice.payment_failed", "past_due", false), "past_due"],
      [event("invoice.payment_failed", "past_due", true), "grace"],
      [event("customer.subscription.updated", "unpaid", false), "deactivated"],
      [event("invoice.paid", "active", false), "current"],
    ];

    let membership: OperatorMembership = "trial";
    for (const [parsed, expected] of walk) {
      membership = nextMembership(membership, deriveBillingSignal(parsed)).membership;
      assert.equal(membership, expected);
    }
  });
});
