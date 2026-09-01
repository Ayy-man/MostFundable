// service-operator.test.ts — the double-charge boundary and the org-resolution rule.
//
// Every case here runs against injected fakes, so the suite needs no database
// and no Stripe key. Two of them are the ones that matter: an event that is not
// an operator event must write nothing and reach lane B untouched, and the org
// id handed to the ladder RPC must come from the subscription lookup even when
// the payload carries a plausible one of its own.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  handleOperatorBillingEvent,
  readOperatorBillingState,
  reconcileStaleOperatorIntents,
  startOperatorSubscriptionForOrg,
  syncOperatorSeats,
} from "@/lib/billing/service-operator";
import type {
  ApplyBillingEventInput,
  OperatorBillingRepository,
  OperatorBillingState,
  OperatorBillingStateReader,
  OperatorOrgBillingProfile,
  OperatorSeatSyncRow,
  OperatorSubscriptionRow,
  UpsertSubscriptionInput,
} from "@/lib/billing/repository-operator";
import type {
  OperatorBillingAdapter,
  OperatorSubscriptionSnapshot,
  ParsedWebhook,
  StartOperatorSubscriptionRequest,
  UpdateSeatQuantityRequest,
} from "@/lib/billing/types";
import { AppError } from "@/lib/enrollment/errors";
import { createMockBillingOperationsAdapter } from "@/lib/billing/operations-mock";

const ORG_ID = "70000000-0000-0000-0000-0000000000aa";
const OTHER_ORG_ID = "70000000-0000-0000-0000-0000000000bb";
const SUBSCRIPTION_REF = "mock_sub_service_operator";
const CUSTOMER_REF = "mock_cus_service_operator";
const SEAT_GENERATION = "70000000-0000-0000-0000-0000000000cc";

const SUBSCRIPTION: OperatorSubscriptionRow = {
  baseItemRef: "mock_si_base_service",
  cancelAtPeriodEnd: false,
  currentPeriodEnd: "2026-09-16T00:00:00.000Z",
  customerRef: CUSTOMER_REF,
  orgId: ORG_ID,
  provider: "mock",
  seatItemRef: "mock_si_seat_service",
  seatQuantity: 2,
  status: "active",
  subscriptionRef: SUBSCRIPTION_REF,
};

const PROFILE: OperatorOrgBillingProfile = {
  basePriceCents: null,
  name: "Northbridge Funding Group",
  ownerEmail: "owner@northbridge.test",
  plan: "growth",
  seatCount: 7,
  seatPriceCents: null,
  seatsIncluded: 5,
};

const STATE: OperatorBillingState = {
  cancelAtPeriodEnd: false,
  clientMeter: { cap: 12, count: 7, label: "7/12" },
  currentPeriodEnd: "2026-09-16T00:00:00.000Z",
  graceUntil: null,
  membership: "current",
  plan: "growth",
  seatQuantity: 2,
  seatSync: null,
  seatsIncluded: 5,
  status: "active",
  subscriptionRef: SUBSCRIPTION_REF,
};

type Call = { name: string; payload: unknown };

function ok<T>(value: T) {
  return { ok: true as const, value };
}

/**
 * Records every call in one ordered list, so a test can assert not only that
 * the right function ran but that nothing else did — which is the whole content
 * of the "writes nothing" claim.
 */
function fakeRepository(
  overrides: Partial<OperatorBillingRepository> = {},
): { calls: Call[]; repository: OperatorBillingRepository } {
  const calls: Call[] = [];
  const record = (name: string, payload: unknown) => calls.push({ name, payload });

  const repository: OperatorBillingRepository = {
    async applyBillingEvent(input: ApplyBillingEventInput) {
      record("applyBillingEvent", input);
      return ok({
        applied: true,
        fromMembership: "trial" as const,
        reasonCode: "applied",
        toMembership: "current" as const,
      });
    },
    async listStaleSubscriptionCreationIntents(staleBefore, limit) {
      record("listStaleSubscriptionCreationIntents", { limit, staleBefore });
      return ok([]);
    },
    async claimSubscriptionCreationIntent(orgId, creationPath) {
      record("claimSubscriptionCreationIntent", { creationPath, orgId });
      return ok({
        claimed: true,
        createdAt: new Date().toISOString(),
        operationId: "70000000-0000-0000-0000-0000000000dd",
        providerRef: null,
        reasonCode: "created",
        status: "pending",
      });
    },
    async completeSubscriptionCreationIntent(orgId, operationId, creationPath, providerRef) {
      record("completeSubscriptionCreationIntent", { creationPath, operationId, orgId, providerRef });
      return ok({ applied: true, reasonCode: "created" });
    },
    async failExpiredCheckoutIntent(orgId, operationId, providerRef) {
      record("failExpiredCheckoutIntent", { operationId, orgId, providerRef });
      return ok({ applied: true, reasonCode: "expired" });
    },
    async readOperatorSubscriptionByRef(input) {
      record("readOperatorSubscriptionByRef", input);
      return ok<OperatorSubscriptionRow | null>(SUBSCRIPTION);
    },
    async readOperatorSubscriptionForOrg(orgId) {
      record("readOperatorSubscriptionForOrg", orgId);
      return ok<OperatorSubscriptionRow | null>(SUBSCRIPTION);
    },
    async readOrgBillingProfile(orgId) {
      record("readOrgBillingProfile", orgId);
      return ok<OperatorOrgBillingProfile | null>(PROFILE);
    },
    async readPendingSeatSync(orgId) {
      record("readPendingSeatSync", orgId);
      return ok<OperatorSeatSyncRow | null>({
        attempts: 0,
        desiredQuantity: 4,
        generation: SEAT_GENERATION,
        orgId,
        status: "pending",
      });
    },
    async recordSeatSyncFailure(orgId, generation, errorCode) {
      record("recordSeatSyncFailure", { errorCode, generation, orgId });
      return ok({ applied: true, attempts: 1, reasonCode: "recorded", status: "pending" });
    },
    async reviewSubscriptionCreationIntent(orgId, operationId, reason) {
      record("reviewSubscriptionCreationIntent", { operationId, orgId, reason });
      return ok({ applied: true, reasonCode: "review" });
    },
    async setSeatQuantity(orgId, quantity, generation, source) {
      record("setSeatQuantity", { generation, orgId, quantity, source });
      return ok({
        applied: true,
        outboxStatus: "synced",
        reasonCode: "applied",
        seatQuantity: quantity,
      });
    },
    async upsertSubscription(input: UpsertSubscriptionInput) {
      record("upsertSubscription", input);
      return ok({
        applied: true,
        created: true,
        reasonCode: "applied",
        status: "active",
        subscriptionRef: input.subscriptionRef,
      });
    },
    ...overrides,
  };

  return { calls, repository };
}

