import type { ParsedWebhook } from "@/lib/billing/types";
import type {
  EnrollmentState,
  EnrollmentWebhookRepository,
  RepositoryResult,
  WebhookEventStatus,
} from "@/lib/enrollment/repository";

export type WebhookServiceDependencies = {
  repository: EnrollmentWebhookRepository;
  subscriptionStateReader: {
    getSubscriptionState(input: { subscriptionRef: string }): Promise<{ providerStatus: string | null } | null>;
  };
};

async function dependencies(
  supplied?: WebhookServiceDependencies,
): Promise<WebhookServiceDependencies> {
  if (supplied) return supplied;
  const [{ enrollmentWebhookRepository }, { getOperatorBillingAdapter }] = await Promise.all([
    import("@/lib/enrollment/repository"),
    import("@/lib/billing"),
  ]);
  return { repository: enrollmentWebhookRepository, subscriptionStateReader: getOperatorBillingAdapter() };
}

function unwrap<T>(result: RepositoryResult<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

async function finish(
  repository: EnrollmentWebhookRepository,
  eventId: string,
  leaseOwner: string,
  status: WebhookEventStatus,
): Promise<void> {
  unwrap(await repository.markWebhookEvent(eventId, leaseOwner, status));
}

export async function recordWebhookEvent(
  event: ParsedWebhook,
  leaseOwner: string,
  supplied?: WebhookServiceDependencies,
): Promise<boolean> {
  const { repository } = await dependencies(supplied);
  return unwrap(await repository.claimWebhookEvent(event, leaseOwner));
}

/**
 * R4C-01: a first payment that completed later settles the same retained
 * attempt through the same locked gate. The reference must be the one the
 * attempt retained — the gate refuses a mismatch, and refusing here keeps a
 * foreign event on the ordinary ledger path instead of failing the delivery.
 */
function canSettle(event: ParsedWebhook, state: EnrollmentState): boolean {
  if (event.eventType !== "invoice.paid" || !event.subscriptionRef) return false;
  if (state.view.idvState !== "passed" || state.subscription?.status !== "authorized") return false;
  return state.subscription.operationState === "none"
    || state.subscription.attemptSubscriptionRef === event.subscriptionRef;
}

function providerStatus(event: ParsedWebhook): string | null {
  if (event.eventType === "customer.subscription.deleted") return "canceled";
  if (event.eventType === "invoice.payment_failed") return event.subscriptionStatus ?? "past_due";
  if (event.eventType === "invoice.paid") return "active";
  if (event.eventType.startsWith("customer.subscription.")) return event.subscriptionStatus ?? null;
  return null;
}

export async function processWebhookEvent(
  event: ParsedWebhook,
  leaseOwner: string,
  supplied?: WebhookServiceDependencies,
): Promise<void> {
  const { repository, subscriptionStateReader } = await dependencies(supplied);
  const state = unwrap(await repository.readWebhookEnrollment(event));

  if (!state) {
    await finish(repository, event.eventId, leaseOwner, "ignored");
    return;
  }

  if (canSettle(event, state)) {
    // Settlement runs before the event is marked processed, so a refusal is
    // redeliverable. A `cancel_pending` verdict granted nothing and left a
    // durable cancellation obligation, which the event ledger does not own.
    unwrap(
      await repository.settleSub(
        state.view.enrollmentId,
        null,
        event.subscriptionRef as string,
      ),
    );
    await finish(repository, event.eventId, leaseOwner, "processed");
    return;
  }

  const status = providerStatus(event);
  if (!status || !state.subscription?.subscriptionRef) {
    await finish(repository, event.eventId, leaseOwner, "ignored");
    return;
  }

  let verdict = unwrap(await repository.applySubscriptionEvent({
    enrollmentId: state.view.enrollmentId,
    eventId: event.eventId,
    eventType: event.eventType,
    occurredAt: event.createdAt,
    providerStatus: status,
  }));
  if (verdict.reasonCode === "equal_timestamp") {
    const snapshot = await subscriptionStateReader.getSubscriptionState({
      subscriptionRef: state.subscription.subscriptionRef,
    });
    if (!snapshot) throw new Error("CONSUMER_SUBSCRIPTION_SNAPSHOT_UNAVAILABLE");
    verdict = unwrap(await repository.applySubscriptionEvent({
      enrollmentId: state.view.enrollmentId,
      eventId: event.eventId,
      eventType: "provider.snapshot",
      occurredAt: event.createdAt,
      providerStatus: snapshot.providerStatus,
      source: "provider.snapshot",
    }));
  }
  await finish(repository, event.eventId, leaseOwner, "processed");
}
