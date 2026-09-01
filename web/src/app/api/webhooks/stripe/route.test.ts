import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { handleStripeWebhook } from "./route.ts";
import type { ParsedWebhook } from "@/lib/billing/types";

const EVENT: ParsedWebhook = {
  createdAt: "2026-08-16T00:00:00.000Z",
  customerRef: "cus_test",
  eventId: "evt_test",
  eventType: "invoice.paid",
  setupIntentRef: null,
  subscriptionRef: "sub_test",
};

function request() {
  return new Request("http://local/api/webhooks/stripe", {
    body: "signed-body",
    headers: { "stripe-signature": "signed" },
    method: "POST",
  });
}

function harness(input: {
  billing?: boolean;
  billingOps?: boolean;
  consumer?: boolean;
  consumerDispatch?: Error;
  event?: ParsedWebhook;
  fresh?: boolean;
  markStatusError?: Error;
  operator?: boolean | Error;
  refund?: boolean | Error;
  webhookReady?: boolean;
}) {
  const calls: string[] = [];
  return {
    calls,
    dependencies: {
      async billingEnabled() { calls.push("billing-flag"); return input.billing ?? true; },
      async billingOpsEnabled() { calls.push("ops-flag"); return input.billingOps ?? true; },
      async consumerEnabled() { calls.push("consumer-flag"); return input.consumer ?? true; },
      async handleOperator() {
        calls.push("operator");
        if (input.operator instanceof Error) throw input.operator;
        return input.operator ?? false;
      },
      async markStatus(_eventId: string, _leaseOwner: string, status: "failed" | "ignored" | "processed", errorCode?: string) {
        calls.push(`mark:${status}${errorCode ? `:${errorCode}` : ""}`);
        if (input.markStatusError) throw input.markStatusError;
      },
      async parse(raw: string, signature: string | null) {
        calls.push(`parse:${raw}:${signature}`);
        return input.event ?? EVENT;
      },
      async processConsumer() {
        calls.push("consumer");
        if (input.consumerDispatch) throw input.consumerDispatch;
      },
      async record() { calls.push("record"); return input.fresh ?? true; },
      async recordRefund() {
        calls.push("refund");
        if (input.refund instanceof Error) throw input.refund;
        return input.refund ?? false;
      },
      async webhookReady() { calls.push("webhook-ready"); return input.webhookReady ?? true; },
    },
  };
}