function fakeDriver(
  overrides: Partial<OperatorBillingAdapter> = {},
): { calls: Call[]; driver: OperatorBillingAdapter } {
  const calls: Call[] = [];
  const record = (name: string, payload: unknown) => calls.push({ name, payload });

  const driver: OperatorBillingAdapter = {
    async getSubscriptionState(request) {
      record("getSubscriptionState", request);
      return null;
    },
    async cancelOperatorSubscription(request) {
      record("cancelOperatorSubscription", request);
      return {
        cancelledAt: null,
        status: "active" as const,
        subscriptionRef: request.subscriptionRef,
      };
    },
    async findOperatorSubscription(request) {
      record("findOperatorSubscription", request);
      return null;
    },
    async readOperatorSubscription(request) {
      record("readOperatorSubscription", request);
      return null;
    },
    async startOperatorSubscription(request: StartOperatorSubscriptionRequest) {
      record("startOperatorSubscription", request);
      return {
        baseItemRef: "mock_si_base_service",
        cancelAtPeriodEnd: false,
        currentPeriodEnd: "2026-09-16T00:00:00.000Z",
        customerRef: request.billingCustomerRef,
        providerStatus: "active",
        seatItemRef: "mock_si_seat_service",
        seatQuantity: request.seatQuantity,
        status: "active" as const,
        subscriptionRef: SUBSCRIPTION_REF,
      };
    },
    async updateSeatQuantity(request: UpdateSeatQuantityRequest) {
      record("updateSeatQuantity", request);
      return {
        quantity: request.quantity,
        seatItemRef: request.seatItemRef,
        subscriptionRef: request.subscriptionRef,
      };
    },
    ...overrides,
  };

  return { calls, driver };
}

function fakeStateReader(): { calls: Call[]; stateReader: OperatorBillingStateReader } {
  const calls: Call[] = [];
  return {
    calls,
    stateReader: {
      async readOperatorBillingState(orgId) {
        calls.push({ name: "readOperatorBillingState", payload: orgId });
        return ok<OperatorBillingState | null>(STATE);
      },
    },
  };
}

function invoiceEvent(overrides: Partial<ParsedWebhook> = {}): ParsedWebhook {
  return {
    attemptCount: 1,
    createdAt: "2026-08-16T10:00:00.000Z",
    currentPeriodEnd: null,
    customerRef: CUSTOMER_REF,
    eventId: "evt_service_operator_01",
    eventType: "invoice.paid",
    nextPaymentAttemptAt: null,
    setupIntentRef: null,
    subscriptionRef: SUBSCRIPTION_REF,
    ...overrides,
  };
}

