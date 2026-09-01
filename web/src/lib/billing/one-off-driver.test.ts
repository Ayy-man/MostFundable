import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  readOneOffPaymentSource,
  resolveOneOffBillingAdapter,
} from "./index.ts";
import { createMockOneOffAdapter } from "./one-off-mock.ts";
import {
  createStripeOneOffAdapter,
  type OneOffStripeClient,
} from "./one-off-stripe.ts";

import type { OneOffPaymentRequest } from "./types.ts";

const REQUEST: OneOffPaymentRequest = {
  amountCents: 1_900,
  clientId: "81000000-0000-4000-8000-000000000101",
  currency: "usd",
  customerRef: "cus_server_1",
  idempotencyKey: "force_pull:81000000-0000-4000-8000-000000000201",
  paymentMethodRef: "pm_server_1",
  requestId: "81000000-0000-4000-8000-000000000201",
};

describe("one-off billing mock and selector", () => {
  it("uses a deterministic succeeded mock by default", async () => {
    const adapter = resolveOneOffBillingAdapter({});
    const first = await adapter.createOneOffPayment(REQUEST);
    const replay = await adapter.createOneOffPayment(REQUEST);
    assert.deepEqual(replay, first);
    assert.equal(first.provider, "mock");
    assert.equal(first.outcome, "succeeded");
    assert.deepEqual(Object.keys(first).sort(), [
      "amountCents", "currency", "outcome", "provider", "providerEventKey", "providerPaymentRef",
    ]);
  });

  it("supports closed non-success mock fixtures", async () => {
    for (const value of ["requires_action", "failed"] as const) {
      assert.equal((await createMockOneOffAdapter({ outcome: value }).createOneOffPayment(REQUEST)).outcome, value);
    }
  });

  it("derives closed E2E outcomes only from server-held mock source markers", async () => {
    for (const [paymentMethodRef, outcome] of [
      ["mock_payment_requires_action_fixture", "requires_action"],
      ["mock_payment_failed_fixture", "failed"],
      ["mock_payment_regular_fixture", "succeeded"],
    ] as const) {
      const result = await createMockOneOffAdapter().createOneOffPayment({
        ...REQUEST,
        paymentMethodRef,
      });
      assert.equal(result.outcome, outcome);
    }
  });

  it("fails closed when Stripe is explicit without its key", () => {
    assert.throws(
      () => resolveOneOffBillingAdapter({ BILLING_DRIVER: "stripe" }),
      /STRIPE_SECRET_KEY/,
    );
  });

  it("constructs the Stripe arm only after selector validation", () => {
    const keys: string[] = [];
    // R4C-03 widened the Stripe requirement set to the inbound half and the operator price refs,
    // so the selector now needs the whole set before it will hand back a real adapter.
    const adapter = resolveOneOffBillingAdapter(
      {
        BILLING_DRIVER: "stripe",
        STRIPE_SECRET_KEY: "present-only-in-memory",
        STRIPE_WEBHOOK_SECRET: "present-only-in-memory",
        CONSUMER_MONITORING_PRICE_REF: "price_not_a_real_ref",
        STRIPE_PRICE_OPERATOR_BASE: "price_not_a_real_ref",
        STRIPE_PRICE_OPERATOR_SEAT: "price_not_a_real_ref",
      },
      (key) => { keys.push(key); return createMockOneOffAdapter(); },
    );
    assert.equal(keys.length, 1);
    assert.equal(typeof adapter.createOneOffPayment, "function");
  });
});

