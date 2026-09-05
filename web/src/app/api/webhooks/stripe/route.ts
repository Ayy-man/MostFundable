// Raw-body pattern: Next App Router route handlers expose the body directly,
// so no body-parser configuration or intermediate JSON parse belongs here.
import { randomUUID } from "node:crypto";

import { getBillingAdapter } from "@/lib/billing";
import { recordRouteFailure } from "@/lib/diagnostics/route-failure";
import {
  processWebhookEvent,
  recordWebhookEvent,
} from "@/lib/enrollment/service-webhook";
import type { ParsedWebhook } from "@/lib/billing/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WebhookDependencies = {
  billingEnabled(): Promise<boolean>;
  billingOpsEnabled(): Promise<boolean>;
  consumerEnabled(): Promise<boolean>;
  handleOperator(event: ParsedWebhook): Promise<boolean>;
  markStatus(eventId: string, leaseOwner: string, status: "failed" | "ignored" | "processed", errorCode?: string): Promise<void>;
  parse(rawBody: string, signature: string | null): Promise<ParsedWebhook>;
  recordPaidInvoice(event: ParsedWebhook): Promise<boolean>;
  processConsumer(event: ParsedWebhook, leaseOwner: string): Promise<void>;
  record(event: ParsedWebhook, leaseOwner: string): Promise<boolean>;
  recordRefund(event: ParsedWebhook): Promise<boolean>;
  webhookReady(): Promise<boolean>;
};

const productionDependencies: WebhookDependencies = {
  async billingEnabled() { return (await import("@/lib/env")).featureFlag("FEATURE_BILLING"); },
  async billingOpsEnabled() { return (await import("@/lib/env")).featureFlag("FEATURE_BILLING_OPS"); },
  async consumerEnabled() { return (await import("@/lib/env")).featureFlag("FEATURE_ENROLLMENT"); },
  async handleOperator(event) { return (await import("@/lib/billing/service-operator")).handleOperatorBillingEvent(event); },
  async markStatus(eventId, leaseOwner, status, errorCode) {
    const result = await (await import("@/lib/enrollment/repository")).markWebhookEvent(eventId, leaseOwner, status, errorCode);
    if (!result.ok) throw result.error;
  },
  async parse(rawBody, signature) { return getBillingAdapter().parseWebhook(rawBody, signature); },
  async recordPaidInvoice(event) { return (await import("@/lib/billing/paid-invoices")).recordPaidInvoiceEvidence(event); },
  processConsumer: processWebhookEvent,
  record: recordWebhookEvent,
  async recordRefund(event) { return (await import("@/lib/billing/refunds")).recordRefundObservation(event); },
  async webhookReady() { return (await import("@/lib/billing")).webhookVerificationReady(process.env); },
};

async function failClaim(
  dependencies: WebhookDependencies,
  eventId: string,
  leaseOwner: string,
  errorCode: string,
): Promise<Response> {
  try {
    await dependencies.markStatus(eventId, leaseOwner, "failed", errorCode);
  } catch {
    // The non-2xx response remains the recovery mechanism when the terminal
    // status write itself failed: provider redelivery can reclaim an expired
    // received lease through claim_stripe_webhook_event.
  }
  // R5B-03. The provider is the only caller here and it reads the status, not the body, so the
  // response stays byte-identical; the record is what changes. `errorCode` is the dispatch stage, so
  // a redelivery storm can be traced to the handler that kept refusing.
  recordRouteFailure({
    cause: null,
    code: errorCode,
    status: 503,
    surface: "api.webhooks.stripe.dispatch",
  });
  return new Response("webhook dispatch failed", { status: 503 });
}

export async function handleStripeWebhook(
  req: Request,
  dependencies: WebhookDependencies = productionDependencies,
): Promise<Response> {
  if (!await dependencies.webhookReady()) {
    return new Response("webhook signing is not configured", { status: 503 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");

  let event: ParsedWebhook;
  try {
    event = await dependencies.parse(rawBody, signature);
  } catch {
    return new Response("signature verification failed", { status: 400 });
  }

  const leaseOwner = randomUUID();
  const fresh = await dependencies.record(event, leaseOwner);
  if (!fresh) return new Response("ok", { status: 200 });

  if (event.provider === "stripe" && event.eventType === "invoice.paid") {
    try {
      await dependencies.recordPaidInvoice(event);
    } catch {
      return failClaim(dependencies, event.eventId, leaseOwner, "paid_invoice_persist_failed");
    }
  }

  if (await dependencies.billingOpsEnabled()) {
    try {
      const refundClaimed = await dependencies.recordRefund(event);
      if (refundClaimed) {
        await dependencies.markStatus(event.eventId, leaseOwner, "processed");
        return new Response("ok", { status: 200 });
      }
    } catch {
      return failClaim(dependencies, event.eventId, leaseOwner, "refund_persist_failed");
    }
  }

  const consumerEnabled = await dependencies.consumerEnabled();
  if (!await dependencies.billingEnabled()) {
    if (consumerEnabled) {
      try {
        await dependencies.processConsumer(event, leaseOwner);
      } catch {
        return failClaim(dependencies, event.eventId, leaseOwner, "consumer_dispatch_failed");
      }
    } else {
      try {
        await dependencies.markStatus(event.eventId, leaseOwner, "ignored");
      } catch (error) {
        recordRouteFailure({
          cause: error,
          code: "webhook_status_write_failed",
          status: 503,
          surface: "api.webhooks.stripe.status",
        });
        return new Response("webhook status write failed", { status: 503 });
      }
    }
    return new Response("ok", { status: 200 });
  }

  let claimed: boolean;
  try {
    claimed = await dependencies.handleOperator(event);
    if (claimed) {
      await dependencies.markStatus(event.eventId, leaseOwner, "processed");
    } else if (consumerEnabled) {
      await dependencies.processConsumer(event, leaseOwner);
    } else {
      await dependencies.markStatus(event.eventId, leaseOwner, "ignored");
    }
  } catch {
    return failClaim(dependencies, event.eventId, leaseOwner, "dispatch_failed");
  }

  return new Response("ok", { status: 200 });
}

export async function POST(req: Request): Promise<Response> {
  return handleStripeWebhook(req);
}