describe("handleOperatorBillingEvent", () => {
  it("applies a matched event once, with the org id from the lookup", async () => {
    const { calls, repository } = fakeRepository();
    const { driver } = fakeDriver();

    const handled = await handleOperatorBillingEvent(invoiceEvent(), {
      driver,
      repository,
      stateReader: fakeStateReader().stateReader,
    });

    assert.equal(handled, true);
    assert.deepEqual(
      calls.map((call) => call.name),
      ["readOperatorSubscriptionByRef", "applyBillingEvent"],
    );

    const applied = calls[1]?.payload as ApplyBillingEventInput;
    assert.equal(applied.orgId, ORG_ID);
    assert.equal(applied.eventId, "evt_service_operator_01");
    assert.equal(applied.subscriptionRef, SUBSCRIPTION_REF);
    assert.equal(applied.occurredAt, "2026-08-16T10:00:00.000Z");
  });

  it("returns false and writes nothing when no operator subscription matches", async () => {
    const { calls, repository } = fakeRepository({
      async readOperatorSubscriptionByRef() {
        return ok<OperatorSubscriptionRow | null>(null);
      },
    });
    const { driver } = fakeDriver();

    const handled = await handleOperatorBillingEvent(invoiceEvent(), {
      driver,
      repository,
      stateReader: fakeStateReader().stateReader,
    });

    assert.equal(handled, false);
    assert.deepEqual(calls, [], "a consumer event must reach lane B having written nothing");
  });

  it("ignores an org id carried on the payload and uses the looked-up one", async () => {
    const { calls, repository } = fakeRepository();
    const { driver } = fakeDriver();

    // `ParsedWebhook` has no metadata field, and that is the point: even when
    // the delivered payload carries one, nothing in the service can reach it.
    const spoofed = {
      ...invoiceEvent(),
      metadata: { org_id: OTHER_ORG_ID },
    } as ParsedWebhook;

    assert.equal(
      await handleOperatorBillingEvent(spoofed, {
        driver,
        repository,
        stateReader: fakeStateReader().stateReader,
      }),
      true,
    );

    const applied = calls[1]?.payload as ApplyBillingEventInput;
    assert.equal(applied.orgId, ORG_ID);
    assert.notEqual(applied.orgId, OTHER_ORG_ID);
  });

  it("resolves by customer reference when the event carries no subscription reference", async () => {
    const { calls, repository } = fakeRepository();
    const { driver } = fakeDriver();

    await handleOperatorBillingEvent(invoiceEvent({ subscriptionRef: null }), {
      driver,
      repository,
      stateReader: fakeStateReader().stateReader,
    });

    assert.deepEqual(calls[0]?.payload, {
      customerRef: CUSTOMER_REF,
      subscriptionRef: null,
    });
    const applied = calls[1]?.payload as ApplyBillingEventInput;
    assert.equal(
      applied.subscriptionRef,
      SUBSCRIPTION_REF,
      "the stored reference is sent, not the absent one from the payload",
    );
  });

  it("does not look anything up when the event carries neither reference", async () => {
    const { calls, repository } = fakeRepository();
    const { driver } = fakeDriver();

    const handled = await handleOperatorBillingEvent(
      invoiceEvent({ customerRef: null, subscriptionRef: null }),
      { driver, repository, stateReader: fakeStateReader().stateReader },
    );

    assert.equal(handled, false);
    assert.deepEqual(calls, []);
  });

  it("surfaces a duplicate verdict without a second call", async () => {
    const { calls, repository } = fakeRepository({
      async applyBillingEvent(input) {
        calls.push({ name: "applyBillingEvent", payload: input });
        return ok({
          applied: false,
          fromMembership: "current" as const,
          reasonCode: "duplicate_event",
          toMembership: "current" as const,
        });
      },
    });
    const { driver } = fakeDriver();

    const handled = await handleOperatorBillingEvent(invoiceEvent(), {
      driver,
      repository,
      stateReader: fakeStateReader().stateReader,
    });

    assert.equal(handled, true, "a replay is still this system's event, not lane B's");
    assert.equal(
      calls.filter((call) => call.name === "applyBillingEvent").length,
      1,
      "a duplicate verdict must not be retried inside the same delivery",
    );
  });

  it("reconciles an equal-timestamp conflict from the provider snapshot", async () => {
    let applies = 0;
    const { calls, repository } = fakeRepository({
      async applyBillingEvent(input) {
        calls.push({ name: "applyBillingEvent", payload: input });
        applies += 1;
        return applies === 1
          ? ok({ applied: false, fromMembership: "past_due" as const, reasonCode: "equal_timestamp", toMembership: "past_due" as const })
          : ok({ applied: true, fromMembership: "past_due" as const, reasonCode: "applied", toMembership: "current" as const });
      },
    });
    const { calls: driverCalls, driver } = fakeDriver({
      async getSubscriptionState() {
        return {
          baseItemRef: SUBSCRIPTION.baseItemRef,
          cancelAtPeriodEnd: false,
          currentPeriodEnd: SUBSCRIPTION.currentPeriodEnd,
          customerRef: CUSTOMER_REF,
          providerStatus: "active",
          seatItemRef: SUBSCRIPTION.seatItemRef,
          seatQuantity: 2,
          status: "active",
          subscriptionRef: SUBSCRIPTION_REF,
        };
      },
    });

    assert.equal(await handleOperatorBillingEvent(invoiceEvent(), {
      driver, repository, stateReader: fakeStateReader().stateReader,
    }), true);
    assert.equal(applies, 2);
    assert.equal((calls.at(-1)?.payload as ApplyBillingEventInput).eventType, "provider.snapshot");
    assert.equal((calls.at(-1)?.payload as ApplyBillingEventInput).status, "active");
    assert.equal(driverCalls.length, 0);
  });

  it("keeps an equal-timestamp event retryable when provider lookup fails", async () => {
    const { repository } = fakeRepository({
      async applyBillingEvent() {
        return ok({ applied: false, fromMembership: "current" as const, reasonCode: "equal_timestamp", toMembership: "current" as const });
      },
    });
    const { driver } = fakeDriver({
      async getSubscriptionState() { throw new Error("provider unavailable"); },
    });
    await assert.rejects(
      handleOperatorBillingEvent(invoiceEvent(), { driver, repository, stateReader: fakeStateReader().stateReader }),
      /provider unavailable/,
    );
  });

  for (const toMembership of ["past_due", "grace"] as const) {
    it(`enqueues exactly once after an applied ${toMembership} verdict`, async () => {
      const { calls, repository } = fakeRepository({
        async applyBillingEvent(input) {
          calls.push({ name: "applyBillingEvent", payload: input });
          return ok({
            applied: true,
            fromMembership: "current" as const,
            reasonCode: "applied",
            toMembership,
          });
        },
      });
      const { driver } = fakeDriver();
      const enqueueCalls: unknown[] = [];

      const handled = await handleOperatorBillingEvent(invoiceEvent(), {
        driver,
        repository,
        stateReader: fakeStateReader().stateReader,
        async enqueueCardFailureEmail(input) {
          enqueueCalls.push(input);
          return null;
        },
      });

      assert.equal(handled, true);
      assert.deepEqual(calls.map((call) => call.name), [
        "readOperatorSubscriptionByRef",
        "applyBillingEvent",
      ]);
      assert.deepEqual(enqueueCalls, [{ orgId: ORG_ID, eventId: "evt_service_operator_01" }]);
    });
  }

  for (const testCase of [
    { label: "non-dunning duplicate", applied: false, reasonCode: "duplicate_event", toMembership: "past_due" },
    { label: "stale", applied: false, reasonCode: "stale_event", toMembership: "grace" },
    { label: "current", applied: true, reasonCode: "applied", toMembership: "current" },
    { label: "trial", applied: true, reasonCode: "applied", toMembership: "trial" },
    { label: "deactivated", applied: true, reasonCode: "applied", toMembership: "deactivated" },
  ] as const) {
    it(`does not enqueue for a ${testCase.label} verdict`, async () => {
      const { calls, repository } = fakeRepository({
        async applyBillingEvent(input) {
          calls.push({ name: "applyBillingEvent", payload: input });
          return ok({
            applied: testCase.applied,
            fromMembership: "current" as const,
            reasonCode: testCase.reasonCode,
            toMembership: testCase.toMembership,
          });
        },
      });
      const { driver } = fakeDriver();
      let enqueueCalls = 0;

      const handled = await handleOperatorBillingEvent(invoiceEvent(), {
        driver,
        repository,
        stateReader: fakeStateReader().stateReader,
        async enqueueCardFailureEmail() {
          enqueueCalls += 1;
        },
      });

      assert.equal(handled, true);
      assert.equal(enqueueCalls, 0);
      assert.equal(calls.filter((call) => call.name === "applyBillingEvent").length, 1);
    });
  }

  it("does not enqueue when no operator subscription matches", async () => {
    const { repository } = fakeRepository({
      async readOperatorSubscriptionByRef() {
        return ok<OperatorSubscriptionRow | null>(null);
      },
    });
    const { driver } = fakeDriver();
    let enqueueCalls = 0;

    assert.equal(await handleOperatorBillingEvent(invoiceEvent(), {
      driver,
      repository,
      stateReader: fakeStateReader().stateReader,
      async enqueueCardFailureEmail() {
        enqueueCalls += 1;
      },
    }), false);
    assert.equal(enqueueCalls, 0);
  });

  it("propagates an enqueue failure after the durable target verdict", async () => {
    const { calls, repository } = fakeRepository({
      async applyBillingEvent(input) {
        calls.push({ name: "applyBillingEvent", payload: input });
        return ok({
          applied: true,
          fromMembership: "current" as const,
          reasonCode: "applied",
          toMembership: "past_due" as const,
        });
      },
    });
    const { driver } = fakeDriver();

    await assert.rejects(
      handleOperatorBillingEvent(invoiceEvent(), {
        driver,
        repository,
        stateReader: fakeStateReader().stateReader,
        async enqueueCardFailureEmail() {
          throw new Error("EMAIL_ENQUEUE_WRITE_FAILED");
        },
      }),
      /EMAIL_ENQUEUE_WRITE_FAILED/,
    );
    assert.equal(calls.filter((call) => call.name === "applyBillingEvent").length, 1);
  });

  it("replay after an enqueue response failure leaves exactly one dunning notification", async () => {
    let applies = 0;
    const { repository } = fakeRepository({
      async applyBillingEvent() {
        applies += 1;
        return applies === 1
          ? ok({
              applied: true,
              fromMembership: "current" as const,
              reasonCode: "applied",
              toMembership: "past_due" as const,
            })
          : ok({
              applied: false,
              fromMembership: "past_due" as const,
              reasonCode: "duplicate_event",
              toMembership: "past_due" as const,
            });
      },
    });
    const { driver } = fakeDriver();
    const notifications = new Set<string>();
    let enqueueAttempts = 0;
    const enqueueCardFailureEmail = async (input: { orgId: string; eventId: string }) => {
      enqueueAttempts += 1;
      notifications.add(`${input.orgId}:${input.eventId}`);
      if (enqueueAttempts === 1) throw new Error("EMAIL_ENQUEUE_RESPONSE_LOST");
      return null;
    };
    const event = invoiceEvent({ eventType: "invoice.payment_failed" });

    await assert.rejects(
      handleOperatorBillingEvent(event, {
        driver,
        enqueueCardFailureEmail,
        repository,
        stateReader: fakeStateReader().stateReader,
      }),
      /EMAIL_ENQUEUE_RESPONSE_LOST/,
    );
    assert.equal(await handleOperatorBillingEvent(event, {
      driver,
      enqueueCardFailureEmail,
      repository,
      stateReader: fakeStateReader().stateReader,
    }), true);

    assert.equal(applies, 2);
    assert.equal(enqueueAttempts, 2);
    assert.equal(notifications.size, 1);
    assert.deepEqual([...notifications], [`${ORG_ID}:evt_service_operator_01`]);
  });

  it("throws the repository error rather than reporting the event handled", async () => {
    const { repository } = fakeRepository({
      async applyBillingEvent() {
        const { AppError } = await import("@/lib/enrollment/errors");
        return {
          ok: false as const,
          error: new AppError("unexpected", "The database request could not be completed."),
        };
      },
    });
    const { driver } = fakeDriver();

    await assert.rejects(
      handleOperatorBillingEvent(invoiceEvent(), {
        driver,
        repository,
        stateReader: fakeStateReader().stateReader,
      }),
      /could not be completed/,
    );
  });
});

