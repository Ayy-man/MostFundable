import "server-only";

import { operatorPrices } from "./config.ts";
import type {
  OperatorBillingRepository,
  OperatorRepositoryResult,
  SubscriptionCreationIntentVerdict,
} from "./repository-operator.ts";
import type { BillingOperationsAdapter, CheckoutSessionSnapshot } from "./types.ts";
import type { EnvSource } from "@/lib/env";

export class BillingOperationsError extends Error {
  readonly code: "BILLING_CUSTOMER_REQUIRED" | "BILLING_OPERATION_INVALID" | "BILLING_PROVIDER_UNAVAILABLE" | "BILLING_SUBSCRIPTION_INTENT_CONFLICT";
  readonly status: 400 | 409 | 502;

  constructor(status: 400 | 409 | 502, code: BillingOperationsError["code"], message: string) {
    super(message);
    this.name = "BillingOperationsError";
    this.status = status;
    this.code = code;
  }
}

type OperationsRepository = Pick<
  OperatorBillingRepository,
  "claimSubscriptionCreationIntent" | "completeSubscriptionCreationIntent" | "failExpiredCheckoutIntent" | "readOperatorSubscriptionForOrg" | "readOrgBillingProfile" | "upsertSubscription"
>;

export type BillingOperationsDependencies = {
  driver: BillingOperationsAdapter;
  env?: EnvSource;
  repository: OperationsRepository;
};

