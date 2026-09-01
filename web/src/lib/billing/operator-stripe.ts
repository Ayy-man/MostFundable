// operator-stripe.ts — the real arm of the operator billing port.
//
// It reads no environment variable of its own: the secret arrives from the
// selector in `index.ts` and every price reference arrives from `config.ts`, so
// there is exactly one resolution path for an amount and exactly one place a
// credential is read. That is what lets `next build` succeed under `env -i` —
// nothing here touches `process.env` at module load or at call time.

import Stripe from "stripe";

import { OPERATOR_SUBSCRIPTION_STATUSES } from "./operator-ladder";
import { STRIPE_API_VERSION } from "./stripe";
import { applyProductStatementDescriptor } from "./operations-stripe.ts";
import type {
  CancelOperatorSubscriptionRequest,
  CancelOperatorSubscriptionResult,
  FindOperatorSubscriptionRequest,
  OperatorBillingAdapter,
  OperatorSubscriptionSnapshot,
  OperatorSubscriptionStatus,
  ReadOperatorSubscriptionRequest,
  StartOperatorSubscriptionRequest,
  UpdateSeatQuantityRequest,
  UpdateSeatQuantityResult,
} from "./types";

/**
 * A subscription carries exactly two items: the base plan and the per-seat
 * add-on. A bureau pull is a charge, never a line on this subscription (#31),
 * so a third item means something upstream is wrong and the caller should hear
 * about it rather than be billed for it.
 */
const OPERATOR_ITEM_COUNT = 2;

function modelledStatus(status: string): OperatorSubscriptionStatus | null {
  return (OPERATOR_SUBSCRIPTION_STATUSES as readonly string[]).includes(status)
    ? (status as OperatorSubscriptionStatus)
    : null;
}

function reference(value: string | { id: string } | null | undefined): string | null {
  if (typeof value === "string") return value;
  return value?.id ?? null;
}

function itemFor(
  subscription: Stripe.Subscription,
  priceRef: string,
): Stripe.SubscriptionItem | undefined {
  return subscription.items.data.find((item) => item.price.id === priceRef);
}

function periodEnd(subscription: Stripe.Subscription): string | null {
  const seconds = subscription.items.data[0]?.current_period_end;
  return typeof seconds === "number"
    ? new Date(seconds * 1000).toISOString()
    : null;
}

function snapshot(
  subscription: Stripe.Subscription,
  baseItemRef: string | null,
  seatItemRef: string | null,
  seatQuantity: number,
): OperatorSubscriptionSnapshot {
  return {
    baseItemRef,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    currentPeriodEnd: periodEnd(subscription),
    customerRef: reference(subscription.customer) ?? "",
    providerStatus: subscription.status,
    seatItemRef,
    seatQuantity,
    status: modelledStatus(subscription.status),
    subscriptionRef: subscription.id,
  };
}

