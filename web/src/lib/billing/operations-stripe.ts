import Stripe from "stripe";

import { STRIPE_API_VERSION } from "./stripe.ts";
import type { BillingOperationsAdapter } from "./types.ts";

type StripeOperationsClient = {
  billingPortal: { sessions: { create(params: Record<string, unknown>): Promise<{ url: string }> } };
  checkout: { sessions: {
    create(params: Record<string, unknown>, options: { idempotencyKey: string }): Promise<{ id: string; status?: "complete" | "expired" | "open" | null; subscription?: string | { id: string } | null; url: string | null }>;
    retrieve(id: string): Promise<{ customer: string | { id: string } | null; id: string; status?: "complete" | "expired" | "open" | null; subscription?: string | { id: string } | null; url: string | null }>;
  } };
  customers: { create(params: Record<string, unknown>, options: { idempotencyKey: string }): Promise<{ id: string }> };
  prices: { retrieve(id: string): Promise<{ product: string | { id: string } }> };
  products: { update(id: string, params: { statement_descriptor: string }): Promise<unknown> };
};

function reference(value: string | { id: string } | null | undefined): string | null {
  return typeof value === "string" ? value : value?.id ?? null;
}

function hostedUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("BILLING_PROVIDER_RESULT_INVALID");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") throw new Error("BILLING_PROVIDER_RESULT_INVALID");
  return parsed.toString();
}

export async function applyProductStatementDescriptor(
  client: Pick<StripeOperationsClient, "prices" | "products">,
  priceRef: string,
  descriptor: string | null,
): Promise<void> {
  if (!descriptor) return;
  const price = await client.prices.retrieve(priceRef);
  await client.products.update(reference(price.product) as string, { statement_descriptor: descriptor });
}

export function createStripeBillingOperationsAdapter(
  secretKey: string,
  descriptor: string | null,
  client?: StripeOperationsClient,
): BillingOperationsAdapter {
  const stripe = client ?? new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION }) as unknown as StripeOperationsClient;
  return {
    driver: "stripe",
    async createCheckoutSession(input) {
      const customerRef = input.customerRef ?? (await stripe.customers.create(
        {
          email: input.ownerEmail,
          metadata: { org_id: input.orgId },
          name: input.orgName,
        },
        { idempotencyKey: `operator:${input.orgId}:customer` },
      )).id;
      await applyProductStatementDescriptor(stripe, input.basePriceRef, descriptor);
      const session = await stripe.checkout.sessions.create({
        cancel_url: input.cancelUrl,
        client_reference_id: input.orgId,
        customer: customerRef,
        line_items: [
          { price: input.basePriceRef, quantity: 1 },
          { price: input.seatPriceRef, quantity: input.seatQuantity },
        ],
        metadata: { org_id: input.orgId },
        mode: "subscription",
        subscription_data: { metadata: { org_id: input.orgId } },
        success_url: input.successUrl,
      }, { idempotencyKey: `operator:${input.orgId}:checkout:${input.operationId}` });
      return { customerRef, providerRef: session.id, status: session.status ?? "open", subscriptionRef: reference(session.subscription), url: hostedUrl(session.url) };
    },
    async createPortalSession(input) {
      const session = await stripe.billingPortal.sessions.create({
        customer: input.customerRef,
        return_url: input.returnUrl,
      });
      return { url: hostedUrl(session.url) };
    },
    async readCheckoutSession(input) {
      const session = await stripe.checkout.sessions.retrieve(input.providerRef);
      if (!session.customer) return null;
      return {
        customerRef: reference(session.customer) as string,
        providerRef: session.id,
        status: session.status ?? "open",
        subscriptionRef: reference(session.subscription),
        // A retrieved session may legitimately have no URL — Stripe returns
        // null once it expires — and the caller decides what that means from
        // `status` and `subscriptionRef`. Validating it as a redirect here
        // turned an expired session into a provider outage and blocked the one
        // path that exists to release the intent (R4C-05).
        url: session.url === null || session.url === undefined ? null : hostedUrl(session.url),
      };
    },
  };
}
