import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { describe, it } from "node:test";

import { createMockAdapter } from "@/lib/billing/mock";
import type { ParsedWebhook } from "@/lib/billing/types";
import type {
  EnrollmentState,
  EnrollmentWebhookRepository,
  RepositoryResult,
  WebhookEventStatus,
} from "@/lib/enrollment/repository";
import {
  processWebhookEvent,
  recordWebhookEvent,
} from "@/lib/enrollment/service-webhook";

const event: ParsedWebhook = {
  createdAt: "2026-08-16T00:00:00.000Z",
  customerRef: "mock_cus_lane_b",
  eventId: "mock_evt_lane_b",
  eventType: "invoice.paid",
  setupIntentRef: null,
  subscriptionRef: "mock_sub_lane_b",
};
const leaseOwner = "00000000-0000-4000-8000-000000000399";

function ok<T>(value: T): RepositoryResult<T> {
  return { ok: true, value };
}

type AttemptShape = {
  attemptSubscriptionRef: string | null;
  operationState: NonNullable<EnrollmentState["subscription"]>["operationState"];
};

function state(
  status: "authorized" | "active" = "authorized",
  // An authorized subscription that never began a durable attempt is the
  // pre-R4C-01 shape; `settled` belongs to an already-active one.
  attempt: AttemptShape = status === "active"
    ? { attemptSubscriptionRef: event.subscriptionRef, operationState: "settled" }
    : { attemptSubscriptionRef: null, operationState: "none" },
): EnrollmentState {
  return {
    attemptsUsed: 0,
    // The IDV mock grades the knowledge quiz against this client's own
    // business_name; null is the no-business-recorded arm.
    businessName: null,
    clientId: "00000000-0000-0000-0000-000000000301",
    identity: {
      email: "consumer@example.test",
      fullName: "Lane B Consumer",
      phone: "+15550102210",
    },
    maxAttempts: 2,
    memberRef: "mock_member_lane_b",
    subscription: {
      attemptSubscriptionRef: attempt.attemptSubscriptionRef,
      currency: "usd",
      customerRef: "mock_cus_lane_b",
      idempotencyKey: "enroll:lane-b:sub",
      operationId: "enroll:lane-b:sub",
      operationState: attempt.operationState,
      paymentMethodRef: "mock_pm_lane_b",
      priceCents: 4900,
      priceRef: "mock_price_monitoring",
      provider: "mock",
      setupIntentRef: "mock_seti_lane_b",
      status,
      subscriptionAttemptAt: event.createdAt,
      subscriptionRef: status === "active" ? event.subscriptionRef : null,
    },
    view: {
      attemptsRemaining: 2,
      consents: [],
      enrollmentId: "00000000-0000-0000-0000-000000000305",
      idvState: "passed",
      lockedUntil: null,
      milestones: [],
      needsOperatorAttention: null,
      parkedUntil: null,
      status: "active",
      subscription: {
        activatedAt: null,
        authorizedAt: event.createdAt,
        cancelledAt: null,
        currency: "usd",
        paymentMethodOnFile: true,
        priceCents: 4900,
        status: status === "active" ? "active" : "authorized",
      },
    },
  };
}

function repositoryHarness(enrollment: EnrollmentState | null) {
  const events = new Set<string>();
  const statuses: WebhookEventStatus[] = [];
  const applied: Array<{ eventType: string; providerStatus: string | null; source?: string }> = [];
  let settles = 0;

  const repository: EnrollmentWebhookRepository = {
    async applySubscriptionEvent(input) {
      applied.push(input);
      return ok({ applied: true, reasonCode: "applied" });
    },
    async claimWebhookEvent(input) {
      if (events.has(input.eventId)) return ok(false);
      events.add(input.eventId);
      return ok(true);
    },
    async markWebhookEvent(_eventId, _leaseOwner, status) {
      statuses.push(status);
      return ok(undefined);
    },
    async readWebhookEnrollment() {
      return ok(enrollment);
    },
    async settleSub(_enrollmentId, _actorId, subscriptionRef) {
      settles += 1;
      return ok({ reasonCode: "activated" as const, subscriptionRef, verdict: "settled" as const });
    },
  };

  return {
    applied,
    deps: {
      repository,
      subscriptionStateReader: {
        async getSubscriptionState() { return { providerStatus: "active" }; },
      },
    },
    settles: () => settles,
    statuses,
  };
}

function signedPayload() {
  const signingValue = randomBytes(32).toString("hex");
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const rawBody = JSON.stringify({
    created: Number(timestamp),
    customer: event.customerRef,
    id: event.eventId,
    subscription: event.subscriptionRef,
    type: event.eventType,
  });
  const signature = createHmac("sha256", signingValue)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return {
    adapter: createMockAdapter({ webhookSigningValue: signingValue }),
    header: `t=${timestamp},v1=${signature}`,
    rawBody,
  };
}

