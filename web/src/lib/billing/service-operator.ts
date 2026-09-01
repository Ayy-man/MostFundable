import "server-only";

// service-operator.ts — where a provider event becomes a rung, and nothing else.
//
// The one rule that carries the whole double-charge boundary is in
// `handleOperatorBillingEvent`: the organization is found by looking the event's
// subscription or customer reference up in `operator_subscriptions`, and the id
// that comes back is the only one ever passed to the ladder RPC. An event that
// matches nothing returns false having called no repository function at all, so
// lane B's consumer handler runs against exactly the input it would have seen if
// this phase did not exist.
//
// Webhook payload metadata is never consulted. `ParsedWebhook` does not even
// carry a metadata field, which makes the rule structural rather than a habit,
// and `service-operator.test.ts` asserts that a payload arriving with a
// plausible org id of its own does not move that organization.
//
// The ladder itself lives in SQL (migration 071). Nothing here computes a rung;
// the TypeScript mirror in `operator-ladder.ts` exists so a reader can check the
// two against each other, not so a second writer can exist.

import { operatorPrices } from "@/lib/billing/config";
import type {
  ApplyBillingEventInput,
  OperatorBillingRepository,
  OperatorBillingState,
  OperatorBillingStateReader,
  OperatorReadClient,
  OperatorRepositoryResult,
  OperatorSubscriptionRow,
  SubscriptionIntentReviewReason,
} from "@/lib/billing/repository-operator";
import type {
  BillingOperationsAdapter,
  OperatorBillingAdapter,
  OperatorSubscriptionSnapshot,
  ParsedWebhook,
} from "@/lib/billing/types";
import { AppError } from "@/lib/enrollment/errors";

export type OperatorBillingDependencies = {
  driver: OperatorBillingAdapter;
  /** Injected so a recovery test can place an intent either side of the window. */
  now?: () => Date;
  operationsDriver?: BillingOperationsAdapter;
  repository: OperatorBillingRepository;
  stateReader: OperatorBillingStateReader;
  enqueueCardFailureEmail?: (input: Readonly<{
    orgId: string;
    eventId: string;
  }>) => Promise<unknown>;
};

/**
 * Built lazily and only when a caller supplies nothing, mirroring
 * `service-webhook.ts`. The dynamic imports keep the admin client and the
 * driver out of a module graph that a flag-off request never executes.
 */
async function dependencies(
  supplied?: OperatorBillingDependencies,
): Promise<OperatorBillingDependencies> {
  if (supplied) return supplied;

  const repositoryModule = await import("@/lib/billing/repository-operator");
  const { getOperatorBillingAdapter } = await import("@/lib/billing/index");
  const { createClient } = await import("@/lib/supabase/server");

  return {
    driver: getOperatorBillingAdapter(),
    repository: repositoryModule.operatorBillingRepository,
    stateReader: {
      async readOperatorBillingState(orgId: string) {
        const client = await createClient();
        return repositoryModule.readOperatorBillingState(
          orgId,
          client as unknown as OperatorReadClient,
        );
      },
    },
  };
}

