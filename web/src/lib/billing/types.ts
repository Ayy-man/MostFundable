export type BillingDriver = "mock" | "stripe";

export type CreateSetupIntentRequest = {
  clientId: string;
  customerRef?: string | null;
  email: string;
  enrollmentId: string;
  fullName: string;
};

export type CreateSetupIntentResult = {
  clientSecret: string | null;
  customerRef: string;
  setupIntentRef: string;
};

export type ConfirmCardRequest = {
  /** Used only by the mock; real card confirmation happens in the browser. */
  demoCardLast4?: string;
  setupIntentRef: string;
};

export type ConfirmCardResult = {
  failureCode?: string;
  /** In-session UI echo only. Never persist or log this value. */
  last4: string | null;
  paymentMethodRef: string | null;
  status: "succeeded" | "requires_action" | "failed";
};

export type StartSubscriptionRequest = {
  customerRef: string;
  enrollmentId: string;
  /** Deterministic and derived from the enrollment id. */
  idempotencyKey: string;
  paymentMethodRef: string;
  operationId: string;
  priceRef: string;
};

export type FindSubscriptionRequest = Pick<StartSubscriptionRequest, "enrollmentId" | "operationId">;

export type StartSubscriptionResult = {
  amountCents: number;
  currency: string;
  currentPeriodEnd: string;
  status: "active" | "incomplete" | "past_due";
  subscriptionRef: string;
};

export type CancelRequest = {
  atPeriodEnd: boolean;
  subscriptionRef: string;
};

export type CancelResult = {
  cancelledAt: string | null;
  status: "cancelled" | "active";
  subscriptionRef: string;
};

/**
 * Routing keys only. The provider event body never crosses this boundary.
 *
 * Phase 10 widened this with five fields the operator dunning ladder needs, and
 * every one of them is optional on purpose: lane B builds `ParsedWebhook`
 * literals in several places, and a required field would have made this an
 * edit to lane B's files rather than an addition alongside them.
 */
export type ParsedWebhook = {
  /** Present on `customer.subscription.*`; the ladder reports it verbatim. */
  attemptCount?: number;
  /** Present only on a verified `charge.refunded` Charge payload. */
  amountRefundedCents?: number;
  cancelAtPeriodEnd?: boolean;
  createdAt: string;
  currentPeriodEnd?: string | null;
  customerRef: string | null;
  /** Present only on a verified `charge.refunded` Charge payload. */
  chargeRef?: string;
  /** Present only on a verified `charge.refunded` Charge payload. */
  currency?: string;
  eventId: string;
  eventType: string;
  /**
   * Null or absent on an `invoice.payment_failed` means the provider has no
   * further retry scheduled, which is what opens the grace window (D-04).
   */
  nextPaymentAttemptAt?: string | null;
  setupIntentRef: string | null;
  subscriptionRef: string | null;
  /** The provider's status string, carried verbatim and never narrowed here. */
  subscriptionStatus?: string;
};

// ---------------------------------------------------------------------------
// Operator billing (Phase 10, S2.1).
//
// A second interface rather than four more methods on `BillingAdapter`, because
// INTERFACES §10 freezes that shape and four lanes depend on it (D-08). The two
// share `resolveDriver("billing")` and nothing else.
// ---------------------------------------------------------------------------

/** The product-facing rung. Matches the `public.org_membership` enum exactly. */
export type OperatorMembership =
  | "trial"
  | "current"
  | "past_due"
  | "grace"
  | "deactivated";

/**
 * The provider's own status, carried verbatim. Matches the
 * `public.operator_subscription_status` enum, which matches the pinned SDK's
 * `Subscription.Status` union.
 */
export type OperatorSubscriptionStatus =
  | "trialing"
  | "active"
  | "incomplete"
  | "incomplete_expired"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "paused";

export type StartOperatorSubscriptionRequest = {
  basePriceRef: string;
  /** Resolved from this organization's persisted billing row. */
  billingCustomerRef: string;
  orgId: string;
  orgName: string;
  /** Server-owned durable operation id shared across retries. */
  operationId: string;
  ownerEmail: string;
  seatPriceRef: string;
  seatQuantity: number;
};

export type OperatorSubscriptionSnapshot = {
  baseItemRef: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  customerRef: string;
  /** The provider's status string, verbatim, even when we do not model it. */
  providerStatus: string;
  seatItemRef: string | null;
  seatQuantity: number;
  /**
   * Null when the provider reported a status this build does not model. The
   * SDK's own `Subscription.Status` union carries an `OtherString` escape, so
   * that is a real runtime case; coercing it to a modelled value would put a
   * wrong status in a row a human reads.
   */
  status: OperatorSubscriptionStatus | null;
  subscriptionRef: string;
};

export type UpdateSeatQuantityRequest = {
  /** Deterministic and derived from the organization id and the quantity. */
  idempotencyKey: string;
  quantity: number;
  seatItemRef: string;
  subscriptionRef: string;
};

export type UpdateSeatQuantityResult = {
  quantity: number;
  seatItemRef: string;
  subscriptionRef: string;
};

export type CancelOperatorSubscriptionRequest = {
  atPeriodEnd: boolean;
  subscriptionRef: string;
};