describe("Stripe webhook route", () => {
  it("records before ACK and does no dispatch work for a duplicate", async () => {
    const test = harness({ fresh: false });
    const response = await handleStripeWebhook(request(), test.dependencies);
    assert.equal(response.status, 200);
    assert.deepEqual(test.calls, ["webhook-ready", "parse:signed-body:signed", "record"]);
  });

  it("dispatches both failed replay and stale-received claims", async () => {
    for (const claimKind of ["failed replay", "stale received"] as const) {
      const test = harness({ fresh: true, operator: true });
      assert.equal((await handleStripeWebhook(request(), test.dependencies)).status, 200, claimKind);
      assert.deepEqual(test.calls.slice(-2), ["operator", "mark:processed"], claimKind);
    }
  });

  it("refuses terminal claims and admits one simultaneous delivery", async () => {
    const terminal = harness({ fresh: false });
    await handleStripeWebhook(request(), terminal.dependencies);
    assert.equal(terminal.calls.includes("operator"), false);

    const simultaneous = harness({});
    let claimed = false;
    simultaneous.dependencies.record = async () => {
      simultaneous.calls.push("record");
      if (claimed) return false;
      claimed = true;
      return true;
    };
    await Promise.all([
      handleStripeWebhook(request(), simultaneous.dependencies),
      handleStripeWebhook(request(), simultaneous.dependencies),
    ]);
    assert.equal(simultaneous.calls.filter((call) => call === "operator").length, 1);
  });

  it("claims a refund once, marks it processed and stops all old fall-through", async () => {
    const test = harness({
      event: { ...EVENT, amountRefundedCents: 100, chargeRef: "ch_test", currency: "usd", eventType: "charge.refunded" },
      refund: true,
    });
    assert.equal((await handleStripeWebhook(request(), test.dependencies)).status, 200);
    assert.deepEqual(test.calls, ["webhook-ready", "parse:signed-body:signed", "record", "ops-flag", "refund", "mark:processed"]);
  });

  it("returns 503 only after an injected refund persistence failure is durably marked", async () => {
    const test = harness({
      event: { ...EVENT, amountRefundedCents: 100, chargeRef: "ch_test", currency: "usd", eventType: "charge.refunded" },
      refund: new Error("database private detail"),
    });
    assert.equal((await handleStripeWebhook(request(), test.dependencies)).status, 503);
    assert.deepEqual(test.calls.slice(-3), ["ops-flag", "refund", "mark:failed:refund_persist_failed"]);
    assert.equal(test.calls.includes("operator"), false);
    assert.equal(test.calls.includes("consumer"), false);
  });

  it("returns 503 only after an injected dispatch failure is durably marked", async () => {
    const test = harness({ consumerDispatch: new Error("consumer unavailable"), operator: false });
    assert.equal((await handleStripeWebhook(request(), test.dependencies)).status, 503);
    assert.deepEqual(test.calls.slice(-3), ["operator", "consumer", "mark:failed:dispatch_failed"]);
  });

  it("recovers through a second inbound delivery after a handler failure", async () => {
    const test = harness({ operator: true });
    let first = true;
    test.dependencies.handleOperator = async () => {
      test.calls.push("operator");
      if (first) {
        first = false;
        throw new Error("transient");
      }
      return true;
    };

    assert.equal((await handleStripeWebhook(request(), test.dependencies)).status, 503);
    assert.equal((await handleStripeWebhook(request(), test.dependencies)).status, 200);
    assert.deepEqual(test.calls.filter((call) => call.startsWith("mark:")), [
      "mark:failed:dispatch_failed",
      "mark:processed",
    ]);
  });

  it("returns 503 when the terminal status write fails", async () => {
    const test = harness({ markStatusError: new Error("database unavailable"), operator: true });
    assert.equal((await handleStripeWebhook(request(), test.dependencies)).status, 503);
    assert.deepEqual(test.calls.slice(-3), ["operator", "mark:processed", "mark:failed:dispatch_failed"]);
  });

  it("preserves non-refund operator claimed and consumer fall-through outcomes", async () => {
    for (const [operator, tail] of [
      [true, ["operator", "mark:processed"]],
      [false, ["operator", "consumer"]],
      [new Error("dispatcher"), ["operator", "mark:failed:dispatch_failed"]],
    ] as const) {
      const test = harness({ operator, refund: false });
      await handleStripeWebhook(request(), test.dependencies);
      assert.deepEqual(test.calls.slice(-tail.length), tail);
    }
  });

  it("keeps both legacy feature-off paths byte-equivalent", async () => {
    const opsOff = harness({ billingOps: false, operator: false });
    await handleStripeWebhook(request(), opsOff.dependencies);
    assert.equal(opsOff.calls.includes("refund"), false);
    assert.deepEqual(opsOff.calls.slice(-4), ["consumer-flag", "billing-flag", "operator", "consumer"]);

    const billingOff = harness({ billing: false, billingOps: false });
    await handleStripeWebhook(request(), billingOff.dependencies);
    assert.deepEqual(billingOff.calls.slice(-3), ["consumer-flag", "billing-flag", "consumer"]);
  });

  it("records no event and dispatches no state change when webhook signing is unavailable", async () => {
    const test = harness({ webhookReady: false });
    const response = await handleStripeWebhook(request(), test.dependencies);
    assert.equal(response.status, 503);
    assert.deepEqual(test.calls, ["webhook-ready"]);
  });

  it("uses an explicit consumer flag and marks an undispatched event ignored", async () => {
    const test = harness({ billing: false, billingOps: false, consumer: false });
    await handleStripeWebhook(request(), test.dependencies);
    assert.deepEqual(test.calls.slice(-3), ["consumer-flag", "billing-flag", "mark:ignored"]);
  });

  it("fails closed through production dependencies with the default mock environment", async () => {
    const priorDriver = process.env.BILLING_DRIVER;
    const priorSecret = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.BILLING_DRIVER;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    try {
      assert.equal((await handleStripeWebhook(request())).status, 503);
    } finally {
      if (priorDriver === undefined) delete process.env.BILLING_DRIVER;
      else process.env.BILLING_DRIVER = priorDriver;
      if (priorSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
      else process.env.STRIPE_WEBHOOK_SECRET = priorSecret;
    }
  });

  it("returns 400 and records nothing when signature parsing fails", async () => {
    const test = harness({});
    test.dependencies.parse = async () => { throw new Error("bad signature"); };
    assert.equal((await handleStripeWebhook(request(), test.dependencies)).status, 400);
    assert.equal(test.calls.includes("record"), false);
  });
});