function unwrap<T>(result: OperatorRepositoryResult<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

/**
 * Applies one provider event to one organization's rung.
 *
 * Returns true when the event belonged to an operator subscription — including
 * when the RPC refused it as a replay or as older than what is already recorded,
 * because a refused operator event is still not a consumer event. Returns false
 * only when nothing in `operator_subscriptions` matches, which is the signal the
 * webhook route uses to fall through to lane B.
 */
export async function handleOperatorBillingEvent(
  event: ParsedWebhook,
  supplied?: OperatorBillingDependencies,
): Promise<boolean> {
  const { driver, repository } = await dependencies(supplied);

  // No reference at all is not an operator event, and asking the database about
  // a pair of nulls would be a query that can only return the wrong row.
  if (!event.subscriptionRef && !event.customerRef) return false;

  const subscription = unwrap(
    await repository.readOperatorSubscriptionByRef({
      customerRef: event.customerRef,
      subscriptionRef: event.subscriptionRef,
    }),
  );

  if (!subscription) return false;

  const input: ApplyBillingEventInput = {
    attemptCount: event.attemptCount ?? null,
    currentPeriodEnd: event.currentPeriodEnd ?? null,
    eventId: event.eventId,
    eventType: event.eventType,
    nextAttemptAt: event.nextPaymentAttemptAt ?? null,
    occurredAt: event.createdAt,
    // The looked-up organization, and nothing else. This is T-10-15.
    orgId: subscription.orgId,
    source: subscription.provider,
    status: event.subscriptionStatus ?? null,
    // The stored reference, so an invoice event that named only a customer
    // still records the subscription it actually belongs to.
    subscriptionRef: subscription.subscriptionRef ?? event.subscriptionRef,
  };

  let verdict = unwrap(await repository.applyBillingEvent(input));
  if (verdict.reasonCode === "equal_timestamp") {
    if (!input.subscriptionRef) throw new Error("OPERATOR_BILLING_SNAPSHOT_UNAVAILABLE");
    const snapshot = await driver.getSubscriptionState({ subscriptionRef: input.subscriptionRef });
    if (!snapshot) throw new Error("OPERATOR_BILLING_SNAPSHOT_UNAVAILABLE");
    verdict = unwrap(await repository.applyBillingEvent({
      ...input,
      eventType: "provider.snapshot",
      status: snapshot.providerStatus,
      currentPeriodEnd: snapshot.currentPeriodEnd,
    }));
  }
  const dunningTarget = verdict.toMembership === "past_due" || verdict.toMembership === "grace";
  const replayedDunningEvent = verdict.reasonCode === "duplicate_event" && (
    event.eventType === "invoice.payment_failed"
    || (
      event.eventType.startsWith("customer.subscription.")
      && event.subscriptionStatus === "past_due"
    )
  );
  if ((verdict.applied && dunningTarget) || replayedDunningEvent) {
    const enqueue = supplied?.enqueueCardFailureEmail ?? (async (enqueueInput) => {
      const { enqueueOperatorCardFailureEmail } = await import("@/lib/email/enqueue");
      return enqueueOperatorCardFailureEmail(enqueueInput);
    });
    await enqueue({ orgId: subscription.orgId, eventId: event.eventId });
  }
  return true;
}

export type SeatSyncOutcome = {
  quantity: number | null;
  reason: "driver_rejected" | "no_subscription" | "noop" | "provider_mismatch" | "synced";
  synced: boolean;
};

/**
 * Drains one organization's pending outbox row.
 *
 * The order is deliberate and is the whole of T-10-18: the provider is asked
 * first, and the quantity is recorded only after the provider accepted it. A
 * rejection increments the attempt count and leaves the row pending, so the
 * next drain retries rather than the system believing a seat change landed that
 * never did.
 */
export async function syncOperatorSeats(
  orgId: string,
  supplied?: OperatorBillingDependencies,
): Promise<SeatSyncOutcome> {
  const { driver, repository } = await dependencies(supplied);

  const pending = unwrap(await repository.readPendingSeatSync(orgId));
  if (!pending) return { quantity: null, reason: "noop", synced: false };

  const subscription = unwrap(await repository.readOperatorSubscriptionForOrg(orgId));
  if (!subscription?.subscriptionRef || !subscription.seatItemRef) {
    return { quantity: null, reason: "no_subscription", synced: false };
  }

  let updated;
  try {
    updated = await driver.updateSeatQuantity({
      // A target generation is stable across retries of that target and is
      // replaced when a later target is observed, even when its quantity has
      // appeared before within the provider's idempotency retention window.
      idempotencyKey: `operator:${orgId}:seats:${pending.generation}`,
      quantity: pending.desiredQuantity,
      seatItemRef: subscription.seatItemRef,
      subscriptionRef: subscription.subscriptionRef,
    });
  } catch {
    // A short code, never the provider's message: the column is 64 characters
    // and nothing a third party wrote belongs in this table.
    unwrap(await repository.recordSeatSyncFailure(orgId, pending.generation, "driver_rejected"));
    return { quantity: null, reason: "driver_rejected", synced: false };
  }

  if (updated.quantity !== pending.desiredQuantity) {
    unwrap(await repository.recordSeatSyncFailure(
      orgId,
      pending.generation,
      "provider_quantity_mismatch",
    ));
    return { quantity: null, reason: "provider_mismatch", synced: false };
  }

  const completion = unwrap(await repository.setSeatQuantity(
    orgId,
    pending.desiredQuantity,
    pending.generation,
    "drain",
  ));
  if (!completion.applied) return { quantity: null, reason: "noop", synced: false };
  return { quantity: pending.desiredQuantity, reason: "synced", synced: true };
}

export type StartOperatorSubscriptionOutcome = {
  created: boolean;
  seatQuantity: number;
  status: string | null;
  subscriptionRef: string | null;
};

const subscriptionStarts = new WeakMap<
  OperatorBillingAdapter,
  Map<string, Promise<StartOperatorSubscriptionOutcome>>
>();

/**
 * Starts or re-attaches an organization's subscription.
 *
 * No price, plan or quantity is accepted from a caller. The amounts come from
 * `operatorPrices`, and the seat quantity is computed from the organization's
 * own member count against its included allowance — the same arithmetic
 * migration 072's trigger applies once a subscription exists. The trigger
 * cannot supply the first value, because it deliberately stays quiet for an
 * organization that has no subscription yet.
 */
export async function startOperatorSubscriptionForOrg(
  orgId: string,
  supplied?: OperatorBillingDependencies,
): Promise<StartOperatorSubscriptionOutcome> {
  const resolved = await dependencies(supplied);
  const { driver, repository } = resolved;

  let byOrg = subscriptionStarts.get(driver);
  if (!byOrg) {
    byOrg = new Map();
    subscriptionStarts.set(driver, byOrg);
  }
  const existingStart = byOrg.get(orgId);
  if (existingStart) return existingStart;

  const pending = startOperatorSubscriptionOnce(orgId, {
    driver, now: resolved.now, operationsDriver: resolved.operationsDriver, repository,
  });
  byOrg.set(orgId, pending);
  try {
    return await pending;
  } catch (error) {
    if (byOrg.get(orgId) === pending) byOrg.delete(orgId);
    throw error;
  }
}

/**
 * How long the provider is assumed to still honour a subscription-creation
 * idempotency key. Stripe keeps them for 24 hours; past that a retry with the
 * same key is an ordinary create, which is the moment a second subscription
 * becomes possible. Matches `PAYMENT_IDEMPOTENCY_RETENTION_MS` in
 * `pricing/paid-refresh.ts`, which reasons about the same provider window.
 */
const OPERATOR_IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1_000;

const AMBIGUOUS_MATCH = "OPERATOR_SUBSCRIPTION_RECONCILIATION_AMBIGUOUS";

/**
 * Parks an intent for a human and refuses the request.
 *
 * `failed` is deliberately not used: it drops the intent out of migration 358's
 * live-organization index, so the very next claim would open a fresh operation
 * id and create the second subscription this exists to prevent. `review` keeps
 * the organization locked, and every later claim answers `needs_review`.
 */
async function parkForReview(
  orgId: string,
  operationId: string,
  reason: SubscriptionIntentReviewReason,
  repository: Pick<OperatorBillingRepository, "reviewSubscriptionCreationIntent">,
): Promise<never> {
  unwrap(await repository.reviewSubscriptionCreationIntent(orgId, operationId, reason));
  throw new AppError("conflict", INTENT_PARKED_MESSAGE);
}

/**
 * Named so the autonomous reconciler (R5C-06) can tell "this intent reached `review`, which
 * is a terminal outcome" from "this organization failed for some other reason", without
 * matching on an inline string or re-reading the row it just parked. The copy is unchanged.
 */
const INTENT_PARKED_MESSAGE =
  "The subscription creation needs to be checked against the billing provider before it can continue.";

/**
 * Returns what the provider already created for this operation, or null when
 * dispatching again is still safe.
 *
 * Two outcomes never redispatch. More than one subscription answering to the
 * operation id means the durable identity did not hold, and picking one would
 * settle the organization against a subscription while another keeps billing.
 * No subscription at all, past the idempotency-retention window, means the key
 * no longer deduplicates and the read is the only evidence there is — if the
 * provider's index is merely lagging, a redispatch is a second subscription.
 * Both park. A read that fails for any other reason is transient and propagates
 * with the intent still pending, so the next attempt reconciles again.
 */
async function reconcileRecoveredIntent(
  orgId: string,
  operationId: string,
  createdAt: string | null,
  billingCustomerRef: string,
  dependencies: Pick<OperatorBillingDependencies, "driver" | "now" | "repository">,
): Promise<OperatorSubscriptionSnapshot | null> {
  const openedAt = createdAt ? Date.parse(createdAt) : Number.NaN;
  // An intent whose age cannot be read is treated as old. The alternative is to
  // treat it as fresh, which is the assumption that costs money.
  const pastRetention = !Number.isFinite(openedAt)
    || (dependencies.now?.() ?? new Date()).getTime() - openedAt >= OPERATOR_IDEMPOTENCY_RETENTION_MS;

  let found: OperatorSubscriptionSnapshot | null;
  try {
    found = await dependencies.driver.findOperatorSubscription({
      billingCustomerRef,
      operationId,
      orgId,
    });
  } catch (error) {
    if (error instanceof Error && error.message === AMBIGUOUS_MATCH) {
      await parkForReview(orgId, operationId, "ambiguous_provider_match", dependencies.repository);
    }
    throw error;
  }

  if (found) return found;
  if (pastRetention) {
    await parkForReview(orgId, operationId, "unreconciled_past_retention", dependencies.repository);
  }
  return null;
}

async function startOperatorSubscriptionOnce(
  orgId: string,
  dependencies: Pick<OperatorBillingDependencies, "driver" | "now" | "operationsDriver" | "repository">,
): Promise<StartOperatorSubscriptionOutcome> {
  const { driver, repository } = dependencies;

  const [profileResult, billingResult] = await Promise.all([
    repository.readOrgBillingProfile(orgId),
    repository.readOperatorSubscriptionForOrg(orgId),
  ]);
  const profile = unwrap(profileResult);
  const billing = unwrap(billingResult);
  if (!profile) {
    throw new AppError("not_found", "The organization could not be found.");
  }
  // Refused rather than substituted. A subscription created against a missing
  // or invented address is one nobody receives an invoice for, and the provider
  // would happily accept it.
  if (!profile.ownerEmail) {
    throw new AppError(
      "conflict",
      "The organization has no owner on file to bill.",
    );
  }
  if (!billing?.customerRef) {
    throw new AppError(
      "conflict",
      "The organization has no billing customer on file.",
    );
  }

  const prices = operatorPrices(process.env, {
    basePriceCents: profile.basePriceCents,
    plan: profile.plan,
    seatPriceCents: profile.seatPriceCents,
  });
  const seatQuantity = Math.max(0, profile.seatCount - (profile.seatsIncluded ?? 0));
  let intent = unwrap(await repository.claimSubscriptionCreationIntent(orgId, "direct"));
  if (!intent.claimed && intent.reasonCode === "path_conflict") {
    const [{ closeExpiredCheckoutConflict }, { getBillingOperationsAdapter }] = await Promise.all([
      import("./service-operations.ts"),
      import("./index.ts"),
    ]);
    const closed = await closeExpiredCheckoutConflict(orgId, intent, {
      driver: dependencies.operationsDriver ?? getBillingOperationsAdapter(),
      repository,
    });
    if (closed) intent = unwrap(await repository.claimSubscriptionCreationIntent(orgId, "direct"));
  }
  if (!intent.claimed || !intent.operationId) {
    throw new AppError("conflict", "Another subscription creation is already in progress.");
  }

  let snapshot;
  if (intent.status === "created") {
    if (!intent.providerRef) {
      throw new AppError("unexpected", "The subscription creation could not be recovered.");
    }
    snapshot = await driver.readOperatorSubscription({ subscriptionRef: intent.providerRef });
    if (!snapshot) {
      throw new AppError("unexpected", "The subscription creation could not be recovered.");
    }
  } else {
    // A pending intent that was already here when we claimed it is an attempt
    // that dispatched and never came back, and the provider may well have
    // created the subscription before the crash. Ask before dispatching again
    // (R4C-09) — this is the operator twin of the consumer path's
    // `findSubscription` call in `enrollment/service.ts`.
    const recovered = intent.reasonCode === "recovered"
      ? await reconcileRecoveredIntent(
        orgId, intent.operationId, intent.createdAt, billing.customerRef, dependencies,
      )
      : null;

    snapshot = recovered ?? await driver.startOperatorSubscription({
      basePriceRef: prices.basePriceRef,
      billingCustomerRef: billing.customerRef,
      operationId: intent.operationId,
      orgId,
      orgName: profile.name,
      ownerEmail: profile.ownerEmail,
      seatPriceRef: prices.seatPriceRef,
      seatQuantity,
    });
    const completed = unwrap(await repository.completeSubscriptionCreationIntent(
      orgId,
      intent.operationId,
      "direct",
      snapshot.subscriptionRef,
    ));
    if (!completed.applied) {
      throw new AppError("conflict", "The subscription creation intent changed before completion.");
    }
  }

  const verdict = unwrap(
    await repository.upsertSubscription({
      baseItemRef: snapshot.baseItemRef,
      basePriceRef: prices.basePriceRef,
      currentPeriodEnd: snapshot.currentPeriodEnd,
      customerRef: snapshot.customerRef,
      orgId,
      provider: snapshot.subscriptionRef.startsWith("mock_") ? "mock" : "stripe",
      seatItemRef: snapshot.seatItemRef,
      seatPriceRef: prices.seatPriceRef,
      status: snapshot.providerStatus,
      subscriptionRef: snapshot.subscriptionRef,
    }),
  );

  return {
    created: verdict.created,
    seatQuantity,
    status: verdict.status,
    subscriptionRef: verdict.subscriptionRef,
  };
}

/**
 * R5C-06 — the caller migration 358 assumed and never created.
 *
 * 358 made a *later* `POST /api/billing/subscription` reconcile or park an intent whose
 * process died after the provider returned, which leaves the intent `pending` forever when
 * nobody posts again: the provider bills and the intent reaches none of `created`, `failed`
 * or `review`. This is the same reconciliation driven by the tick instead of by a user.
 *
 * Two properties this function holds, and both matter more than its throughput:
 *
 *   1. It never dispatches. `reconcileRecoveredIntent` reads the provider and parks;
 *      `driver.startOperatorSubscription` is not reachable from here, so no recovery path can
 *      produce a second subscription for an organization (R4C-09's property, preserved rather
 *      than merely not re-broken).
 *   2. It only touches intents older than `STALE_INTENT_AFTER_MS`, which is far beyond any
 *      provider call, so a request still in flight owns its own intent and finishes it.
 *
 * One organization's failure is recorded and never propagated: a tick that stops at the first
 * unreachable provider leaves every later intent unreconciled.
 */
const STALE_INTENT_AFTER_MS = 15 * 60 * 1_000;

export type OperatorIntentReconciliation = {
  completed: number;
  examined: number;
  failed: number;
  parked: number;
  unresolved: number;
};

export async function reconcileStaleOperatorIntents(
  supplied?: OperatorBillingDependencies,
  options: { limit?: number } = {},
): Promise<OperatorIntentReconciliation> {
  const resolved = await dependencies(supplied);
  const { driver, repository } = resolved;
  const now = resolved.now?.() ?? new Date();
  const staleBefore = new Date(now.getTime() - STALE_INTENT_AFTER_MS).toISOString();
  const intents = unwrap(
    await repository.listStaleSubscriptionCreationIntents(staleBefore, options.limit ?? 100),
  );
  const result: OperatorIntentReconciliation = {
    completed: 0, examined: intents.length, failed: 0, parked: 0, unresolved: 0,
  };

  for (const intent of intents) {
    try {
      const [profileResult, billingResult] = await Promise.all([
        repository.readOrgBillingProfile(intent.orgId),
        repository.readOperatorSubscriptionForOrg(intent.orgId),
      ]);
      const profile = unwrap(profileResult);
      const billing = unwrap(billingResult);
      if (!profile || !billing?.customerRef) {
        // Nothing to ask the provider with. The intent stays pending and visible.
        result.unresolved += 1;
        continue;
      }

      const snapshot = await reconcileRecoveredIntent(
        intent.orgId, intent.operationId, intent.createdAt, billing.customerRef,
        { driver, now: () => now, repository },
      );
      if (!snapshot) {
        // Inside the retention window with no provider match: dispatching again is still the
        // interactive path's job, and asking again on the next tick is free.
        result.unresolved += 1;
        continue;
      }

      const completed = unwrap(await repository.completeSubscriptionCreationIntent(
        intent.orgId, intent.operationId, intent.creationPath, snapshot.subscriptionRef,
      ));
      if (!completed.applied) {
        result.failed += 1;
        continue;
      }
      const prices = operatorPrices(process.env, {
        basePriceCents: profile.basePriceCents,
        plan: profile.plan,
        seatPriceCents: profile.seatPriceCents,
      });
      unwrap(await repository.upsertSubscription({
        baseItemRef: snapshot.baseItemRef,
        basePriceRef: prices.basePriceRef,
        currentPeriodEnd: snapshot.currentPeriodEnd,
        customerRef: snapshot.customerRef,
        orgId: intent.orgId,
        provider: snapshot.subscriptionRef.startsWith("mock_") ? "mock" : "stripe",
        seatItemRef: snapshot.seatItemRef,
        seatPriceRef: prices.seatPriceRef,
        status: snapshot.providerStatus,
        subscriptionRef: snapshot.subscriptionRef,
      }));
      result.completed += 1;
    } catch (error) {
      // `parkForReview` reaches its terminal state and then throws to refuse the interactive
      // request; here the park *is* the outcome, so it is counted, not re-raised.
      if (error instanceof AppError && error.message === INTENT_PARKED_MESSAGE) result.parked += 1;
      else result.failed += 1;
    }
  }
  return result;
}

/**
 * Reads what an operator may see about its own billing.
 *
 * Routed through the state reader rather than the repository's privileged
 * functions on purpose: the read runs on the caller's session-scoped client, so
 * migration 070's scoped select policies decide the answer and asking for
 * another tenant's id returns nothing rather than that tenant's state.
 */
export async function readOperatorBillingState(
  orgId: string,
  supplied?: OperatorBillingDependencies,
): Promise<OperatorBillingState | null> {
  const { stateReader } = await dependencies(supplied);
  return unwrap(await stateReader.readOperatorBillingState(orgId));
}

export type { OperatorBillingState, OperatorSubscriptionRow };
