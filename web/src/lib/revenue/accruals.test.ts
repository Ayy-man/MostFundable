import assert from "node:assert/strict";
import test from "node:test";

import { runBillingAccrual } from "./accruals.ts";
import { createRevenueRepository, RevenueRepositoryError } from "./repository.ts";

import type {
  PostBillingAccrualInput,
  RevenueAccrualInputs,
  RevenueRepository,
} from "./types.ts";

const ORG_ID = "14140000-0000-4000-8000-000000000001";
const REFERRER_ID = "14140000-0000-4000-8000-000000000002";

function inputs(overrides: Partial<RevenueAccrualInputs> = {}): RevenueAccrualInputs {
  return {
    consumerSubscriptions: [{ provider: "mock", priceCents: 4_900 }],
    operatorOrgId: ORG_ID,
    operatorSubscription: { provider: "mock", seatQuantity: 2, status: "active" },
    orgBasePriceCents: 49_700,
    orgSeatPriceCents: 2_900,
    referral: {
      base: "platform_subscription",
      id: "14140000-0000-4000-8000-000000000003",
      months: 12,
      pct: 20,
      referredOrgId: ORG_ID,
      referrerOrgId: REFERRER_ID,
      startedAt: "2026-08-01",
    },
    refundAmountCents: 0,
    ...overrides,
  };
}

function memoryRepository(
  value: RevenueAccrualInputs,
  result = { operatorRows: 1, referralRows: 1 },
): { posts: PostBillingAccrualInput[]; reads: string[]; repository: RevenueRepository } {
  const posts: PostBillingAccrualInput[] = [];
  const reads: string[] = [];
  return {
    posts,
    reads,
    repository: {
      async listAccrualOrgIds() { return [ORG_ID]; },
      async readAccrualInputs(orgId, month) { reads.push(`${orgId}|${month}`); return value; },
      async postBillingAccrual(input) { posts.push(input); return result; },
    },
  };
}

test("unset split posts a null snapshot and amount through one read and one post", async () => {
  const fake = memoryRepository(inputs());
  assert.deepEqual(await runBillingAccrual(`org:${ORG_ID}`, "2026-08", { env: {}, repository: fake.repository }), { status: "ok", rows: 2 });
  assert.deepEqual(fake.reads, [`${ORG_ID}|2026-08-01`]);
  assert.equal(fake.posts.length, 1);
  assert.equal(fake.posts[0]?.operator.pctSnapshot, null);
  assert.equal(fake.posts[0]?.operator.amountCents, null);
  assert.equal(fake.posts[0]?.operator.incompleteCode, "monitoring_split_unset");
});

test("mock monitoring basis and platform referral calculate integer cents", async () => {
  const fake = memoryRepository(inputs());
  await runBillingAccrual(`org:${ORG_ID}`, "2026-08", {
    env: { MONITORING_SPLIT_PCT: "40" },
    repository: fake.repository,
  });
  assert.equal(fake.posts[0]?.operator.baseAmountCents, 4_900);
  assert.equal(fake.posts[0]?.operator.amountCents, 1_960);
  assert.equal(fake.posts[0]?.referrals[0]?.baseAmountCents, 55_500);
  assert.equal(fake.posts[0]?.referrals[0]?.amountCents, 11_100);
});

test("zero, partial, full and excess refunds net collected consumer revenue with a floor of zero", async () => {
  for (const [refundAmountCents, expected] of [[0, 4_900], [2_500, 2_400], [4_900, 0], [9_900, 0]] as const) {
    const fake = memoryRepository(inputs({
      refundAmountCents,
      referral: { ...inputs().referral!, base: "consumer_subscriptions" },
    }));
    await runBillingAccrual(`org:${ORG_ID}`, "2026-08", {
      env: { MONITORING_SPLIT_PCT: "40" },
      repository: fake.repository,
    });
    assert.equal(fake.posts[0]?.operator.baseAmountCents, expected);
    assert.equal(fake.posts[0]?.referrals[0]?.baseAmountCents, expected);
  }
});

test("refunds do not alter a platform-subscription referral basis", async () => {
  const fake = memoryRepository(inputs({ refundAmountCents: 4_900 }));
  await runBillingAccrual(`org:${ORG_ID}`, "2026-08", {
    env: { MONITORING_SPLIT_PCT: "40" },
    repository: fake.repository,
  });
  assert.equal(fake.posts[0]?.operator.baseAmountCents, 0);
  assert.equal(fake.posts[0]?.referrals[0]?.baseAmountCents, 55_500);
});

