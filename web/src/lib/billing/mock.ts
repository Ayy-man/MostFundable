import { createHmac, timingSafeEqual } from "node:crypto";

import type {
  BillingAdapter,
  ParsedWebhook,
  StartSubscriptionResult,
} from "./types";

// This fallback protects mock traffic only and is intentionally not a
// credential. A configured signing key is still read lazily when present.
const MOCK_WEBHOOK_SIGNING_VALUE = "mock-webhook-signing-value";
const MOCK_WEBHOOK_TOLERANCE_SECONDS = 300;
const MOCK_PRICE_CENTS = 4900;
const MOCK_CURRENCY = "usd";

export function hasExplicitMockWebhookSigningValue(value: string | undefined): boolean {
  const signingValue = value?.trim();
  return Boolean(signingValue && signingValue !== MOCK_WEBHOOK_SIGNING_VALUE);
}

/**
 * Exported additively for Phase 10's operator driver, which must produce the
 * same `mock_<prefix>_<value>` shape rather than a second reference format.
 */
export function mockRef(prefix: string, value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 48) || "ref";
  return `mock_${prefix}_${normalized}`;
}

function mockSeconds(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value * 1000).toISOString()
    : null;
}

/**
 * Mirrors the real adapter: the pinned API version carries an invoice's
 * subscription at `parent.subscription_details.subscription`, and the legacy
 * top-level field is kept as a fallback so lane B's fixtures still resolve.
 * The mock reads both shapes on purpose — when it read only the legacy field it
 * agreed with a mapper that disagreed with Stripe, and that agreement is what
 * kept G10-01 invisible.
 */
function mockSubscriptionReference(input: Record<string, unknown>): string | null {
  const parent = input.parent;
  if (parent && typeof parent === "object") {
    const details = (parent as Record<string, unknown>).subscription_details;
    if (details && typeof details === "object") {
      const reference = (details as Record<string, unknown>).subscription;
      if (typeof reference === "string") return reference;
      if (reference && typeof reference === "object") {
        const id = (reference as Record<string, unknown>).id;
        if (typeof id === "string") return id;
      }
    }
  }

  return typeof input.subscription === "string" ? input.subscription : null;
}

/**
 * The signing half of the HMAC mirror `parsedMockWebhook` verifies, exported so
 * Phase 10's fixture replay can sign at replay time against the current clock
 * instead of baking a signature into a committed file. A stored signature would
 * be a latent failure the day anything enforces the provider's five-minute
 * tolerance, and it would let a replay pass without exercising verification at
 * all.
 */
export function signMockWebhook(
  rawBody: string,
  timestampSeconds: number,
  configuredSigningValue?: string,
): string {
  const timestamp = String(Math.floor(timestampSeconds));
  const signingValue =
    configuredSigningValue ||
    process.env.STRIPE_WEBHOOK_SECRET ||
    MOCK_WEBHOOK_SIGNING_VALUE;
  const signature = createHmac("sha256", signingValue)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  return `t=${timestamp},v1=${signature}`;
}

function parseSignature(header: string): { timestamp: string; signatures: string[] } {
  const parts = header.split(",");
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
  const signatures = parts
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3));

  if (!timestamp || signatures.length === 0) {
    throw new Error("mock webhook signature is missing required fields");
  }

  return { timestamp, signatures };
}

function safeMatch(expected: string, candidate: string): boolean {
  const expectedBytes = Buffer.from(expected, "hex");
  const candidateBytes = Buffer.from(candidate, "hex");
  return (
    expectedBytes.length === candidateBytes.length &&
    timingSafeEqual(expectedBytes, candidateBytes)
  );
}