describe("enrollment webhook service", () => {
  it("verifies a payload signed by the mock HMAC mirror", async () => {
    const signed = signedPayload();
    const parsed = await signed.adapter.parseWebhook(signed.rawBody, signed.header);
    assert.equal(parsed.eventId, event.eventId);
  });

  it("rejects a one-byte body change after signing", async () => {
    const signed = signedPayload();
    const final = signed.rawBody.at(-2);
    const tampered = `${signed.rawBody.slice(0, -2)}${final === "x" ? "y" : "x"}}`;
    await assert.rejects(signed.adapter.parseWebhook(tampered, signed.header));
  });

  it("rejects a missing signature", async () => {
    const signed = signedPayload();
    await assert.rejects(signed.adapter.parseWebhook(signed.rawBody, null));
  });

  it("marks the first event fresh and a sequential replay not fresh", async () => {
    const harness = repositoryHarness(null);
    assert.equal(await recordWebhookEvent(event, leaseOwner, harness.deps), true);
    assert.equal(await recordWebhookEvent(event, leaseOwner, harness.deps), false);
  });

  it("admits exactly one of two concurrent deliveries", async () => {
    const harness = repositoryHarness(null);
    const results = await Promise.all([
      recordWebhookEvent(event, leaseOwner, harness.deps),
      recordWebhookEvent(event, leaseOwner, harness.deps),
    ]);
    assert.equal(results.filter(Boolean).length, 1);
  });

  it("records a missing enrollment as an ignored no-op", async () => {
    const harness = repositoryHarness(null);
    await processWebhookEvent(event, leaseOwner, harness.deps);
    assert.deepEqual(harness.statuses, ["ignored"]);
    assert.equal(harness.settles(), 0);
  });

  it("does not call settlement for an already-settled subscription", async () => {
    const harness = repositoryHarness(state("active"));
    harness.deps.repository.settleSub = async () => {
      throw new Error("settlement must not run for settled state");
    };
    await processWebhookEvent(event, leaseOwner, harness.deps);
    assert.deepEqual(harness.statuses, ["processed"]);
    assert.equal(harness.applied.length, 1);
  });

  it("settles an authorized subscription only from current active state", async () => {
    const harness = repositoryHarness(state("authorized"));
    await processWebhookEvent(event, leaseOwner, harness.deps);
    assert.equal(harness.settles(), 1);
    assert.deepEqual(harness.statuses, ["processed"]);
  });

  it("applies terminal cancellation instead of acknowledging an active consumer unchanged", async () => {
    const harness = repositoryHarness(state("active"));
    await processWebhookEvent({
      ...event,
      eventId: "mock_evt_cancelled",
      eventType: "customer.subscription.deleted",
      subscriptionStatus: "canceled",
    }, leaseOwner, harness.deps);
    assert.deepEqual(harness.applied, [{
      enrollmentId: state("active").view.enrollmentId,
      eventId: "mock_evt_cancelled",
      eventType: "customer.subscription.deleted",
      occurredAt: event.createdAt,
      providerStatus: "canceled",
    }]);
    assert.deepEqual(harness.statuses, ["processed"]);
  });

  it("persists terminal unpaid state through the consumer event RPC", async () => {
    const harness = repositoryHarness(state("active"));
    await processWebhookEvent({
      ...event,
      eventId: "mock_evt_unpaid",
      eventType: "customer.subscription.updated",
      subscriptionStatus: "unpaid",
    }, leaseOwner, harness.deps);
    assert.equal(harness.applied[0]?.providerStatus, "unpaid");
  });

  it("reconciles equal timestamps from an authoritative snapshot", async () => {
    const harness = repositoryHarness(state("active"));
    let calls = 0;
    harness.deps.repository.applySubscriptionEvent = async (input) => {
      harness.applied.push(input);
      calls += 1;
      return calls === 1
        ? ok({ applied: false, reasonCode: "equal_timestamp" })
        : ok({ applied: true, reasonCode: "applied" });
    };
    await processWebhookEvent({ ...event, eventId: "mock_evt_equal" }, leaseOwner, harness.deps);
    assert.equal(harness.applied.length, 2);
    assert.equal(harness.applied[1]?.source, "provider.snapshot");
    assert.equal(harness.applied[1]?.providerStatus, "active");
  });

  it("leaves an equal-timestamp delivery retryable when the provider snapshot fails", async () => {
    const harness = repositoryHarness(state("active"));
    harness.deps.repository.applySubscriptionEvent = async () => ok({ applied: false, reasonCode: "equal_timestamp" });
    harness.deps.subscriptionStateReader.getSubscriptionState = async () => {
      throw new Error("provider unavailable");
    };
    await assert.rejects(
      processWebhookEvent({ ...event, eventId: "mock_evt_snapshot_failure" }, leaseOwner, harness.deps),
      /provider unavailable/,
    );
    assert.deepEqual(harness.statuses, []);
  });
});
