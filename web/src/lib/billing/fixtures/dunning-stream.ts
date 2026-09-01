// dunning-stream.ts — the event bodies that walk the ladder without a Stripe key.
//
// Bodies only. No signature and no absolute timestamp is stored here, and that
// is a decision rather than an oversight (D-13): a committed signature would
// verify forever against a mirror that never checks freshness, so a replay
// would pass without exercising verification at all — and it would break the
// day anything enforces the provider's five-minute tolerance. `replayDunningFixture`
// signs each body against the clock at replay time instead, through the very
// HMAC path the adapter verifies with.
//
// Each entry carries a `createdOffsetSeconds` rather than a timestamp, so the
// stream's internal ordering is fixed while its absolute position on the
// calendar is decided at replay.
//
// Every reference below is a `mock_…` value. Nothing here is a real identifier
// and nothing here is a credential.

export type DunningFixtureEvent = {
  /** Offset from the replay base, in seconds. Ordering, not a calendar date. */
  createdOffsetSeconds: number;
  /** What this event is meant to prove, used in assertion messages. */
  label: string;
  /**
   * The flat envelope the mock adapter signs and parses. Invoice events carry
   * the pinned API version's `parent.subscription_details.subscription` shape
   * alongside the legacy field, so a replay exercises the branch G10-01 added.
   */
  body: Record<string, unknown>;
};

const SUBSCRIPTION_REF = "mock_sub_operator_dunning";
const CUSTOMER_REF = "mock_cus_operator_dunning";

function invoiceBody(
  id: string,
  type: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    customer: CUSTOMER_REF,
    id,
    parent: {
      subscription_details: { subscription: SUBSCRIPTION_REF },
      type: "subscription_details",
    },
    // Kept alongside the parent shape so the fallback read stays exercised.
    subscription: SUBSCRIPTION_REF,
    type,
    ...extra,
  };
}

export const DUNNING_FIXTURE_STREAM: readonly DunningFixtureEvent[] = [
  {
    body: invoiceBody("evt_mock_dunning_01", "invoice.paid", { attempt_count: 1 }),
    createdOffsetSeconds: 0,
    label: "a paid invoice puts the organization on current",
  },
  {
    body: invoiceBody("evt_mock_dunning_02", "invoice.payment_failed", {
      attempt_count: 1,
      next_payment_attempt: 172_800,
    }),
    createdOffsetSeconds: 3_600,
    label: "a failed invoice with a retry scheduled drops it to past_due",
  },
  {
    body: invoiceBody("evt_mock_dunning_03", "invoice.payment_failed", {
      attempt_count: 4,
      next_payment_attempt: null,
    }),
    createdOffsetSeconds: 7_200,
    label: "a failed invoice with no retry left opens the grace window",
  },
  {
    body: {
      cancel_at_period_end: false,
      customer: CUSTOMER_REF,
      id: "evt_mock_dunning_04",
      status: "unpaid",
      subscription: SUBSCRIPTION_REF,
      type: "customer.subscription.updated",
    },
    createdOffsetSeconds: 10_800,
    label: "an unpaid subscription deactivates it",
  },
  {
    body: invoiceBody("evt_mock_dunning_05", "invoice.paid", { attempt_count: 5 }),
    createdOffsetSeconds: 14_400,
    label: "a later paid invoice reinstates it",
  },
  {
    // Byte-for-byte the third event, including its id. The ladder function is
    // pure and recomputes the same rung; refusing the second delivery is the
    // database's job, and `operator_billing_events (org_id, event_id)` is what
    // does it.
    body: invoiceBody("evt_mock_dunning_03", "invoice.payment_failed", {
      attempt_count: 4,
      next_payment_attempt: null,
    }),
    createdOffsetSeconds: 7_200,
    label: "the grace event redelivered verbatim",
  },
  {
    // A distinct event carrying an older moment than the one just delivered,
    // which is the out-of-order case D-05 exists for. Again the pure function
    // recomputes a rung; the RPC's `occurred_at < last_event_at` check is what
    // refuses it.
    body: invoiceBody("evt_mock_dunning_06", "invoice.payment_failed", {
      attempt_count: 2,
      next_payment_attempt: 172_800,
    }),
    createdOffsetSeconds: 5_400,
    label: "an older failure delivered after a newer signal",
  },
];
