import Stripe from "stripe";

import { STRIPE_API_VERSION } from "./stripe.ts";

import type {
  OneOffBillingAdapter,
  OneOffPaymentOutcome,
  OneOffPaymentRequest,
} from "./types.ts";

export type OneOffStripeClient = Pick<Stripe, "paymentIntents">;

type StripePayment = {
  amount: number;
  currency: string;
  id: string;
  metadata?: Record<string, string>;
  status: string;
};

function outcome(status: string): OneOffPaymentOutcome {
  if (status === "succeeded") return "succeeded";
  if (status === "requires_action") return "requires_action";
  return "failed";
}

function validateRequest(request: OneOffPaymentRequest): void {
  if (!Number.isSafeInteger(request.amountCents) || request.amountCents <= 0) {
    throw new Error("ONE_OFF_PAYMENT_INPUT_INVALID");
  }
  for (const value of [
    request.clientId,
    request.requestId,
    request.customerRef,
    request.paymentMethodRef,
    request.idempotencyKey,
  ]) {
    if (!value.trim() || value.length > 255 || /[\r\n]/.test(value)) {
      throw new Error("ONE_OFF_PAYMENT_INPUT_INVALID");
    }
  }
}

function paymentResult(payment: StripePayment, expected?: Pick<OneOffPaymentRequest, "amountCents" | "currency">) {
  if (
    !payment.id?.trim()
    || !Number.isSafeInteger(payment.amount)
    || payment.amount <= 0
    || payment.currency !== "usd"
    || typeof payment.status !== "string"
    || (expected && (payment.amount !== expected.amountCents || payment.currency !== expected.currency))
  ) {
    throw new Error("ONE_OFF_PAYMENT_RESULT_INVALID");
  }
  const mapped = outcome(payment.status);
  return Object.freeze({
    amountCents: payment.amount,
    currency: payment.currency as "usd",
    outcome: mapped,
    provider: "stripe" as const,
    providerEventKey: `stripe:${payment.id}:${payment.status}`,
    providerPaymentRef: payment.id,
  });
}

export function createStripeOneOffAdapter(
  secretKey: string,
  client?: OneOffStripeClient,
): OneOffBillingAdapter {
  const stripe = client ?? new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION });
  return {
    async createOneOffPayment(request: OneOffPaymentRequest) {
      validateRequest(request);
      const payment = await stripe.paymentIntents.create(
        {
          amount: request.amountCents,
          confirm: true,
          currency: request.currency,
          customer: request.customerRef,
          metadata: {
            client_id: request.clientId,
            idempotency_key: request.idempotencyKey,
            request_id: request.requestId,
          },
          off_session: true,
          payment_method: request.paymentMethodRef,
        },
        { idempotencyKey: request.idempotencyKey },
      );
      return paymentResult(payment, request);
    },
    async findOneOffPayment(request) {
      for (const value of [request.idempotencyKey, request.requestId]) {
        if (!value.trim() || value.length > 255 || /[^a-zA-Z0-9:_-]/.test(value)) {
          throw new Error("ONE_OFF_PAYMENT_INPUT_INVALID");
        }
      }
      const result = await stripe.paymentIntents.search({
        limit: 2,
        query: `metadata['request_id']:'${request.requestId}' AND metadata['idempotency_key']:'${request.idempotencyKey}'`,
      });
      if (result.data.length > 1) throw new Error("ONE_OFF_PAYMENT_RECONCILIATION_AMBIGUOUS");
      const payment = result.data[0];
      if (!payment) return null;
      return paymentResult(payment);
    },
  };
}