function parsedMockWebhook(
  rawBody: string,
  header: string,
  configuredSigningValue?: string,
  nowMs = Date.now(),
  toleranceSeconds = MOCK_WEBHOOK_TOLERANCE_SECONDS,
): ParsedWebhook {
  const { signatures, timestamp } = parseSignature(header);
  const timestampSeconds = Number(timestamp);
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(Math.floor(nowMs / 1000) - timestampSeconds) > toleranceSeconds
  ) {
    throw new Error("mock webhook timestamp is outside the accepted window");
  }
  const signingValue =
    configuredSigningValue ||
    process.env.STRIPE_WEBHOOK_SECRET ||
    MOCK_WEBHOOK_SIGNING_VALUE;
  const expected = createHmac("sha256", signingValue)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  if (!signatures.some((signature) => safeMatch(expected, signature))) {
    throw new Error("mock webhook signature did not match");
  }

  const input = JSON.parse(rawBody) as Record<string, unknown>;
  const eventType = typeof input.type === "string" ? input.type : "mock.event";
  const isSubscriptionEvent = eventType.startsWith("customer.subscription.");

  return {
    amountRefundedCents:
      eventType === "charge.refunded" && typeof input.amount_refunded === "number"
        ? input.amount_refunded
        : undefined,
    attemptCount:
      typeof input.attempt_count === "number" ? input.attempt_count : undefined,
    cancelAtPeriodEnd:
      typeof input.cancel_at_period_end === "boolean"
        ? input.cancel_at_period_end
        : undefined,
    createdAt: new Date(Number(input.created ?? timestamp) * 1000).toISOString(),
    currentPeriodEnd: mockSeconds(input.current_period_end),
    customerRef: typeof input.customer === "string" ? input.customer : null,
    chargeRef:
      eventType === "charge.refunded" && typeof input.charge_ref === "string"
        ? input.charge_ref
        : undefined,
    currency:
      eventType === "charge.refunded" && typeof input.currency === "string"
        ? input.currency
        : undefined,
    eventId: typeof input.id === "string" ? input.id : mockRef("evt", timestamp),
    eventType,
    nextPaymentAttemptAt:
      "next_payment_attempt" in input
        ? mockSeconds(input.next_payment_attempt)
        : undefined,
    provider: "mock",
    setupIntentRef:
      typeof input.setup_intent === "string" ? input.setup_intent : null,
    // The mock signs a flat envelope rather than Stripe's `data.object` nesting,
    // so `input.id` is the event id here and the subscription reference is
    // always its own field — reading `input.id` for a subscription event the way
    // the real mapper does would hand back the event id.
    subscriptionRef: mockSubscriptionReference(input),
    subscriptionStatus:
      typeof input.status === "string" && isSubscriptionEvent
        ? input.status
        : undefined,
  };
}

export function createMockAdapter(options: {
  nowMs?: () => number;
  webhookSigningValue?: string;
  webhookToleranceSeconds?: number;
} = {}): BillingAdapter {
  const subscriptions = new Map<string, { request: Parameters<BillingAdapter["startSubscription"]>[0]; result: StartSubscriptionResult }>();

  return {
    async createSetupIntent(request) {
      return {
        clientSecret: null,
        customerRef: request.customerRef ?? mockRef("cus", request.clientId),
        setupIntentRef: mockRef("seti", request.enrollmentId),
      };
    },

    async confirmCard(request) {
      return {
        last4: request.demoCardLast4 ?? null,
        paymentMethodRef: mockRef("pm", request.setupIntentRef),
        status: "succeeded",
      };
    },

    async findSubscription(request) {
      const matches = [...subscriptions.values()].filter((entry) =>
        entry.request.enrollmentId === request.enrollmentId && entry.request.operationId === request.operationId);
      if (matches.length > 1) throw new Error("CONSUMER_SUBSCRIPTION_RECONCILIATION_AMBIGUOUS");
      return matches[0]?.result ?? null;
    },

    async startSubscription(request) {
      const existing = subscriptions.get(request.idempotencyKey);
      if (existing) return existing.result;

      const currentPeriodEnd = new Date();
      currentPeriodEnd.setUTCMonth(currentPeriodEnd.getUTCMonth() + 1);
      const result: StartSubscriptionResult = {
        amountCents: MOCK_PRICE_CENTS,
        currency: MOCK_CURRENCY,
        currentPeriodEnd: currentPeriodEnd.toISOString(),
        status: "active",
        subscriptionRef: mockRef("sub", request.idempotencyKey),
      };
      subscriptions.set(request.idempotencyKey, { request, result });
      return result;
    },

    async cancel(request) {
      return {
        cancelledAt: request.atPeriodEnd ? null : new Date().toISOString(),
        status: request.atPeriodEnd ? "active" : "cancelled",
        subscriptionRef: request.subscriptionRef,
      };
    },

    async parseWebhook(rawBody, signatureHeader) {
      if (!signatureHeader) {
        throw new Error("mock webhook signature is required");
      }
      return parsedMockWebhook(
        rawBody,
        signatureHeader,
        options.webhookSigningValue,
        options.nowMs?.(),
        options.webhookToleranceSeconds,
      );
    },
  };
}
