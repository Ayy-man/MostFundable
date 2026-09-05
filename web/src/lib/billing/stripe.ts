import Stripe from "stripe";

import type { BillingAdapter, ParsedWebhook } from "./types";

/**
 * The API version this adapter speaks. Pinned rather than inherited, because an
 * account-level default can be changed in the dashboard by someone who has no
 * idea a deployed mapper depends on the payload shape — which is exactly the
 * class of failure G10-01 was. Registering the endpoint against this same
 * version is lane B's KA-3, still open.
 */
export const STRIPE_API_VERSION = "2026-07-29.dahlia";

function objectReference(value: string | { id: string } | null): string | null {
  if (typeof value === "string") return value;
  return value?.id ?? null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/**
 * On `2026-07-29.dahlia` an invoice carries its subscription at
 * `parent.subscription_details.subscription`, and `Invoice` has no top-level
 * `subscription` field at all. Reading only the old field returned null for
 * every real invoice event, which silently disabled lane B's charge settlement
 * against a live account (docs/GAPS.md G10-01). The legacy read is kept as a
 * fallback so an older payload or a replayed fixture still resolves.
 */
function subscriptionFromInvoice(
  object: Record<string, unknown>,
): string | null {
  const parent = record(object.parent);
  const details = record(parent?.subscription_details);
  const fromParent = details?.subscription;

  if (typeof fromParent === "string") return fromParent;
  const expanded = record(fromParent);
  if (expanded && typeof expanded.id === "string") return expanded.id;

  return typeof object.subscription === "string" ? object.subscription : null;
}

function secondsToIso(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value * 1000).toISOString()
    : null;
}

/**
 * A subscription's period end moved onto the item on this API version, so the
 * item is read first; the top-level field is kept for an invoice payload and
 * for anything older.
 */
function periodEnd(object: Record<string, unknown>): string | null {
  const items = record(object.items);
  const data = Array.isArray(items?.data) ? items.data : [];
  const firstItem = record(data[0]);

  return (
    secondsToIso(firstItem?.current_period_end) ??
    secondsToIso(object.current_period_end) ??
    secondsToIso(object.period_end)
  );
}

function subscriptionResult(subscription: Stripe.Subscription): import("./types").StartSubscriptionResult {
  const item = subscription.items.data[0];
  return {
    amountCents: item?.price.unit_amount ?? 0,
    currency: item?.price.currency ?? "usd",
    currentPeriodEnd: new Date((item?.current_period_end ?? subscription.created) * 1000).toISOString(),
    status: subscription.status === "active" ? "active" : subscription.status === "past_due" ? "past_due" : "incomplete",
    subscriptionRef: subscription.id,
  };
}

/**
 * Exported so the mapping can be tested against hand-written payloads read off
 * the pinned SDK's type declarations. Nothing outside a test calls it.
 */
export function mapWebhook(event: Stripe.Event): ParsedWebhook {
  const object = event.data.object as unknown as Record<string, unknown>;
  const isSubscriptionEvent = event.type.startsWith("customer.subscription.");
  const isRefundEvent = event.type === "charge.refunded";
  const isPaidInvoice = event.type === "invoice.paid";
  const invoice = record(object.invoice);
  const statusTransitions = record(object.status_transitions);

  return {
    amountRefundedCents:
      isRefundEvent && typeof object.amount_refunded === "number"
        ? object.amount_refunded
        : undefined,
    attemptCount:
      typeof object.attempt_count === "number" ? object.attempt_count : undefined,
    cancelAtPeriodEnd:
      typeof object.cancel_at_period_end === "boolean"
        ? object.cancel_at_period_end
        : undefined,
    createdAt: new Date(event.created * 1000).toISOString(),
    currentPeriodEnd: periodEnd(object),
    customerRef:
      typeof object.customer === "string"
        ? object.customer
        : object.customer && typeof object.customer === "object" && "id" in object.customer
          ? String(object.customer.id)
          : null,
    chargeRef: isRefundEvent && typeof object.id === "string" ? object.id : undefined,
    currency:
      (isRefundEvent || isPaidInvoice) && typeof object.currency === "string"
        ? object.currency
        : undefined,
    eventId: event.id,
    eventType: event.type,
    invoiceAmountPaidCents:
      isPaidInvoice && typeof object.amount_paid === "number"
        ? object.amount_paid
        : undefined,
    invoicePaidAt: isPaidInvoice ? secondsToIso(statusTransitions?.paid_at) ?? undefined : undefined,
    invoiceRef: isPaidInvoice && typeof object.id === "string" ? object.id : undefined,
    invoicePeriodEnd: isPaidInvoice ? secondsToIso(object.period_end) ?? undefined : undefined,
    invoicePeriodStart: isPaidInvoice ? secondsToIso(object.period_start) ?? undefined : undefined,
    nextPaymentAttemptAt:
      "next_payment_attempt" in object
        ? secondsToIso(object.next_payment_attempt)
        : undefined,
    provider: "stripe",
    setupIntentRef:
      typeof object.setup_intent === "string" ? object.setup_intent : null,
    subscriptionRef: isSubscriptionEvent
      ? String(object.id ?? "") || null
      : isRefundEvent && invoice
        ? subscriptionFromInvoice(invoice)
        : subscriptionFromInvoice(object),
    subscriptionStatus:
      typeof object.status === "string" && isSubscriptionEvent
        ? object.status
        : undefined,
  };
}

