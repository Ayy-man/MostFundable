import { resolveDriver, type EnvSource } from "@/lib/env";

import { createMockAdapter, hasExplicitMockWebhookSigningValue } from "./mock";
import { createMockOperatorAdapter } from "./operator-mock";
import { createMockOneOffAdapter } from "./one-off-mock";
import { readOneOffPaymentSource } from "./one-off-source";
import { createStripeOneOffAdapter } from "./one-off-stripe";
import { createStripeOperatorAdapter } from "./operator-stripe";
import { createMockBillingOperationsAdapter } from "./operations-mock.ts";
import { createStripeBillingOperationsAdapter } from "./operations-stripe.ts";
import { readStatementDescriptor } from "./statement-descriptor.ts";
import { createStripeAdapter } from "./stripe";
import type { BillingAdapter, BillingOperationsAdapter, OneOffBillingAdapter, OperatorBillingAdapter } from "./types";

let cached: BillingAdapter | null = null;
let cachedOperator: OperatorBillingAdapter | null = null;
let cachedOneOff: OneOffBillingAdapter | null = null;
let cachedOperations: BillingOperationsAdapter | null = null;

export function mockWebhookReady(env: EnvSource): boolean {
  if (resolveDriver("billing", env) !== "mock") return true;
  return hasExplicitMockWebhookSigningValue(env.STRIPE_WEBHOOK_SECRET);
}

/**
 * Whether the selected driver can verify an inbound event at all.
 *
 * R4C-03 hardening. `mockWebhookReady` answers "is the mock signer
 * configured", which is what its name says and what its callers want, so the
 * route needed a predicate that also covers the real arm: `stripe.ts` throws
 * for a missing `STRIPE_WEBHOOK_SECRET` and the route turns that into a 400,
 * blaming Stripe for our own configuration gap. A 503 says the truth and lets
 * the provider redeliver once the secret lands.
 *
 * `resolveDriver` is the gate that should already have refused this
 * configuration at preflight; this is the second line, for a process that was
 * started before the requirement existed or whose environment changed under it.
 */
export function webhookVerificationReady(env: EnvSource): boolean {
  let driver: string;
  try {
    driver = resolveDriver("billing", env);
  } catch {
    // A selector this process cannot honour is a configuration nothing can
    // verify an event against, and the route's job here is to answer rather
    // than to throw its way into a 500.
    return false;
  }
  if (driver === "mock") {
    return hasExplicitMockWebhookSigningValue(env.STRIPE_WEBHOOK_SECRET);
  }
  return (env.STRIPE_WEBHOOK_SECRET ?? "").trim() !== "";
}

/** Resolved once per process on first use, never while a route module imports. */
export function getBillingAdapter(): BillingAdapter {
  if (cached) return cached;

  const driver = resolveDriver("billing");
  cached =
    driver === "stripe"
      ? createStripeAdapter(process.env.STRIPE_SECRET_KEY as string)
      : createMockAdapter();
  return cached;
}

/**
 * The operator half of the port, resolved through the same
 * `resolveDriver("billing")` selector so one environment cannot put consumer
 * billing on Stripe and operator billing on the mock. Cached on first call and
 * never at module load, which is what keeps an empty-environment build valid.
 */
export function getOperatorBillingAdapter(): OperatorBillingAdapter {
  if (cachedOperator) return cachedOperator;

  const driver = resolveDriver("billing");
  cachedOperator =
    driver === "stripe"
      ? createStripeOperatorAdapter(
          process.env.STRIPE_SECRET_KEY as string,
          readStatementDescriptor(process.env),
        )
      : createMockOperatorAdapter();
  return cachedOperator;
}

export function resolveBillingOperationsAdapter(
  env: EnvSource,
  stripeFactory: (secretKey: string, descriptor: string | null) => BillingOperationsAdapter = createStripeBillingOperationsAdapter,
): BillingOperationsAdapter {
  const driver = resolveDriver("billing", env);
  return driver === "stripe"
    ? stripeFactory(env.STRIPE_SECRET_KEY as string, readStatementDescriptor(env))
    : createMockBillingOperationsAdapter();
}

export function getBillingOperationsAdapter(): BillingOperationsAdapter {
  if (!cachedOperations) cachedOperations = resolveBillingOperationsAdapter(process.env);
  return cachedOperations;
}

export function resolveOneOffBillingAdapter(
  env: EnvSource,
  stripeFactory: (secretKey: string) => OneOffBillingAdapter = createStripeOneOffAdapter,
): OneOffBillingAdapter {
  const driver = resolveDriver("billing", env);
  return driver === "stripe"
    ? stripeFactory(env.STRIPE_SECRET_KEY as string)
    : createMockOneOffAdapter();
}

export function getOneOffBillingAdapter(): OneOffBillingAdapter {
  if (!cachedOneOff) cachedOneOff = resolveOneOffBillingAdapter(process.env);
  return cachedOneOff;
}

export { readOneOffPaymentSource };
export { BillingOperationsError, createHostedCheckout, createHostedPortal } from "./service-operations.ts";
export { readStatementDescriptor } from "./statement-descriptor.ts";
export type {
  BillingDriver,
  BillingOperationsAdapter,
  CheckoutSessionInput,
  CheckoutSessionResult,
  OneOffBillingAdapter,
  OneOffPaymentOutcome,
  OneOffPaymentRequest,
  OneOffPaymentResult,
  OneOffPaymentSource,
  PortalSessionInput,
} from "./types.ts";
export { assertClientCap, ClientCapError, raiseClientCap, readClientCap } from "./client-cap.ts";
export type { ClientCapMeter, RaiseClientCapInput } from "./client-cap.ts";