describe("syncOperatorSeats", () => {
  it("sends the drain-side corrected target to the provider", async () => {
    const { repository } = fakeRepository({
      async readPendingSeatSync(orgId) {
        return ok({ attempts: 0, desiredQuantity: 2, generation: SEAT_GENERATION, orgId, status: "pending" });
      },
    });
    const { calls, driver } = fakeDriver();
    await syncOperatorSeats(ORG_ID, { driver, repository, stateReader: fakeStateReader().stateReader });
    assert.equal((calls[0]?.payload as { quantity: number }).quantity, 2, "the provider receives the authoritative committed seat count");
  });

  it("calls the driver once, then records the quantity once", async () => {
    const { calls, repository } = fakeRepository();
    const { calls: driverCalls, driver } = fakeDriver();

    const result = await syncOperatorSeats(ORG_ID, {
      driver,
      repository,
      stateReader: fakeStateReader().stateReader,
    });

    assert.deepEqual(result, { quantity: 4, reason: "synced", synced: true });
    assert.deepEqual(
      driverCalls.map((call) => call.name),
      ["updateSeatQuantity"],
    );
    assert.deepEqual(driverCalls[0]?.payload, {
      idempotencyKey: `operator:${ORG_ID}:seats:${SEAT_GENERATION}`,
      quantity: 4,
      seatItemRef: "mock_si_seat_service",
      subscriptionRef: SUBSCRIPTION_REF,
    });
    assert.deepEqual(calls.at(-1), {
      name: "setSeatQuantity",
      payload: { generation: SEAT_GENERATION, orgId: ORG_ID, quantity: 4, source: "drain" },
    });
  });

  it("reports a noop and touches no driver when nothing is pending", async () => {
    const { calls, repository } = fakeRepository({
      async readPendingSeatSync() {
        return ok<OperatorSeatSyncRow | null>(null);
      },
    });
    const { calls: driverCalls, driver } = fakeDriver();

    const result = await syncOperatorSeats(ORG_ID, {
      driver,
      repository,
      stateReader: fakeStateReader().stateReader,
    });

    assert.deepEqual(result, { quantity: null, reason: "noop", synced: false });
    assert.deepEqual(driverCalls, []);
    assert.equal(calls.some((call) => call.name === "setSeatQuantity"), false);
  });

  it("leaves the row pending with an attempt recorded when the driver rejects", async () => {
    const { calls, repository } = fakeRepository();
    const { driver } = fakeDriver({
      async updateSeatQuantity() {
        throw new Error("provider unavailable");
      },
    });

    const result = await syncOperatorSeats(ORG_ID, {
      driver,
      repository,
      stateReader: fakeStateReader().stateReader,
    });

    assert.deepEqual(result, { quantity: null, reason: "driver_rejected", synced: false });
    assert.deepEqual(calls.at(-1), {
      name: "recordSeatSyncFailure",
      payload: { errorCode: "driver_rejected", generation: SEAT_GENERATION, orgId: ORG_ID },
    });
    assert.equal(
      calls.some((call) => call.name === "setSeatQuantity"),
      false,
      "a rejected seat change must never be recorded as applied",
    );
  });

  it("refuses to complete when the provider returns a different quantity", async () => {
    const { calls, repository } = fakeRepository();
    const { driver } = fakeDriver({
      async updateSeatQuantity(request) {
        return { ...request, quantity: request.quantity + 1 };
      },
    });

    const result = await syncOperatorSeats(ORG_ID, {
      driver,
      repository,
      stateReader: fakeStateReader().stateReader,
    });

    assert.deepEqual(result, { quantity: null, reason: "provider_mismatch", synced: false });
    assert.deepEqual(calls.at(-1), {
      name: "recordSeatSyncFailure",
      payload: {
        errorCode: "provider_quantity_mismatch",
        generation: SEAT_GENERATION,
        orgId: ORG_ID,
      },
    });
    assert.equal(calls.some((call) => call.name === "setSeatQuantity"), false);
  });

  it("keeps provider and local quantity at two across a 2 to 3 to 2 sequence", async () => {
    const targets = [
      { desiredQuantity: 2, generation: "70000000-0000-0000-0000-000000000201" },
      { desiredQuantity: 3, generation: "70000000-0000-0000-0000-000000000202" },
      { desiredQuantity: 2, generation: "70000000-0000-0000-0000-000000000203" },
    ];
    let targetIndex = 0;
    let localQuantity = 0;
    let providerQuantity = 0;
    const providerCache = new Map<string, { quantity: number; seatItemRef: string; subscriptionRef: string }>();
    const providerKeys: string[] = [];
    const { repository } = fakeRepository({
      async readPendingSeatSync(orgId) {
        const target = targets[targetIndex];
        return ok<OperatorSeatSyncRow | null>(target ? {
          attempts: 0,
          desiredQuantity: target.desiredQuantity,
          generation: target.generation,
          orgId,
          status: "pending",
        } : null);
      },
      async setSeatQuantity(_orgId, quantity, generation) {
        assert.equal(generation, targets[targetIndex]?.generation);
        localQuantity = quantity;
        targetIndex += 1;
        return ok({
          applied: true,
          outboxStatus: "synced",
          reasonCode: "applied",
          seatQuantity: quantity,
        });
      },
    });
    const { driver } = fakeDriver({
      async updateSeatQuantity(request) {
        providerKeys.push(request.idempotencyKey);
        const cached = providerCache.get(request.idempotencyKey);
        if (cached) return cached;
        providerQuantity = request.quantity;
        const result = {
          quantity: request.quantity,
          seatItemRef: request.seatItemRef,
          subscriptionRef: request.subscriptionRef,
        };
        providerCache.set(request.idempotencyKey, result);
        return result;
      },
    });

    for (const target of targets) {
      assert.deepEqual(
        await syncOperatorSeats(ORG_ID, {
          driver,
          repository,
          stateReader: fakeStateReader().stateReader,
        }),
        { quantity: target.desiredQuantity, reason: "synced", synced: true },
      );
    }

    assert.equal(providerQuantity, 2, "the repeated target is applied as a new provider operation");
    assert.equal(localQuantity, 2);
    assert.equal(new Set(providerKeys).size, 3);
  });

  it("does not call the driver when the organization has no subscription", async () => {
    const { repository } = fakeRepository({
      async readOperatorSubscriptionForOrg() {
        return ok<OperatorSubscriptionRow | null>(null);
      },
    });
    const { calls: driverCalls, driver } = fakeDriver();

    const result = await syncOperatorSeats(ORG_ID, {
      driver,
      repository,
      stateReader: fakeStateReader().stateReader,
    });

    assert.deepEqual(result, { quantity: null, reason: "no_subscription", synced: false });
    assert.deepEqual(driverCalls, []);
  });
});