test("real-provider monitoring evidence stays incomplete and zero", async () => {
  const fake = memoryRepository(inputs({
    consumerSubscriptions: [{ provider: "stripe", priceCents: 9_900 }],
  }));
  await runBillingAccrual(`org:${ORG_ID}`, "2026-08", {
    env: { MONITORING_SPLIT_PCT: "20" },
    repository: fake.repository,
  });
  assert.equal(fake.posts[0]?.operator.baseAmountCents, 0);
  assert.equal(fake.posts[0]?.operator.amountCents, 0);
  assert.equal(fake.posts[0]?.operator.isComplete, false);
  assert.equal(fake.posts[0]?.operator.incompleteCode, "paid_invoice_evidence_missing");
});

test("mixed consumer providers make the whole consumer basis incomplete", async () => {
  const fake = memoryRepository(inputs({
    consumerSubscriptions: [
      { provider: "mock", priceCents: 4_900 },
      { provider: "stripe", priceCents: 4_900 },
    ],
    referral: { ...inputs().referral!, base: "consumer_subscriptions" },
  }));
  await runBillingAccrual(`org:${ORG_ID}`, "2026-08", {
    env: { MONITORING_SPLIT_PCT: "20" },
    repository: fake.repository,
  });
  assert.equal(fake.posts[0]?.referrals[0]?.amountCents, 0);
  assert.equal(fake.posts[0]?.referrals[0]?.incompleteCode, "paid_invoice_evidence_missing");
});

test("missing platform subscription persists explicit incomplete referral", async () => {
  const fake = memoryRepository(inputs({ operatorSubscription: null }));
  await runBillingAccrual(`org:${ORG_ID}`, "2026-08", {
    env: { MONITORING_SPLIT_PCT: "20" },
    repository: fake.repository,
  });
  assert.equal(fake.posts[0]?.referrals[0]?.amountCents, 0);
  assert.equal(fake.posts[0]?.referrals[0]?.incompleteCode, "platform_subscription_missing");
});

test("cycles one and twelve post while thirteen posts no referral", async () => {
  for (const [window, expected] of [["2026-08", 1], ["2027-07", 12], ["2027-08", null]] as const) {
    const fake = memoryRepository(inputs());
    await runBillingAccrual(`org:${ORG_ID}`, window, {
      env: { MONITORING_SPLIT_PCT: "20" },
      repository: fake.repository,
    });
    assert.equal(fake.posts[0]?.referrals[0]?.cycleNumber ?? null, expected);
  }
});

test("replay maps zero inserts to skipped", async () => {
  const fake = memoryRepository(inputs(), { operatorRows: 0, referralRows: 0 });
  assert.deepEqual(await runBillingAccrual(`org:${ORG_ID}`, "2026-08", {
    env: { MONITORING_SPLIT_PCT: "20" },
    repository: fake.repository,
  }), { status: "skipped" });
});

test("invalid inputs fail before repository access", async () => {
  const fake = memoryRepository(inputs());
  assert.deepEqual(await runBillingAccrual("global", "2026-08", { repository: fake.repository }), { status: "failed" });
  assert.deepEqual(await runBillingAccrual(`org:${ORG_ID}`, "2026-8", { repository: fake.repository }), { status: "failed" });
  assert.equal(fake.reads.length, 0);
});

test("repository failures expose only closed log metadata", async () => {
  const events: Record<string, unknown>[] = [];
  const repository: RevenueRepository = {
    async listAccrualOrgIds() { return []; },
    async readAccrualInputs() { throw new Error("database private detail"); },
    async postBillingAccrual() { throw new Error("unreachable"); },
  };
  assert.deepEqual(await runBillingAccrual(`org:${ORG_ID}`, "2026-08", {
    logger: (event) => events.push(event),
    now: (() => { let value = 100; return () => (value += 5); })(),
    repository,
  }), { status: "failed" });
  assert.deepEqual(Object.keys(events[0] ?? {}).sort(), ["code", "durationMs", "job", "rows", "status"]);
  assert.equal(JSON.stringify(events).includes("database private detail"), false);
});

test("repository requires an explicit nonnegative integer refund total, including compatibility zero", async () => {
  for (const [refund, accepted] of [[0, true], [undefined, false], [-1, false], [1.5, false]] as const) {
    const repository = createRevenueRepository({
      async rpc() {
        return {
          data: {
            consumer_subscriptions: [],
            operator_org_id: ORG_ID,
            operator_subscription: null,
            org_base_price_cents: 49_700,
            org_seat_price_cents: 2_900,
            referral: null,
            ...(refund === undefined ? {} : { refund_amount_cents: refund }),
          },
          error: null,
        };
      },
    });
    if (accepted) {
      assert.equal((await repository.readAccrualInputs(ORG_ID, "2026-08-01")).refundAmountCents, 0);
    } else {
      await assert.rejects(
        repository.readAccrualInputs(ORG_ID, "2026-08-01"),
        (error: unknown) => error instanceof RevenueRepositoryError && error.message === "REVENUE_INPUT_INVALID",
      );
    }
  }
});
