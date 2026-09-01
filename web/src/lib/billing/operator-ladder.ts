// operator-ladder.ts — the rung mapping, as a pure function of a parsed event.
//
// PAIRED IMPLEMENTATION. The `case` inside
// `public.operator_billing_apply_event` in
// `supabase/migrations/071_operator_billing_rpcs.sql` is the same table as the
// `switch` below, and the two must be changed together. The pgTAP suite
// `supabase/tests/071_operator_billing_rpc_test.sql` and the table test beside
// this file enumerate the same rows on purpose, so a change to one that misses
// the other fails in the layer it was not made in.
//
// The database is the authority — it holds the row lock, the replay constraint
// and the ordering rule — so this module exists to make the decision readable
// and testable without a database, not to duplicate the write. Nothing here
// imports the Stripe SDK, Supabase or Next, which is what keeps it a unit under
// test rather than an integration.

import type {
  OperatorMembership,
  OperatorSubscriptionStatus,
  ParsedWebhook,
} from "./types";

/** The five rungs, in ladder order. Matches `public.org_membership`. */
export const OPERATOR_MEMBERSHIP_VALUES = [
  "trial",
  "current",
  "past_due",
  "grace",
  "deactivated",
] as const;

/**
 * The provider's eight statuses, carried verbatim. Matches
 * `public.operator_subscription_status` and the pinned SDK's
 * `Subscription.Status` union.
 */
export const OPERATOR_SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "incomplete",
  "incomplete_expired",
  "past_due",
  "canceled",
  "unpaid",
  "paused",
] as const;

export type BillingSignalKind =
  | "invoice_paid"
  | "invoice_payment_failed"
  | "subscription_created"
  | "subscription_updated"
  | "subscription_deleted"
  | "unrelated";

export type BillingSignal = {
  attemptCount: number;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  kind: BillingSignalKind;
  occurredAt: string;
  /**
   * True when the provider has scheduled no further attempt on a failed
   * invoice, which is the signal that opens the grace window. It is read off
   * the invoice rather than off a terminal subscription status because which
   * terminal status the account produces after smart retries are exhausted is
   * an account setting we cannot read (KA-B3).
   */
  retriesExhausted: boolean;
  /** The raw provider status, or null when the event carried none. */
  status: string | null;
  subscriptionRef: string | null;
};

export type LadderReasonCode = "applied" | "unknown_status";

export type LadderOutcome = {
  membership: OperatorMembership;
  reasonCode: LadderReasonCode;
};

const EVENT_KINDS: Readonly<Record<string, BillingSignalKind>> = {
  "customer.subscription.created": "subscription_created",
  "customer.subscription.deleted": "subscription_deleted",
  "customer.subscription.updated": "subscription_updated",
  "invoice.paid": "invoice_paid",
  "invoice.payment_failed": "invoice_payment_failed",
};

function isKnownStatus(value: string | null): value is OperatorSubscriptionStatus {
  return (
    value !== null &&
    (OPERATOR_SUBSCRIPTION_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Turns a routing-level `ParsedWebhook` into the handful of facts the ladder
 * actually decides on. An event type this phase does not route becomes
 * `unrelated` and is refused a rung — lane B's consumer events reach the same
 * webhook endpoint, so that classification is the thing keeping the two billing
 * systems from acting on each other's traffic.
 */
export function deriveBillingSignal(event: ParsedWebhook): BillingSignal {
  const kind = EVENT_KINDS[event.eventType] ?? "unrelated";

  return {
    attemptCount: event.attemptCount ?? 0,
    cancelAtPeriodEnd: event.cancelAtPeriodEnd ?? false,
    currentPeriodEnd: event.currentPeriodEnd ?? null,
    kind,
    occurredAt: event.createdAt,
    // Absent counts as spent, not as unknown: the provider omits the field once
    // it has no attempt left, so treating absence as "retries remain" would
    // strand an organization on past_due forever.
    retriesExhausted:
      kind === "invoice_payment_failed"
        ? (event.nextPaymentAttemptAt ?? null) === null
        : false,
    status: event.subscriptionStatus ?? null,
    subscriptionRef: event.subscriptionRef,
  };
}

function unchanged(current: OperatorMembership): LadderOutcome {
  return { membership: current, reasonCode: "unknown_status" };
}

/**
 * Total over every event kind and every status, including ones the provider has
 * not published yet. An input the table does not cover leaves the rung exactly
 * where it was and says so with `unknown_status`, rather than defaulting to a
 * rung — guessing here would deactivate a paying organization on a status
 * Stripe added after we shipped.
 */
export function nextMembership(
  current: OperatorMembership,
  signal: BillingSignal,
): LadderOutcome {
  switch (signal.kind) {
    case "invoice_paid":
      return { membership: "current", reasonCode: "applied" };

    case "invoice_payment_failed":
      return {
        membership: signal.retriesExhausted ? "grace" : "past_due",
        reasonCode: "applied",
      };

    case "subscription_deleted":
      return { membership: "deactivated", reasonCode: "applied" };

    case "subscription_created":
    case "subscription_updated": {
      if (!isKnownStatus(signal.status)) return unchanged(current);

      switch (signal.status) {
        case "active":
          return { membership: "current", reasonCode: "applied" };
        case "trialing":
          return { membership: "trial", reasonCode: "applied" };
        case "past_due":
          return { membership: "past_due", reasonCode: "applied" };
        case "unpaid":
        case "canceled":
        case "incomplete_expired":
          return { membership: "deactivated", reasonCode: "applied" };
        // A subscription that has never been paid and one the operator paused
        // are both real states with no rung of their own; the row they belong
        // on is a product decision nobody has made, so the ladder records them
        // and leaves the organization where it is.
        case "incomplete":
        case "paused":
          return unchanged(current);
        default: {
          // Adding a value to OperatorSubscriptionStatus without giving it a
          // rung fails the type check here rather than at runtime.
          const exhaustive: never = signal.status;
          return unchanged(exhaustive);
        }
      }
    }

    case "unrelated":
      return unchanged(current);

    default: {
      const exhaustive: never = signal.kind;
      throw new Error(`unhandled billing signal kind: ${String(exhaustive)}`);
    }
  }
}
