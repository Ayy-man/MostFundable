import { mockRef } from "./mock.ts";

import type {
  OneOffBillingAdapter,
  OneOffPaymentOutcome,
  OneOffPaymentRequest,
} from "./types.ts";

export function createMockOneOffAdapter(
  options: { outcome?: OneOffPaymentOutcome } = {},
): OneOffBillingAdapter {
  const ledger = new Map<string, { requestId: string; result: Readonly<{
    amountCents: number;
    currency: "usd";
    outcome: OneOffPaymentOutcome;
    provider: "mock";
    providerEventKey: string;
    providerPaymentRef: string;
  }> }>();
  return {
    async createOneOffPayment(request: OneOffPaymentRequest) {
      const existing = ledger.get(request.idempotencyKey);
      if (existing) {
        if (existing.requestId !== request.requestId) throw new Error("ONE_OFF_PAYMENT_REPLAY_MISMATCH");
        return existing.result;
      }
      const outcome = options.outcome ?? (
        request.paymentMethodRef.startsWith("mock_payment_requires_action_")
          ? "requires_action"
          : request.paymentMethodRef.startsWith("mock_payment_failed_")
            ? "failed"
            : "succeeded"
      );
      const providerPaymentRef = mockRef("pi", request.requestId);
      const result = Object.freeze({
        amountCents: request.amountCents,
        currency: request.currency,
        outcome,
        provider: "mock" as const,
        providerEventKey: `mock:${providerPaymentRef}:${outcome}`,
        providerPaymentRef,
      });
      ledger.set(request.idempotencyKey, { requestId: request.requestId, result });
      return result;
    },
    async findOneOffPayment(request) {
      const existing = ledger.get(request.idempotencyKey);
      if (!existing || existing.requestId !== request.requestId) return null;
      return existing.result;
    },
  };
}
