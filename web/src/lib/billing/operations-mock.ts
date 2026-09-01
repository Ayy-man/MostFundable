import { mockRef } from "./mock.ts";
import type { BillingOperationsAdapter, CheckoutSessionResult } from "./types.ts";

export function createMockBillingOperationsAdapter(): BillingOperationsAdapter {
  const sessions = new Map<string, CheckoutSessionResult>();
  return {
    driver: "mock",
    async createCheckoutSession(input) {
      const providerRef = mockRef("cs", input.operationId);
      const existing = sessions.get(providerRef);
      if (existing) return existing;
      const session = {
        customerRef: input.customerRef ?? mockRef("cus", input.orgId),
        providerRef,
        status: "open" as const,
        subscriptionRef: null,
        url: `https://billing.mock.local/checkout/${input.orgId}`,
      };
      sessions.set(providerRef, session);
      return session;
    },
    async createPortalSession(input) {
      return { url: `https://billing.mock.local/portal/${input.orgId}` };
    },
    async readCheckoutSession(input) {
      return sessions.get(input.providerRef) ?? null;
    },
  };
}
