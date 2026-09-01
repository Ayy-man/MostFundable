// operator-ladder.property.test.ts — the ladder over streams nobody hand-wrote.
//
// The table test beside this one proves the mapping cell by cell. What it
// cannot prove is how the mapping behaves under the deliveries Stripe actually
// produces: the same event twice, and the same events in a different order.
// Both are documented provider behaviour (pre-flight row B5), not edge cases,
// so they are asserted over generated streams rather than over five examples
// somebody thought of.
//
// The generator is a seven-line xorshift32 written inline. No package is
// installed for this — the repo has no test-generator dependency and this file
// does not add one. Every failure prints its seed, so a red run reproduces with
// `LADDER_SEED=<printed seed> npm test`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  OPERATOR_MEMBERSHIP_VALUES,
  OPERATOR_SUBSCRIPTION_STATUSES,
  deriveBillingSignal,
  nextMembership,
} from "@/lib/billing/operator-ladder";
import type { OperatorMembership, ParsedWebhook } from "@/lib/billing/types";

const SEED = Number(process.env.LADDER_SEED ?? 20260816);
const STREAMS = 500;

const EVENT_TYPES = [
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  // Lane B's traffic reaches the same endpoint, so it belongs in the generator.
  "setup_intent.succeeded",
] as const;

const FAILURE_ONLY_EVENT_TYPES = [
  "invoice.payment_failed",
  "customer.subscription.deleted",
] as const;

const FAILURE_ONLY_STATUSES = [
  "past_due",
  "unpaid",
  "canceled",
  "incomplete_expired",
  "incomplete",
  "paused",
] as const;

/** xorshift32. Deterministic, seedable, and short enough to read. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length) % values.length] as T;
}

/**
 * Timestamps are drawn from a twelve-slot window so ties and reorderings
 * actually occur rather than being theoretically possible.
 */
function occurredAt(slot: number): string {
  return new Date(Date.UTC(2026, 7, 16, slot)).toISOString();
}

function makeEvent(
  random: () => number,
  index: number,
  eventTypes: readonly string[] = EVENT_TYPES,
  statuses: readonly string[] = OPERATOR_SUBSCRIPTION_STATUSES,
): ParsedWebhook {
  const eventType = pick(random, eventTypes);
  const retriesExhausted = random() < 0.5;

  return {
    createdAt: occurredAt(Math.floor(random() * 12)),
    customerRef: "mock_cus_property",
    eventId: `evt_property_${index}`,
    eventType,
    nextPaymentAttemptAt: retriesExhausted ? null : occurredAt(11),
    setupIntentRef: null,
    subscriptionRef: "mock_sub_property",
    subscriptionStatus: pick(random, statuses),
  };
}

function makeStream(
  random: () => number,
  eventTypes?: readonly string[],
  statuses?: readonly string[],
): ParsedWebhook[] {
  const length = 1 + Math.floor(random() * 12);
  return Array.from({ length }, (_unused, index) =>
    makeEvent(random, index, eventTypes, statuses),
  );
}

function shuffle<T>(random: () => number, values: readonly T[]): T[] {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [copy[index], copy[target]] = [copy[target] as T, copy[index] as T];
  }
  return copy;
}

/**
 * The stale rule from D-05, applied the way `operator_billing_apply_event`
 * applies it: an event strictly older than the newest one already seen is
 * refused, so the surviving outcome is the one implied by the newest event.
 */
function applyStream(
  start: OperatorMembership,
  stream: readonly ParsedWebhook[],
): { lastEventAt: string | null; membership: OperatorMembership } {
  let membership = start;
  let lastEventAt: string | null = null;

  for (const event of stream) {
    if (lastEventAt !== null && event.createdAt < lastEventAt) continue;
    const outcome = nextMembership(membership, deriveBillingSignal(event));
    membership = outcome.membership;
    lastEventAt = event.createdAt;
  }

  return { lastEventAt, membership };
}

function context(seed: number, stream: readonly ParsedWebhook[]): string {
  return `LADDER_SEED=${seed} stream=${JSON.stringify(stream)}`;
}

describe("ladder properties", () => {
  it("is idempotent: applying an event twice equals applying it once", () => {
    const random = makeRandom(SEED);

    for (let run = 0; run < STREAMS; run += 1) {
      const event = makeEvent(random, run);
      const signal = deriveBillingSignal(event);

      for (const start of OPERATOR_MEMBERSHIP_VALUES) {
        const once = nextMembership(start, signal);
        const twice = nextMembership(once.membership, signal);

        assert.equal(
          twice.membership,
          once.membership,
          `idempotence broke from ${start}: ${context(SEED, [event])}`,
        );
      }
    }
  });

  it("is order-insensitive: any permutation lands on the newest event's rung", () => {
    const random = makeRandom(SEED + 1);
    let decisive = 0;

    for (let run = 0; run < STREAMS; run += 1) {
      const stream = makeStream(random);
      const permuted = shuffle(random, stream);
      const newestAt = stream.reduce(
        (newest, event) => (event.createdAt > newest ? event.createdAt : newest),
        stream[0]?.createdAt ?? "",
      );
      const delivered = applyStream("trial", permuted);

      // Whatever order they arrive in, the event the ladder settles on is the
      // newest one — that is the whole point of comparing against last_event_at
      // rather than trusting arrival order.
      assert.equal(
        delivered.lastEventAt,
        newestAt,
        `a permutation settled on a different newest event: ${context(SEED + 1, permuted)}`,
      );

      // The stronger claim only holds when the newest timestamp belongs to one
      // event and that event maps to a rung. Two events sharing the newest
      // timestamp are a genuine tie the ladder breaks by arrival order, and an
      // unrecognized status leaves the rung where the path left it, so neither
      // case has a permutation-independent answer to assert.
      const newest = stream.filter((event) => event.createdAt === newestAt);
      const onlyEvent = newest[0];
      if (newest.length !== 1 || onlyEvent === undefined) continue;

      const outcome = nextMembership("trial", deriveBillingSignal(onlyEvent));
      if (outcome.reasonCode !== "applied") continue;

      decisive += 1;
      assert.equal(
        delivered.membership,
        outcome.membership,
        `a permutation landed off the newest event's rung: ${context(SEED + 1, permuted)}`,
      );
    }

    // A property that never reaches its interesting branch is not a test.
    assert.ok(
      decisive > STREAMS / 10,
      `only ${decisive} of ${STREAMS} streams exercised the decisive branch`,
    );
  });

  it("stays reachable: every outcome is one of the five rungs", () => {
    const random = makeRandom(SEED + 2);

    for (let run = 0; run < STREAMS; run += 1) {
      const stream = makeStream(random);
      const { membership } = applyStream(pick(random, OPERATOR_MEMBERSHIP_VALUES), stream);

      assert.ok(
        (OPERATOR_MEMBERSHIP_VALUES as readonly string[]).includes(membership),
        `a stream produced a rung outside the enum: ${context(SEED + 2, stream)}`,
      );
    }
  });

  it("never reinstates silently: a stream of failures alone never ends at current", () => {
    const random = makeRandom(SEED + 3);

    for (let run = 0; run < STREAMS; run += 1) {
      const stream = makeStream(random, FAILURE_ONLY_EVENT_TYPES, FAILURE_ONLY_STATUSES);
      const { membership } = applyStream("current", stream);

      assert.notEqual(
        membership,
        "current",
        `failures alone reinstated an organization: ${context(SEED + 3, stream)}`,
      );
    }
  });
});