describe("startOperatorSubscriptionForOrg", () => {
  it("closes an expired hosted intent before claiming the direct path", async () => {
    let claims = 0;
    const { calls, repository } = fakeRepository({
      async claimSubscriptionCreationIntent() {
        claims += 1;
        return claims === 1
          ? ok({ claimed: false, createdAt: null, operationId: "70000000-0000-0000-0000-0000000000ce", providerRef: "cs_expired", reasonCode: "path_conflict", status: "created" })
          : ok({ claimed: true, createdAt: new Date().toISOString(), operationId: "70000000-0000-0000-0000-0000000000cf", providerRef: null, reasonCode: "created", status: "pending" });
      },
    });
    const { driver } = fakeDriver();
    const operationsDriver = createMockBillingOperationsAdapter();
    operationsDriver.readCheckoutSession = async () => ({
      customerRef: CUSTOMER_REF,
      providerRef: "cs_expired",
      status: "expired",
      subscriptionRef: null,
      url: "https://billing.mock.local/expired",
    });
    const result = await startOperatorSubscriptionForOrg(ORG_ID, {
      driver, operationsDriver, repository, stateReader: fakeStateReader().stateReader,
    });
    assert.equal(result.created, true);
    assert.equal(claims, 2);
    assert.equal(calls.some((call) => call.name === "failExpiredCheckoutIntent"), true, "verified expiry closes the hosted intent");
  });

  it("bills the overage above the included allowance and resolves prices through the config", async () => {
    const { calls, repository } = fakeRepository();
    const { calls: driverCalls, driver } = fakeDriver();

    const result = await startOperatorSubscriptionForOrg(
      ORG_ID,
      { driver, repository, stateReader: fakeStateReader().stateReader },
    );

    assert.equal(result.created, true);
    assert.equal(result.subscriptionRef, SUBSCRIPTION_REF);

    const started = driverCalls[0]?.payload as StartOperatorSubscriptionRequest;
    // Seven operator members against an allowance of five, the same arithmetic
    // migration 072's trigger applies once a subscription exists.
    assert.equal(started.seatQuantity, 2);
    assert.equal(started.orgId, ORG_ID);
    assert.equal(started.orgName, "Northbridge Funding Group");
    assert.equal(started.ownerEmail, "owner@northbridge.test");
    assert.equal(started.basePriceRef, "mock_price_operator_base");
    assert.equal(started.seatPriceRef, "mock_price_operator_seat");
    assert.equal(started.billingCustomerRef, CUSTOMER_REF);

    const upserted = calls.at(-1)?.payload as UpsertSubscriptionInput;
    assert.equal(upserted.orgId, ORG_ID);
    assert.equal(upserted.seatItemRef, "mock_si_seat_service");
  });

  it("refuses an organization with no owner on file rather than billing nobody", async () => {
    const { repository } = fakeRepository({
      async readOrgBillingProfile() {
        return ok<OperatorOrgBillingProfile | null>({ ...PROFILE, ownerEmail: null });
      },
    });
    const { calls: driverCalls, driver } = fakeDriver();

    await assert.rejects(
      startOperatorSubscriptionForOrg(
        ORG_ID,
        { driver, repository, stateReader: fakeStateReader().stateReader },
      ),
      /no owner on file/,
    );
    assert.deepEqual(driverCalls, []);
  });

  it("refuses an organization it cannot find rather than inventing a price", async () => {
    const { repository } = fakeRepository({
      async readOrgBillingProfile() {
        return ok<OperatorOrgBillingProfile | null>(null);
      },
    });
    const { calls: driverCalls, driver } = fakeDriver();

    await assert.rejects(
      startOperatorSubscriptionForOrg(
        ORG_ID,
        { driver, repository, stateReader: fakeStateReader().stateReader },
      ),
      /not_found|could not be found/i,
    );
    assert.deepEqual(driverCalls, []);
  });

  it("shares one provider call across concurrent and repeated starts", async () => {
    const { repository } = fakeRepository();
    const { calls: driverCalls, driver } = fakeDriver();
    const dependencies = { driver, repository, stateReader: fakeStateReader().stateReader };

    const [first, second] = await Promise.all([
      startOperatorSubscriptionForOrg(ORG_ID, dependencies),
      startOperatorSubscriptionForOrg(ORG_ID, dependencies),
    ]);
    const repeated = await startOperatorSubscriptionForOrg(ORG_ID, dependencies);

    assert.deepEqual(second, first);
    assert.deepEqual(repeated, first);
    assert.equal(driverCalls.filter((call) => call.name === "startOperatorSubscription").length, 1);
  });

  it("recovers a provider-created intent after persistence crashes without a second create", async () => {
    let intentStatus = "pending";
    let providerRef: string | null = null;
    let upsertCalls = 0;
    const { repository } = fakeRepository({
      async claimSubscriptionCreationIntent() {
        return ok({
          claimed: true,
          createdAt: new Date().toISOString(),
          operationId: "70000000-0000-0000-0000-0000000000ee",
          providerRef,
          reasonCode: intentStatus === "created" ? "provider_returned" : "created",
          status: intentStatus,
        });
      },
      async completeSubscriptionCreationIntent(_orgId, _operationId, _creationPath, completedProviderRef) {
        intentStatus = "created";
        providerRef = completedProviderRef;
        return ok({ applied: true, reasonCode: "created" });
      },
      async upsertSubscription(input) {
        upsertCalls += 1;
        if (upsertCalls === 1) {
          return {
            ok: false as const,
            error: new AppError("unexpected", "The database request could not be completed."),
          };
        }
        return ok({
          applied: true,
          created: true,
          reasonCode: "applied",
          status: "active",
          subscriptionRef: input.subscriptionRef,
        });
      },
    });
    let createdSnapshot: OperatorSubscriptionSnapshot | null = null;
    const { calls: driverCalls, driver } = fakeDriver({
      async startOperatorSubscription(request) {
        driverCalls.push({ name: "startOperatorSubscription", payload: request });
        const snapshot: OperatorSubscriptionSnapshot = {
          baseItemRef: SUBSCRIPTION.baseItemRef,
          cancelAtPeriodEnd: false,
          currentPeriodEnd: SUBSCRIPTION.currentPeriodEnd,
          customerRef: request.billingCustomerRef,
          providerStatus: "active",
          seatItemRef: SUBSCRIPTION.seatItemRef,
          seatQuantity: request.seatQuantity,
          status: "active",
          subscriptionRef: "mock_sub_r2c06_recovered",
        };
        createdSnapshot = snapshot;
        return snapshot;
      },
      async readOperatorSubscription(request) {
        driverCalls.push({ name: "readOperatorSubscription", payload: request });
        return createdSnapshot;
      },
    });

    await assert.rejects(
      startOperatorSubscriptionForOrg(ORG_ID, {
        driver,
        repository,
        stateReader: fakeStateReader().stateReader,
      }),
      /could not be completed/,
    );
    const recovered = await startOperatorSubscriptionForOrg(ORG_ID, {
      driver,
      repository,
      stateReader: fakeStateReader().stateReader,
    });

    assert.equal(recovered.subscriptionRef, "mock_sub_r2c06_recovered");
    assert.equal(
      driverCalls.filter((call) => call.name === "startOperatorSubscription").length,
      1,
    );
    assert.equal(driverCalls.filter((call) => call.name === "readOperatorSubscription").length, 1);
    assert.equal(upsertCalls, 2);
  });
});