function unwrap<T>(result: OperatorRepositoryResult<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

async function readSession(
  providerRef: string,
  dependencies: Pick<BillingOperationsDependencies, "driver">,
): Promise<CheckoutSessionSnapshot | null> {
  try {
    return await dependencies.driver.readCheckoutSession({ providerRef });
  } catch {
    throw new BillingOperationsError(502, "BILLING_PROVIDER_UNAVAILABLE", "The hosted billing service is unavailable.");
  }
}

/**
 * Whether a retrieved session is finished with no subscription to show for it.
 *
 * Decided from `status` and `subscriptionRef` and nothing else (R4C-05). The
 * redirect URL is irrelevant to the question and is absent for precisely the
 * sessions this has to say yes about, so reading it was what turned the
 * release path into a 502.
 */
function releasable(session: CheckoutSessionSnapshot | null): boolean {
  return session !== null && session.status === "expired" && !session.subscriptionRef;
}

export async function closeExpiredCheckoutConflict(
  orgId: string,
  intent: SubscriptionCreationIntentVerdict,
  dependencies: Pick<BillingOperationsDependencies, "driver" | "repository">,
): Promise<boolean> {
  if (intent.claimed || intent.reasonCode !== "path_conflict" || intent.status !== "created"
    || !intent.operationId || !intent.providerRef) return false;
  if (!releasable(await readSession(intent.providerRef, dependencies))) return false;
  return unwrap(await dependencies.repository.failExpiredCheckoutIntent(
    orgId, intent.operationId, intent.providerRef,
  )).applied;
}

function returnUrls(requestUrl: string) {
  let source: URL;
  try {
    source = new URL(requestUrl);
  } catch {
    throw new BillingOperationsError(400, "BILLING_OPERATION_INVALID", "The billing request is invalid.");
  }
  if ((source.protocol !== "http:" && source.protocol !== "https:") || source.username || source.password) {
    throw new BillingOperationsError(400, "BILLING_OPERATION_INVALID", "The billing request is invalid.");
  }
  return {
    cancelUrl: new URL("/billing?checkout=cancelled", source.origin).toString(),
    portalReturnUrl: new URL("/billing", source.origin).toString(),
    successUrl: new URL("/billing?checkout=success", source.origin).toString(),
  };
}

async function productionDependencies(): Promise<BillingOperationsDependencies> {
  const [{ getBillingOperationsAdapter }, repository] = await Promise.all([
    import("./index.ts"),
    import("./repository-operator.ts"),
  ]);
  return { driver: getBillingOperationsAdapter(), repository: repository.operatorBillingRepository };
}

export async function createHostedCheckout(
  orgId: string,
  requestUrl: string,
  supplied?: BillingOperationsDependencies,
): Promise<{ url: string }> {
  const dependencies = supplied ?? await productionDependencies();
  const [profile, subscription] = await Promise.all([
    dependencies.repository.readOrgBillingProfile(orgId).then(unwrap),
    dependencies.repository.readOperatorSubscriptionForOrg(orgId).then(unwrap),
  ]);
  if (!profile) throw new BillingOperationsError(400, "BILLING_OPERATION_INVALID", "The billing request is invalid.");
  if (!profile.ownerEmail) throw new BillingOperationsError(409, "BILLING_CUSTOMER_REQUIRED", "The organization has no billing owner.");
  const prices = operatorPrices(dependencies.env ?? process.env, profile);
  const seatQuantity = Math.max(0, profile.seatCount - (profile.seatsIncluded ?? 0));
  const urls = returnUrls(requestUrl);
  let intent = unwrap(await dependencies.repository.claimSubscriptionCreationIntent(orgId, "checkout"));
  if (!intent.claimed && await closeExpiredCheckoutConflict(orgId, intent, dependencies)) {
    intent = unwrap(await dependencies.repository.claimSubscriptionCreationIntent(orgId, "checkout"));
  }
  if (!intent.claimed || !intent.operationId) {
    throw new BillingOperationsError(
      409,
      "BILLING_SUBSCRIPTION_INTENT_CONFLICT",
      "Another subscription creation is already in progress.",
    );
  }

  // The checkout path can also resume *its own* intent, and R4C-05's sibling
  // lives here: that session expires too, and an expired session is not
  // something to hand back as a redirect. Release the intent and claim a fresh
  // one, so the operator gets a working session instead of a dead link or a
  // permanent 502. Migration 335's CAS transition is still the only writer.
  let resuming = intent.status === "created" && intent.providerRef !== null;
  let resumed: CheckoutSessionSnapshot | null = null;
  if (resuming) {
    resumed = await readSession(intent.providerRef as string, dependencies);
    if (releasable(resumed)) {
      unwrap(await dependencies.repository.failExpiredCheckoutIntent(
        orgId, intent.operationId, intent.providerRef as string,
      ));
      intent = unwrap(await dependencies.repository.claimSubscriptionCreationIntent(orgId, "checkout"));
      if (!intent.claimed || !intent.operationId) {
        throw new BillingOperationsError(
          409,
          "BILLING_SUBSCRIPTION_INTENT_CONFLICT",
          "Another subscription creation is already in progress.",
        );
      }
      resuming = false;
      resumed = null;
    }
  }

  let hosted: { customerRef: string; providerRef: string; url: string };
  try {
    if (resuming) {
      // A session with no URL that is not releasable — a completed one, or one
      // the provider reports without a redirect — is a state this path cannot
      // turn into a redirect, and inventing one would send the operator
      // somewhere that is not their checkout.
      if (!resumed || resumed.url === null) throw new Error("BILLING_PROVIDER_RESULT_INVALID");
      hosted = { customerRef: resumed.customerRef, providerRef: resumed.providerRef, url: resumed.url };
    } else {
      hosted = await dependencies.driver.createCheckoutSession({
        basePriceRef: prices.basePriceRef,
        cancelUrl: urls.cancelUrl,
        customerRef: subscription?.customerRef ?? null,
        operationId: intent.operationId,
        orgId,
        orgName: profile.name,
        ownerEmail: profile.ownerEmail,
        seatPriceRef: prices.seatPriceRef,
        seatQuantity,
        successUrl: urls.successUrl,
      });
      const completed = unwrap(await dependencies.repository.completeSubscriptionCreationIntent(
        orgId,
        intent.operationId,
        "checkout",
        hosted.providerRef,
      ));
      if (!completed.applied) {
        throw new BillingOperationsError(
          409,
          "BILLING_SUBSCRIPTION_INTENT_CONFLICT",
          "The subscription creation intent changed before completion.",
        );
      }
    }
  } catch (error) {
    if (error instanceof BillingOperationsError) throw error;
    if (error instanceof Error && error.name === "MisconfiguredDriverError") throw error;
    throw new BillingOperationsError(502, "BILLING_PROVIDER_UNAVAILABLE", "The hosted billing service is unavailable.");
  }
  unwrap(await dependencies.repository.upsertSubscription({
    baseItemRef: subscription?.baseItemRef ?? null,
    basePriceRef: prices.basePriceRef,
    currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
    customerRef: hosted.customerRef,
    orgId,
    provider: dependencies.driver.driver,
    seatItemRef: subscription?.seatItemRef ?? null,
    seatPriceRef: prices.seatPriceRef,
    status: subscription?.status ?? "incomplete",
    subscriptionRef: subscription?.subscriptionRef ?? null,
  }));
  return { url: hosted.url };
}

export async function createHostedPortal(
  orgId: string,
  requestUrl: string,
  supplied?: BillingOperationsDependencies,
): Promise<{ url: string }> {
  const dependencies = supplied ?? await productionDependencies();
  const subscription = unwrap(await dependencies.repository.readOperatorSubscriptionForOrg(orgId));
  if (!subscription?.customerRef) {
    throw new BillingOperationsError(409, "BILLING_CUSTOMER_REQUIRED", "The organization has no billing customer.");
  }
  try {
    return await dependencies.driver.createPortalSession({
      customerRef: subscription.customerRef,
      orgId,
      returnUrl: returnUrls(requestUrl).portalReturnUrl,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "MisconfiguredDriverError") throw error;
    throw new BillingOperationsError(502, "BILLING_PROVIDER_UNAVAILABLE", "The hosted billing service is unavailable.");
  }
}