export type CancelOperatorSubscriptionResult = {
  cancelledAt: string | null;
  /** Null for the same reason as on the snapshot. */
  status: OperatorSubscriptionStatus | null;
  subscriptionRef: string;
};

export type ReadOperatorSubscriptionRequest = {
  subscriptionRef: string;
};

/**
 * Finds what a previous attempt on this operation id already created (R4C-09).
 *
 * The subscription reference is exactly what a crashed attempt does not have,
 * so the lookup is by the server-owned operation id the adapter writes into
 * provider metadata, narrowed by the organization and its billing customer so a
 * metadata collision cannot hand back somebody else's subscription. This is the
 * operator twin of `findSubscription` on the consumer adapter and, like it, the
 * only read this port grows: more than one match is an ambiguity the caller has
 * to escalate, never a row to pick from.
 */
export type FindOperatorSubscriptionRequest = {
  billingCustomerRef: string;
  operationId: string;
  orgId: string;
};

export type OperatorBillingAdapter = {
  getSubscriptionState(
    request: ReadOperatorSubscriptionRequest,
  ): Promise<OperatorSubscriptionSnapshot | null>;
  cancelOperatorSubscription(
    request: CancelOperatorSubscriptionRequest,
  ): Promise<CancelOperatorSubscriptionResult>;
  findOperatorSubscription(
    request: FindOperatorSubscriptionRequest,
  ): Promise<OperatorSubscriptionSnapshot | null>;
  readOperatorSubscription(
    request: ReadOperatorSubscriptionRequest,
  ): Promise<OperatorSubscriptionSnapshot | null>;
  startOperatorSubscription(
    request: StartOperatorSubscriptionRequest,
  ): Promise<OperatorSubscriptionSnapshot>;
  updateSeatQuantity(
    request: UpdateSeatQuantityRequest,
  ): Promise<UpdateSeatQuantityResult>;
};

// Hosted operator billing sessions (Phase 21). Kept separate from the frozen
// consumer and direct-subscription adapters because these calls return only
// provider-hosted URLs and never expose a payment form secret.
export type CheckoutSessionInput = {
  basePriceRef: string;
  cancelUrl: string;
  customerRef: string | null;
  orgId: string;
  orgName: string;
  /** Server-owned durable operation id shared across both creation routes. */
  operationId: string;
  ownerEmail: string;
  seatPriceRef: string;
  seatQuantity: number;
  successUrl: string;
};

export type CheckoutSessionResult = {
  customerRef: string;
  providerRef: string;
  status: "complete" | "expired" | "open";
  subscriptionRef: string | null;
  url: string;
};

/**
 * What a *retrieved* Checkout session looks like, which is not what a freshly
 * created one looks like (R4C-05).
 *
 * Stripe's contract returns a null `url` for a session that is no longer
 * redirectable — an expired one, most of all. Modelling the read with the
 * create shape meant the product treated a field the provider documents as
 * nullable as always-present, so the one path built to release a stuck intent
 * threw on exactly the response it was built for. A newly created open session
 * still owes us an HTTPS URL and keeps `CheckoutSessionResult`.
 */
export type CheckoutSessionSnapshot = Omit<CheckoutSessionResult, "url"> & {
  url: string | null;
};

export type PortalSessionInput = {
  customerRef: string;
  orgId: string;
  returnUrl: string;
};

export type BillingOperationsAdapter = {
  driver: BillingDriver;
  createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult>;
  createPortalSession(input: PortalSessionInput): Promise<{ url: string }>;
  readCheckoutSession(input: { providerRef: string }): Promise<CheckoutSessionSnapshot | null>;
};

// One-off billing (Phase 18). This is a separate operation family so the
// subscription adapter below remains frozen for its existing callers.
export type OneOffPaymentOutcome = "succeeded" | "requires_action" | "failed";

export type OneOffPaymentSource = {
  customerRef: string;
  paymentMethodRef: string;
};

export type OneOffPaymentRequest = OneOffPaymentSource & {
  amountCents: number;
  clientId: string;
  currency: "usd";
  idempotencyKey: string;
  requestId: string;
};

export type OneOffPaymentResult = {
  amountCents: number;
  currency: "usd";
  outcome: OneOffPaymentOutcome;
  provider: BillingDriver;
  providerEventKey: string;
  providerPaymentRef: string;
};

export type OneOffBillingAdapter = {
  createOneOffPayment(request: OneOffPaymentRequest): Promise<OneOffPaymentResult>;
  findOneOffPayment(request: Pick<OneOffPaymentRequest, "idempotencyKey" | "requestId">): Promise<OneOffPaymentResult | null>;
};

export type BillingAdapter = {
  cancel(request: CancelRequest): Promise<CancelResult>;
  confirmCard(request: ConfirmCardRequest): Promise<ConfirmCardResult>;
  createSetupIntent(
    request: CreateSetupIntentRequest,
  ): Promise<CreateSetupIntentResult>;
  findSubscription(request: FindSubscriptionRequest): Promise<StartSubscriptionResult | null>;
  parseWebhook(
    rawBody: string,
    signatureHeader: string | null,
  ): Promise<ParsedWebhook>;
  startSubscription(
    request: StartSubscriptionRequest,
  ): Promise<StartSubscriptionResult>;
};