// R4C-09. A pending intent that was already open when we claimed it belongs to
// an attempt that dispatched and never came back. Every case below is about the
// one question that follows: is calling the provider again safe?
describe("startOperatorSubscriptionForOrg — recovered intent reconciliation", () => {
  const OPERATION_ID = "70000000-0000-0000-0000-0000000000f1";
  const OPENED_AT = "2026-08-17T00:00:00.000Z";
  const FOUND: OperatorSubscriptionSnapshot = {
    baseItemRef: "mock_si_base_found",
    cancelAtPeriodEnd: false,
    currentPeriodEnd: "2026-09-17T00:00:00.000Z",
    customerRef: CUSTOMER_REF,
    providerStatus: "active",
    seatItemRef: "mock_si_seat_found",
    seatQuantity: 2,
    status: "active",
    subscriptionRef: "mock_sub_r4c09_found",
  };

  function recoveredRepository(overrides: Partial<OperatorBillingRepository> = {}) {
    return fakeRepository({
      async claimSubscriptionCreationIntent() {
        return ok({
          claimed: true,
          createdAt: OPENED_AT,
          operationId: OPERATION_ID,
          providerRef: null,
          reasonCode: "recovered",
          status: "pending",
        });
      },
      // The billing customer exists; the subscription the crashed attempt was
      // creating does not.
      async readOperatorSubscriptionForOrg() {
        return ok<OperatorSubscriptionRow | null>({
          ...SUBSCRIPTION, baseItemRef: null, seatItemRef: null, subscriptionRef: null,
        });
      },
      ...overrides,
    });
  }

  function at(offsetMs: number): () => Date {
    return () => new Date(Date.parse(OPENED_AT) + offsetMs);
  }

  // On `c2df7ae` this fails at
  // `assert.equal(starts.length, 0, ...)` — the service dispatched a second
  // create because it never asked the provider what the first one produced.
  it("completes from the subscription the crashed attempt already created", async () => {
    const { calls, repository } = recoveredRepository();
    const { calls: driverCalls, driver } = fakeDriver({
      async findOperatorSubscription(request) {
        driverCalls.push({ name: "findOperatorSubscription", payload: request });
        return FOUND;
      },
    });

    const result = await startOperatorSubscriptionForOrg(ORG_ID, {
      driver, now: at(60_000), repository, stateReader: fakeStateReader().stateReader,
    });

    const starts = driverCalls.filter((call) => call.name === "startOperatorSubscription");
    assert.equal(starts.length, 0, "a reconciled attempt never dispatches a second create");
    assert.deepEqual(
      driverCalls.find((call) => call.name === "findOperatorSubscription")?.payload,
      { billingCustomerRef: CUSTOMER_REF, operationId: OPERATION_ID, orgId: ORG_ID },
    );
    assert.equal(result.subscriptionRef, FOUND.subscriptionRef);
    assert.deepEqual(
      calls.find((call) => call.name === "completeSubscriptionCreationIntent")?.payload,
      { creationPath: "direct", operationId: OPERATION_ID, orgId: ORG_ID, providerRef: FOUND.subscriptionRef },
      "the intent closes against what the provider actually has",
    );
    assert.equal(calls.some((call) => call.name === "reviewSubscriptionCreationIntent"), false);
  });

  // On `c2df7ae` this fails at the `assert.rejects` call: with no lookup at all
  // there is no ambiguity to detect, so the service returned a fresh
  // subscription instead of refusing.
  it("parks the intent when more than one subscription answers to the operation", async () => {
    const { calls, repository } = recoveredRepository();
    const { calls: driverCalls, driver } = fakeDriver({
      async findOperatorSubscription() {
        throw new Error("OPERATOR_SUBSCRIPTION_RECONCILIATION_AMBIGUOUS");
      },
    });

    await assert.rejects(
      startOperatorSubscriptionForOrg(ORG_ID, {
        driver, now: at(60_000), repository, stateReader: fakeStateReader().stateReader,
      }),
      (error: unknown) => error instanceof AppError && error.code === "conflict",
    );

    assert.deepEqual(
      calls.find((call) => call.name === "reviewSubscriptionCreationIntent")?.payload,
      { operationId: OPERATION_ID, orgId: ORG_ID, reason: "ambiguous_provider_match" },
    );
    assert.equal(
      driverCalls.filter((call) => call.name === "startOperatorSubscription").length,
      0,
      "an ambiguous provider state never dispatches",
    );
  });

  // On `c2df7ae` this fails at the `assert.rejects` call for the same reason,
  // and it is the expensive one: past the retention window the idempotency key
  // no longer deduplicates, so that dispatch is a second live subscription.
  it("parks rather than reusing an idempotency key the provider has forgotten", async () => {
    const { calls, repository } = recoveredRepository();
    const { calls: driverCalls, driver } = fakeDriver({
      async findOperatorSubscription() {
        return null;
      },
    });

    await assert.rejects(
      startOperatorSubscriptionForOrg(ORG_ID, {
        driver, now: at(25 * 60 * 60 * 1_000), repository, stateReader: fakeStateReader().stateReader,
      }),
      (error: unknown) => error instanceof AppError && error.code === "conflict",
    );

    assert.deepEqual(
      calls.find((call) => call.name === "reviewSubscriptionCreationIntent")?.payload,
      { operationId: OPERATION_ID, orgId: ORG_ID, reason: "unreconciled_past_retention" },
    );
    assert.equal(
      driverCalls.filter((call) => call.name === "startOperatorSubscription").length,
      0,
      "no create is attempted on a key that has stopped deduplicating",
    );
  });

  it("still dispatches inside the window when the provider has nothing", async () => {
    const { calls, repository } = recoveredRepository();
    const { calls: driverCalls, driver } = fakeDriver({
      async findOperatorSubscription() {
        return null;
      },
    });

    const result = await startOperatorSubscriptionForOrg(ORG_ID, {
      driver, now: at(60_000), repository, stateReader: fakeStateReader().stateReader,
    });

    assert.equal(
      driverCalls.filter((call) => call.name === "startOperatorSubscription").length,
      1,
      "inside the window the key still deduplicates, so retrying is the recovery",
    );
    assert.equal(calls.some((call) => call.name === "reviewSubscriptionCreationIntent"), false);
    assert.equal(result.created, true);
  });

  it("asks nothing of the provider for an intent it opened itself", async () => {
    const { calls, repository } = fakeRepository({
      async readOperatorSubscriptionForOrg() {
        return ok<OperatorSubscriptionRow | null>({
          ...SUBSCRIPTION, baseItemRef: null, seatItemRef: null, subscriptionRef: null,
        });
      },
    });
    const { calls: driverCalls, driver } = fakeDriver();

    await startOperatorSubscriptionForOrg(ORG_ID, {
      driver, now: at(0), repository, stateReader: fakeStateReader().stateReader,
    });

    assert.equal(
      driverCalls.some((call) => call.name === "findOperatorSubscription"),
      false,
      "a first attempt has nothing to reconcile against",
    );
    assert.equal(calls.some((call) => call.name === "reviewSubscriptionCreationIntent"), false);
  });
});