export function createStripeOperatorAdapter(
  secretKey: string,
  statementDescriptor: string | null = null,
  client?: Stripe,
): OperatorBillingAdapter {
  const stripe = client ?? new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION });

  return {
    async getSubscriptionState(request) {
      const subscription = await stripe.subscriptions.retrieve(request.subscriptionRef);
      const [first, second] = subscription.items.data;
      return snapshot(subscription, first?.id ?? null, second?.id ?? null, second?.quantity ?? 0);
    },
    async startOperatorSubscription(
      request: StartOperatorSubscriptionRequest,
    ): Promise<OperatorSubscriptionSnapshot> {
      await applyProductStatementDescriptor(
        stripe as unknown as Parameters<typeof applyProductStatementDescriptor>[0],
        request.basePriceRef,
        statementDescriptor,
      );

      const subscription = await stripe.subscriptions.create(
        {
          collection_method: "charge_automatically",
          customer: request.billingCustomerRef,
          items: [
            { price: request.basePriceRef, quantity: 1 },
            { price: request.seatPriceRef, quantity: request.seatQuantity },
          ],
          // The operation id travels with the subscription so a crashed attempt
          // can find what it created after the idempotency key stops
          // deduplicating (R4C-09). Migration 332 put the same field on the
          // consumer subscription for the same reason.
          metadata: { operation_id: request.operationId, org_id: request.orgId },
        },
        { idempotencyKey: `operator:${request.orgId}:subscription:${request.operationId}` },
      );

      // Checked on what came back, not on what was sent: a price configured as
      // a tiered or metered bundle can expand into extra lines, and the caller
      // should hear about a third line rather than be billed for it.
      if (subscription.items.data.length !== OPERATOR_ITEM_COUNT) {
        throw new Error(
          `an operator subscription carries a base item and a seat item and nothing else; the provider returned ${subscription.items.data.length}`,
        );
      }

      const seatItem = itemFor(subscription, request.seatPriceRef);

      return snapshot(
        subscription,
        itemFor(subscription, request.basePriceRef)?.id ?? null,
        seatItem?.id ?? null,
        seatItem?.quantity ?? request.seatQuantity,
      );
    },

    async findOperatorSubscription(
      request: FindOperatorSubscriptionRequest,
    ): Promise<OperatorSubscriptionSnapshot | null> {
      const result = await stripe.subscriptions.search({
        limit: 2,
        query: `metadata['org_id']:'${request.orgId}' AND metadata['operation_id']:'${request.operationId}'`,
      });
      // Two answers to one operation id means the durable identity failed to do
      // its job, and picking one would settle the organization against a
      // subscription while a second one keeps billing. The caller parks it.
      if (result.data.length > 1) throw new Error("OPERATOR_SUBSCRIPTION_RECONCILIATION_AMBIGUOUS");
      const found = result.data[0];
      if (!found) return null;
      if (reference(found.customer) !== request.billingCustomerRef) {
        throw new Error("OPERATOR_SUBSCRIPTION_RECONCILIATION_AMBIGUOUS");
      }

      const [first, second] = found.items.data;
      const baseItem = first?.quantity === 1 ? first : second;
      const seatItem = baseItem === first ? second : first;
      return snapshot(found, baseItem?.id ?? null, seatItem?.id ?? null, seatItem?.quantity ?? 0);
    },

    async updateSeatQuantity(
      request: UpdateSeatQuantityRequest,
    ): Promise<UpdateSeatQuantityResult> {
      // Explicit rather than inherited: a quantity change prorates by default,
      // but the default is an account setting, and a silent switch to `none`
      // would under-bill every seat change from that moment on.
      const subscription = await stripe.subscriptions.update(
        request.subscriptionRef,
        {
          items: [{ id: request.seatItemRef, quantity: request.quantity }],
          proration_behavior: "create_prorations",
        },
        { idempotencyKey: request.idempotencyKey },
      );

      const seatItem = subscription.items.data.find(
        (item) => item.id === request.seatItemRef,
      );

      return {
        quantity: seatItem?.quantity ?? request.quantity,
        seatItemRef: request.seatItemRef,
        subscriptionRef: subscription.id,
      };
    },

    async cancelOperatorSubscription(
      request: CancelOperatorSubscriptionRequest,
    ): Promise<CancelOperatorSubscriptionResult> {
      const subscription = request.atPeriodEnd
        ? await stripe.subscriptions.update(request.subscriptionRef, {
            cancel_at_period_end: true,
          })
        : await stripe.subscriptions.cancel(request.subscriptionRef);

      return {
        cancelledAt: subscription.canceled_at
          ? new Date(subscription.canceled_at * 1000).toISOString()
          : null,
        status: modelledStatus(subscription.status),
        subscriptionRef: subscription.id,
      };
    },

    async readOperatorSubscription(
      request: ReadOperatorSubscriptionRequest,
    ): Promise<OperatorSubscriptionSnapshot | null> {
      const subscription = await stripe.subscriptions.retrieve(
        request.subscriptionRef,
      );
      const [first, second] = subscription.items.data;

      // The base item is the quantity-1 line and the seat item is the other
      // one; on a subscription this phase created there are only ever those two.
      const baseItem = first?.quantity === 1 ? first : second;
      const seatItem = baseItem === first ? second : first;

      return snapshot(
        subscription,
        baseItem?.id ?? null,
        seatItem?.id ?? null,
        seatItem?.quantity ?? 0,
      );
    },
  };
}