describe("one-off billing Stripe request", () => {
  it("sends exact server values and the stable SDK idempotency option", async () => {
    const calls: unknown[][] = [];
    const client = {
      paymentIntents: {
        async create(...args: unknown[]) {
          calls.push(args);
          return { amount: 1_900, currency: "usd", id: "pi_test_1", status: "succeeded" };
        },
      },
    } as unknown as OneOffStripeClient;
    const result = await createStripeOneOffAdapter("unused", client).createOneOffPayment(REQUEST);

    assert.deepEqual(calls, [[{
      amount: 1_900,
      confirm: true,
      currency: "usd",
      customer: "cus_server_1",
      metadata: {
        client_id: "81000000-0000-4000-8000-000000000101",
        idempotency_key: "force_pull:81000000-0000-4000-8000-000000000201",
        request_id: "81000000-0000-4000-8000-000000000201",
      },
      off_session: true,
      payment_method: "pm_server_1",
    }, { idempotencyKey: "force_pull:81000000-0000-4000-8000-000000000201" }]]);
    assert.deepEqual(result, {
      amountCents: 1_900,
      currency: "usd",
      outcome: "succeeded",
      provider: "stripe",
      providerEventKey: "stripe:pi_test_1:succeeded",
      providerPaymentRef: "pi_test_1",
    });
    assert.equal(JSON.stringify(result).includes("cus_server_1"), false);
    assert.equal(JSON.stringify(result).includes("pm_server_1"), false);
  });

  it("finds one prior payment by request and idempotency metadata", async () => {
    const searches: unknown[] = [];
    const client = {
      paymentIntents: {
        async search(input: unknown) {
          searches.push(input);
          return { data: [{ amount: 1_900, currency: "usd", id: "pi_existing", status: "succeeded" }] };
        },
      },
    } as unknown as OneOffStripeClient;
    const result = await createStripeOneOffAdapter("unused", client).findOneOffPayment({
      idempotencyKey: REQUEST.idempotencyKey,
      requestId: REQUEST.requestId,
    });
    assert.deepEqual(searches, [{
      limit: 2,
      query: `metadata['request_id']:'${REQUEST.requestId}' AND metadata['idempotency_key']:'${REQUEST.idempotencyKey}'`,
    }]);
    assert.equal(result?.providerPaymentRef, "pi_existing");
    assert.equal(result?.outcome, "succeeded");
  });

  it("maps only exact succeeded status to success", async () => {
    for (const [status, expected] of [
      ["succeeded", "succeeded"],
      ["requires_action", "requires_action"],
      ["processing", "failed"],
      ["requires_payment_method", "failed"],
      ["canceled", "failed"],
    ] as const) {
      const client = {
        paymentIntents: {
          async create() { return { amount: 1_900, currency: "usd", id: `pi_${status}`, status }; },
        },
      } as unknown as OneOffStripeClient;
      const result = await createStripeOneOffAdapter("unused", client).createOneOffPayment(REQUEST);
      assert.equal(result.outcome, expected);
      assert.equal(result.providerEventKey, `stripe:pi_${status}:${status}`);
    }
  });

  it("rejects provider amount or currency drift with a fixed error", async () => {
    for (const payment of [
      { amount: 1_800, currency: "usd", id: "pi_amount", status: "succeeded" },
      { amount: 1_900, currency: "eur", id: "pi_currency", status: "succeeded" },
    ]) {
      const client = { paymentIntents: { async create() { return payment; } } } as unknown as OneOffStripeClient;
      await assert.rejects(
        createStripeOneOffAdapter("unused", client).createOneOffPayment(REQUEST),
        /ONE_OFF_PAYMENT_RESULT_INVALID/,
      );
    }
  });
});

describe("one-off payment source", () => {
  it("reads one server-held source and returns a frozen exact shape", async () => {
    const clients: string[] = [];
    const result = await readOneOffPaymentSource(REQUEST.clientId, {
      reader: async (clientId) => {
        clients.push(clientId);
        return { ok: true, value: { customerRef: "cus_server_1", paymentMethodRef: "pm_server_1" } };
      },
    });
    assert.deepEqual(clients, [REQUEST.clientId]);
    assert.deepEqual(result, { customerRef: "cus_server_1", paymentMethodRef: "pm_server_1" });
    assert.equal(Object.isFrozen(result), true);
  });

  it("fails closed on invalid, missing or repository-failed state", async () => {
    await assert.rejects(readOneOffPaymentSource("not-a-uuid"), /ONE_OFF_PAYMENT_SOURCE_CLIENT_INVALID/);
    await assert.rejects(
      readOneOffPaymentSource(REQUEST.clientId, { reader: async () => ({ ok: true, value: null }) }),
      /ONE_OFF_PAYMENT_SOURCE_UNAVAILABLE/,
    );
    await assert.rejects(
      readOneOffPaymentSource(REQUEST.clientId, {
        reader: async () => ({ ok: false, error: new Error("private database detail") }) as never,
      }),
      (error) => error instanceof Error
        && error.message === "ONE_OFF_PAYMENT_SOURCE_UNAVAILABLE"
        && !error.message.includes("private database detail"),
    );
  });
});

describe("real Stripe one-off account arm", { skip: "SKIPPED: key-arrival account verification is external" }, () => {
  it("is never reported passed by the local suite", () => {
    assert.fail("external account verification must remain skipped locally");
  });
});