// R5C-06. Migration 358 made a *later* POST reconcile a crashed intent; it never made that
// POST exist. Every case here supplies no HTTP caller at all.
describe("reconcileStaleOperatorIntents — terminality without a caller", () => {
  const OPERATION_ID = "70000000-0000-0000-0000-0000000000f2";
  const OPENED_AT = "2026-08-17T00:00:00.000Z";
  const FOUND: OperatorSubscriptionSnapshot = {
    baseItemRef: "mock_si_base_tick",
    cancelAtPeriodEnd: false,
    currentPeriodEnd: "2026-09-17T00:00:00.000Z",
    customerRef: CUSTOMER_REF,
    providerStatus: "active",
    seatItemRef: "mock_si_seat_tick",
    seatQuantity: 2,
    status: "active",
    subscriptionRef: "mock_sub_r5c06_found",
  };

  function staleRepository(overrides: Partial<OperatorBillingRepository> = {}) {
    return fakeRepository({
      async listStaleSubscriptionCreationIntents() {
        return ok([{
          createdAt: OPENED_AT,
          creationPath: "direct" as const,
          operationId: OPERATION_ID,
          orgId: ORG_ID,
        }]);
      },
      async readOperatorSubscriptionForOrg() {
        return ok<OperatorSubscriptionRow | null>({
          ...SUBSCRIPTION, baseItemRef: null, seatItemRef: null, subscriptionRef: null,
        });
      },
      ...overrides,
    });
  }

  function at(offsetMs: number): () => Date {
    return () => new Date(Date.parse(OPENED_AT) + offsetMs);
  }

  // On `d6ae268` this fails at the import: `reconcileStaleOperatorIntents` does not exist,
  // which is the finding — the intent can only ever be finished by another POST.
  it("drives a crashed intent to created on a tick, with no second HTTP caller", async () => {
    const { calls, repository } = staleRepository();
    const { calls: driverCalls, driver } = fakeDriver({
      async findOperatorSubscription(request) {
        driverCalls.push({ name: "findOperatorSubscription", payload: request });
        return FOUND;
      },
    });

    const result = await reconcileStaleOperatorIntents({
      driver, now: at(60 * 60 * 1_000), repository, stateReader: fakeStateReader().stateReader,
    });

    assert.deepEqual(result, { completed: 1, examined: 1, failed: 0, parked: 0, unresolved: 0 });
    assert.deepEqual(
      calls.find((call) => call.name === "completeSubscriptionCreationIntent")?.payload,
      { creationPath: "direct", operationId: OPERATION_ID, orgId: ORG_ID, providerRef: FOUND.subscriptionRef },
    );
    assert.equal(
      driverCalls.filter((call) => call.name === "startOperatorSubscription").length, 0,
      "R4C-09's property is preserved: no recovery path creates a second subscription",
    );
    assert.equal(calls.some((call) => call.name === "upsertSubscription"), true);
  });

  it("parks an intent the provider can no longer deduplicate, and never dispatches", async () => {
    const { calls, repository } = staleRepository();
    const { calls: driverCalls, driver } = fakeDriver({
      async findOperatorSubscription() { return null; },
    });

    const result = await reconcileStaleOperatorIntents({
      driver, now: at(25 * 60 * 60 * 1_000), repository, stateReader: fakeStateReader().stateReader,
    });

    assert.deepEqual(result, { completed: 0, examined: 1, failed: 0, parked: 1, unresolved: 0 });
    assert.deepEqual(
      calls.find((call) => call.name === "reviewSubscriptionCreationIntent")?.payload,
      { operationId: OPERATION_ID, orgId: ORG_ID, reason: "unreconciled_past_retention" },
    );
    assert.equal(driverCalls.filter((call) => call.name === "startOperatorSubscription").length, 0);
  });

  it("parks an ambiguous provider match rather than picking one", async () => {
    const { calls, repository } = staleRepository();
    const { driver } = fakeDriver({
      async findOperatorSubscription() {
        throw new Error("OPERATOR_SUBSCRIPTION_RECONCILIATION_AMBIGUOUS");
      },
    });

    const result = await reconcileStaleOperatorIntents({
      driver, now: at(60 * 60 * 1_000), repository, stateReader: fakeStateReader().stateReader,
    });

    assert.deepEqual(result, { completed: 0, examined: 1, failed: 0, parked: 1, unresolved: 0 });
    assert.deepEqual(
      calls.find((call) => call.name === "reviewSubscriptionCreationIntent")?.payload,
      { operationId: OPERATION_ID, orgId: ORG_ID, reason: "ambiguous_provider_match" },
    );
  });

  it("leaves an intent inside the retention window pending rather than guessing", async () => {
    const { calls, repository } = staleRepository();
    const { driver } = fakeDriver({ async findOperatorSubscription() { return null; } });

    const result = await reconcileStaleOperatorIntents({
      driver, now: at(60 * 60 * 1_000), repository, stateReader: fakeStateReader().stateReader,
    });

    assert.deepEqual(result, { completed: 0, examined: 1, failed: 0, parked: 0, unresolved: 1 });
    assert.equal(calls.some((call) => call.name === "reviewSubscriptionCreationIntent"), false);
    assert.equal(calls.some((call) => call.name === "completeSubscriptionCreationIntent"), false);
  });

  it("only asks about intents older than the in-flight window", async () => {
    let staleBefore = "";
    const { repository } = staleRepository({
      async listStaleSubscriptionCreationIntents(supplied) {
        staleBefore = supplied;
        return ok([]);
      },
    });
    const { driver } = fakeDriver();
    const now = new Date("2026-08-18T12:00:00.000Z");

    const result = await reconcileStaleOperatorIntents({
      driver, now: () => now, repository, stateReader: fakeStateReader().stateReader,
    });

    assert.deepEqual(result, { completed: 0, examined: 0, failed: 0, parked: 0, unresolved: 0 });
    assert.equal(
      now.getTime() - Date.parse(staleBefore), 15 * 60 * 1_000,
      "a request still in flight owns its own intent",
    );
  });

  it("records one organization's failure and keeps reconciling the rest", async () => {
    const second = "70000000-0000-0000-0000-0000000000ab";
    const { repository } = staleRepository({
      async listStaleSubscriptionCreationIntents() {
        return ok([
          { createdAt: OPENED_AT, creationPath: "direct" as const, operationId: OPERATION_ID, orgId: ORG_ID },
          { createdAt: OPENED_AT, creationPath: "direct" as const, operationId: OPERATION_ID, orgId: second },
        ]);
      },
    });
    const { driver } = fakeDriver({
      async findOperatorSubscription(request) {
        if (request.orgId === ORG_ID) throw new Error("PROVIDER_UNREACHABLE");
        return FOUND;
      },
    });

    const result = await reconcileStaleOperatorIntents({
      driver, now: at(60 * 60 * 1_000), repository, stateReader: fakeStateReader().stateReader,
    });

    assert.deepEqual(result, { completed: 1, examined: 2, failed: 1, parked: 0, unresolved: 0 });
  });
});

describe("readOperatorBillingState", () => {
  it("reads through the session-scoped reader, never the admin repository", async () => {
    const { calls, repository } = fakeRepository();
    const { driver } = fakeDriver();
    const { calls: readerCalls, stateReader } = fakeStateReader();

    const state = await readOperatorBillingState(ORG_ID, {
      driver,
      repository,
      stateReader,
    });

    assert.deepEqual(state, STATE);
    assert.deepEqual(readerCalls, [
      { name: "readOperatorBillingState", payload: ORG_ID },
    ]);
    assert.deepEqual(calls, [], "the privileged repository is not on the read path");
    assert.deepEqual(state?.clientMeter, { cap: 12, count: 7, label: "7/12" });
    assert.equal(Object.hasOwn(state ?? {}, "overage"), false);
  });
});