export function createStripeAdapter(secretKey: string): BillingAdapter {
  // Pinned rather than inherited from the account default, so a dashboard
  // change cannot reshape a payload this mapper already agreed to read.
  const stripe = new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION });

  return {
    async createSetupIntent(request) {
      const customerRef = request.customerRef
        ? request.customerRef
        : (
            await stripe.customers.create({
              email: request.email,
              metadata: { client_id: request.clientId },
              name: request.fullName,
            })
          ).id;
      const setupIntent = await stripe.setupIntents.create(
        {
          customer: customerRef,
          payment_method_types: ["card"],
          usage: "off_session",
        },
        { idempotencyKey: `enroll:${request.enrollmentId}:seti` },
      );

      return {
        clientSecret: setupIntent.client_secret,
        customerRef,
        setupIntentRef: setupIntent.id,
      };
    },

    async confirmCard(request) {
      const setupIntent = await stripe.setupIntents.retrieve(request.setupIntentRef);
      const paymentMethodRef = objectReference(setupIntent.payment_method);
      let last4: string | null = null;
      if (paymentMethodRef) {
        const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodRef);
        last4 = paymentMethod.card?.last4 ?? null;
      }

      return {
        failureCode: setupIntent.last_setup_error?.code,
        last4,
        paymentMethodRef,
        status:
          setupIntent.status === "succeeded"
            ? "succeeded"
            : setupIntent.status === "requires_action"
              ? "requires_action"
              : "failed",
      };
    },

    async findSubscription(request) {
      const result = await stripe.subscriptions.search({
        limit: 2,
        query: `metadata['enrollment_id']:'${request.enrollmentId}' AND metadata['operation_id']:'${request.operationId}'`,
      });
      if (result.data.length > 1) throw new Error("CONSUMER_SUBSCRIPTION_RECONCILIATION_AMBIGUOUS");
      return result.data[0] ? subscriptionResult(result.data[0]) : null;
    },

    async startSubscription(request) {
      // This call finalizes and attempts the first invoice as part of the
      // request, so only the verified-IDV branch may ever reach it (D-06).
      const subscription = await stripe.subscriptions.create(
        {
          collection_method: "charge_automatically",
          customer: request.customerRef,
          default_payment_method: request.paymentMethodRef,
          items: [{ price: request.priceRef }],
          metadata: {
            enrollment_id: request.enrollmentId,
            operation_id: request.operationId,
          },
        },
        { idempotencyKey: request.idempotencyKey },
      );
      return subscriptionResult(subscription);
    },

    async cancel(request) {
      const subscription = request.atPeriodEnd
        ? await stripe.subscriptions.update(request.subscriptionRef, {
            cancel_at_period_end: true,
          })
        : await stripe.subscriptions.cancel(request.subscriptionRef);

      return {
        cancelledAt: subscription.canceled_at
          ? new Date(subscription.canceled_at * 1000).toISOString()
          : null,
        status: subscription.status === "canceled" ? "cancelled" : "active",
        subscriptionRef: subscription.id,
      };
    },

    async parseWebhook(rawBody, signatureHeader) {
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!signatureHeader || !webhookSecret) {
        throw new Error("Stripe webhook verification is not configured");
      }
      return mapWebhook(
        stripe.webhooks.constructEvent(rawBody, signatureHeader, webhookSecret),
      );
    },
  };
}
