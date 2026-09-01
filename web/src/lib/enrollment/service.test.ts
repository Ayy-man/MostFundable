import assert from "node:assert/strict";
import { test } from "node:test";

import type { SessionProfile } from "@/lib/auth/session";
import type { BillingAdapter, StartSubscriptionResult } from "@/lib/billing/types";
import type {
  EnrollmentRepository,
  EnrollmentState,
  RepositoryResult,
} from "@/lib/enrollment/repository";
import { AppError } from "@/lib/enrollment/errors";
import {
  cancelEnrollment,
  reconcile,
  recordMilestone,
  reauthorizeConsent,
  revokeConsent,
  startEnrollment,
  submitIdv,
  type EnrollmentServiceDependencies,
} from "@/lib/enrollment/service";
import type { EnrollmentView } from "@/lib/enrollment/types";
import type { IdvAdapter, IdvResult } from "@/lib/idv/types";
import { CrsDriverError } from "@/lib/crs/errors";
import {
  CRS_SPEC_ERROR_CODES,
  CRS_SPEC_IDV_SUBMISSION_KIND,
  CRS_SPEC_HOSTS,
  CRS_SPEC_SMFA_CHALLENGE_KIND,
  CRS_SPEC_TRANSIENT_IDENTITY_KEYS,
} from "@/lib/crs/spec-catalog";
import type { CrsAdapter, CrsIdvContinuation, CrsMemberRef } from "@/lib/crs/types";
import { createCrsIdvAdapter } from "@/lib/idv/crs";

const NOW = new Date("2026-08-16T00:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const actor: SessionProfile = {
  disabledAt: null,
  id: "00000000-0000-0000-0000-000000000302",
  manages: [],
  orgId: "00000000-0000-0000-0000-000000000300",
  orgMembership: null,
  orgRole: null,
  role: "consumer",
};

function ok<T>(value: T): RepositoryResult<T> {
  return { ok: true, value };
}

function baseState(overrides: Partial<EnrollmentState> = {}): EnrollmentState {
  const view: EnrollmentView = {
    attemptsRemaining: 2,
    consents: [
      { authorized: true, kind: "monitoring", signedAt: NOW.toISOString(), textVersion: "monitoring-2026-08-16.1" },
      { authorized: true, kind: "analysis", signedAt: NOW.toISOString(), textVersion: "analysis-2026-08-16.1" },
    ],
    enrollmentId: "00000000-0000-0000-0000-000000000305",
    idvState: "sms_sent",
    lockedUntil: null,
    milestones: [{ by: actor.id, completedAt: NOW.toISOString(), kind: "agreement_signed" }],
    needsOperatorAttention: null,
    parkedUntil: null,
    status: "enrolled",
    subscription: null,
  };

  return {
    attemptsUsed: 0,
    // The IDV mock grades the knowledge quiz against this client's own
    // business_name; null is the no-business-recorded arm.
    businessName: null,
    clientId: "00000000-0000-0000-0000-000000000301",
    identity: { email: "consumer@example.test", fullName: "Lane B Consumer", phone: "+15550102210" },
    maxAttempts: 2,
    memberRef: "mock_member_lane_b",
    subscription: {
      attemptSubscriptionRef: null,
      currency: "usd",
      customerRef: "mock_cus_lane_b",
      idempotencyKey: "enroll:lane-b:seti",
      operationId: null,
      operationState: "none",
      paymentMethodRef: "mock_pm_lane_b",
      priceCents: 4900,
      priceRef: "mock_price_monitoring",
      provider: "mock",
      setupIntentRef: "mock_seti_lane_b",
      status: "authorized",
      subscriptionAttemptAt: new Date(NOW.getTime() - HOUR_MS).toISOString(),
      subscriptionRef: null,
    },
    view,
    ...overrides,
  };
}

function harness(options: {
  cancelFailsOnce?: boolean;
  idvResults?: IdvResult[];
  mustNotCharge?: boolean;
  /** R4C-08/R4D-02: revoke inside the interval the caller's snapshot spans. */
  revokeDuringAttempt?: "analysis" | "monitoring";
  revokeDuringSetup?: "analysis" | "monitoring";
  reconciledSubscription?: StartSubscriptionResult | null;
  recordProviderFailsOnce?: boolean;
  resumeFailsOnce?: boolean;
  state?: EnrollmentState;
  subscriptionResult?: StartSubscriptionResult;
} = {}) {
  let state = options.state ?? baseState();
  const results = [...(options.idvResults ?? [])];
  const order: string[] = [];
  let cancelFails = options.cancelFailsOnce ?? false;
  let recordProviderFails = options.recordProviderFailsOnce ?? false;
  let resumeFails = options.resumeFailsOnce ?? false;
  const reauthorizationDrafts = new Set<string>();
  const calls = {
    beginSubscriptionAttempt: 0,
    affiliateReferralSlug: undefined as string | undefined,
    begin: 0,
    beginInput: null as unknown,
    cancel: 0,
    cancelProvider: 0,
    completeProviderCancel: 0,
    idvSettled: 0,
    idvClose: 0,
    idvPause: 0,
    idvResume: 0,
    idvStartRequest: null as unknown,
    milestones: 0,
    recordSetup: 0,
    recordSubscriptionProviderReturned: 0,
    reauthorizationInput: null as unknown,
    reauthorizations: 0,
    findSubscription: 0,
    resolveClient: 0,
    revocations: 0,
    reviewSub: 0,
    settleSub: 0,
    startSubscription: 0,
    tracker: 0,
  };

  /** Mirrors migration 354's intent columns, including its idempotency. */
  let providerCancelIntent: { completed: boolean; ref: string } | null = null;
  function requireProviderCancel(ref: string): void {
    providerCancelIntent ??= { completed: false, ref };
  }
  function revoke(kind: "analysis" | "monitoring"): void {
    state = {
      ...state,
      view: {
        ...state.view,
        consents: state.view.consents.map((consent) =>
          consent.kind === kind ? { ...consent, authorized: false } : consent),
      },
    };
  }
  function consentsCurrentlyGranted(): boolean {
    return (["monitoring", "analysis"] as const).every((kind) =>
      state.view.consents.some((consent) => consent.kind === kind && consent.authorized));
  }

  const repository: EnrollmentRepository = {
    // Mirrors migration 356: the dispatch claim carries the settlement authority.
    async beginSubscriptionAttempt(_enrollmentId, operationId) {
      calls.beginSubscriptionAttempt += 1;
      if ((state.subscription?.operationState ?? "none") === "none") {
        if (state.view.idvState !== "passed") {
          return { ok: false, error: new AppError("settlement_blocked", "ENROLLMENT_IDV_NOT_PASSED") };
        }
        if (!consentsCurrentlyGranted()) {
          return { ok: false, error: new AppError("settlement_blocked", "ENROLLMENT_SUBSCRIPTION_CONSENT_WITHDRAWN") };
        }
      }
      if (state.subscription) {
        state = { ...state, subscription: { ...state.subscription, operationId, operationState: "dispatching" } };
      }
      if (options.revokeDuringAttempt) revoke(options.revokeDuringAttempt);
      return ok({ amountCents: null, currency: null, operationId, state: "dispatching", status: null, subscriptionRef: null });
    },
    async beginEnrollment(input) {
      calls.begin += 1;
      calls.beginInput = input;
      calls.affiliateReferralSlug = input.affiliateReferralSlug;
      return ok({ enrollmentId: state.view.enrollmentId, esignatureId: "esignature" });
    },
    async cancelSub() {
      calls.cancel += 1;
      order.push("stop_intent");
      const ref = state.subscription?.subscriptionRef ?? state.subscription?.attemptSubscriptionRef ?? null;
      if (ref) requireProviderCancel(ref);
      state = { ...state, view: { ...state.view, status: "cancelled" } };
      return ok({ providerCancelRef: ref });
    },
    async completeProviderCancel(_enrollmentId, subscriptionRef) {
      calls.completeProviderCancel += 1;
      order.push("provider_cancel_completed");
      if (!providerCancelIntent || providerCancelIntent.ref !== subscriptionRef) {
        return { ok: false, error: new AppError("conflict", "no matching intent") };
      }
      providerCancelIntent = { ...providerCancelIntent, completed: true };
      return ok(undefined);
    },
    async idvSettled(input) {
      calls.idvSettled += 1;
      const spent = input.nextState === "retry" || input.nextState === "locked" ? 1 : 0;
      const attemptsUsed = state.attemptsUsed + spent;
      const status = input.nextState === "locked" ? "parked" : state.view.status;
      state = {
        ...state,
        attemptsUsed,
        view: {
          ...state.view,
          attemptsRemaining: Math.max(0, state.maxAttempts - attemptsUsed),
          idvState: input.nextState,
          lockedUntil: input.lockedUntil,
          parkedUntil: input.parkedUntil,
          status,
        },
      };
      return ok(undefined);
    },
    async idvStarted(input) {
      state = {
        ...state,
        idvContinuation: input.continuation ?? null,
        memberRef: input.memberRef,
        view: { ...state.view, idvState: "sms_sent" },
      };
      return ok(undefined);
    },
    async readEnrollmentState() {
      return ok(state);
    },
    async reauthorizeConsent(input) {
      calls.reauthorizations += 1;
      calls.reauthorizationInput = input;
      const replayed = reauthorizationDrafts.has(input.draftId);
      if (!replayed) {
        const consent = state.view.consents.find((item) => item.kind === input.kind);
        if (consent?.authorized) {
          return { ok: false, error: new AppError("conflict", "already authorized") };
        }
        reauthorizationDrafts.add(input.draftId);
        state = {
          ...state,
          view: {
            ...state.view,
            consents: state.view.consents.map((item) => item.kind === input.kind
              ? { ...item, authorized: true, signedAt: NOW.toISOString(), textVersion: input.textVersion }
              : item),
          },
        };
      }
      return ok({ consentId: `consent-${input.kind}`, replayed, signedAt: NOW.toISOString() });
    },
    async recordMilestone(_clientId, kind) {
      if (!state.view.milestones.some((milestone) => milestone.kind === kind)) {
        calls.milestones += 1;
        state = {
          ...state,
          view: {
            ...state.view,
            milestones: [...state.view.milestones, { by: actor.id, completedAt: NOW.toISOString(), kind }],
          },
        };
      }
      return ok(undefined);
    },
    async recordSetup(input) {
      calls.recordSetup += 1;
      state = {
        ...state,
        subscription: state.subscription
          ? { ...state.subscription, idempotencyKey: input.idempotencyKey, subscriptionAttemptAt: NOW.toISOString() }
          : {
              attemptSubscriptionRef: null,
              currency: "usd",
              customerRef: input.customerRef,
              idempotencyKey: input.idempotencyKey,
              operationId: null,
              operationState: "none",
              paymentMethodRef: input.paymentMethodRef,
              priceCents: input.priceCents,
              priceRef: input.priceRef,
              provider: input.provider,
              setupIntentRef: input.setupIntentRef,
              status: "authorized",
              subscriptionAttemptAt: NOW.toISOString(),
              subscriptionRef: null,
            },
      };
      if (options.revokeDuringSetup) revoke(options.revokeDuringSetup);
      return ok(undefined);
    },
    async recordSubscriptionProviderReturned(input) {
      calls.recordSubscriptionProviderReturned += 1;
      if (recordProviderFails) {
        recordProviderFails = false;
        return { ok: false, error: new AppError("unexpected", "simulated provider-return crash") };
      }
      if (state.subscription) {
        state = { ...state, subscription: {
          ...state.subscription,
          attemptSubscriptionRef: input.result.subscriptionRef,
          operationId: input.operationId,
          operationState: "provider_returned",
        } };
      }
      return ok({
        amountCents: input.result.amountCents,
        currency: input.result.currency,
        operationId: input.operationId,
        state: "provider_returned",
        status: input.result.status,
        subscriptionRef: input.result.subscriptionRef,
      });
    },
    async reviewSub(input) {
      calls.reviewSub += 1;
      if (state.subscription) {
        state = {
          ...state,
          subscription: {
            ...state.subscription,
            status: "review_required",
            subscriptionRef: input.subscriptionRef,
          },
          view: {
            ...state.view,
            needsOperatorAttention: "subscription_configuration_review",
          },
        };
      }
      return ok(undefined);
    },
    async resolveConsumerClient() {
      calls.resolveClient += 1;
      return ok(state.clientId);
    },
    async revokeConsent(_clientId, kind) {
      calls.revocations += 1;
      state = {
        ...state,
        view: {
          ...state.view,
          consents: state.view.consents.map((consent) =>
            consent.kind === kind ? { ...consent, authorized: false } : consent,
          ),
        },
      };
      return ok(undefined);
    },
    // Mirrors migration 355: the gate is inside settlement, not at the caller.
    async settleSub(_enrollmentId, _actorId, subscriptionRef) {
      calls.settleSub += 1;
      if (state.view.status === "cancelled") {
        requireProviderCancel(subscriptionRef);
        return ok({ reasonCode: "enrollment_cancelled" as const, subscriptionRef, verdict: "cancel_pending" as const });
      }
      if (state.view.idvState !== "passed") {
        return { ok: false, error: new AppError("settlement_blocked", "ENROLLMENT_IDV_NOT_PASSED") };
      }
      if (!consentsCurrentlyGranted()) {
        requireProviderCancel(subscriptionRef);
        state = { ...state, view: { ...state.view, status: "cancelled" } };
        return ok({ reasonCode: "consent_withdrawn" as const, subscriptionRef, verdict: "cancel_pending" as const });
      }
      if (state.subscription) {
        state = {
          ...state,
          subscription: { ...state.subscription, status: "active", subscriptionRef },
          view: { ...state.view, status: "active" },
        };
      }
      return ok({ reasonCode: "activated" as const, subscriptionRef, verdict: "settled" as const });
    },
  };

  const billing: BillingAdapter = {
    async cancel(request) {
      calls.cancelProvider += 1;
      order.push("provider_cancel");
      if (cancelFails) {
        cancelFails = false;
        throw new Error("provider unavailable");
      }
      return { cancelledAt: NOW.toISOString(), status: "cancelled", subscriptionRef: request.subscriptionRef };
    },
    async confirmCard() {
      return { last4: null, paymentMethodRef: "mock_pm_lane_b", status: "succeeded" };
    },
    async createSetupIntent() {
      return { clientSecret: null, customerRef: "mock_cus_lane_b", setupIntentRef: "mock_seti_lane_b" };
    },
    async findSubscription() {
      calls.findSubscription += 1;
      return options.reconciledSubscription ?? null;
    },
    async parseWebhook() {
      throw new Error("unused");
    },
    async startSubscription() {
      calls.startSubscription += 1;
      if (options.mustNotCharge) {
        throw new Error("createSubscription must not run on the parked path");
      }
      return options.subscriptionResult ?? {
        amountCents: 4900,
        currency: "usd",
        currentPeriodEnd: "2026-09-16T00:00:00.000Z",
        status: "active",
        subscriptionRef: "mock_sub_lane_b",
      };
    },
  };

  const idv: IdvAdapter = {
    async close() {
      calls.idvClose += 1;
      order.push("crs_close");
    },
    async pause() {
      calls.idvPause += 1;
      order.push("crs_pause");
    },
    async resume() {
      calls.idvResume += 1;
      order.push("crs_resume");
      if (resumeFails) {
        resumeFails = false;
        throw new Error("provider unavailable");
      }
    },
    async start(request) {
      calls.idvStartRequest = request;
      return {
        challenge: { attemptsRemaining: 2, expiresAt: "2026-08-16T00:15:00.000Z", kind: "sms" },
        idpass: false,
        memberRef: "mock_member_lane_b" as never,
      };
    },
    async submit() {
      const value = results.shift();
      if (!value) throw new Error("missing IDV result fixture");
      return value;
    },
  };

  const deps: EnrollmentServiceDependencies = {
    billing,
    billingDriver: "mock",
    idv,
    idvDriver: "mock",
    now: () => new Date(NOW),
    repository,
    tracker: {
      async enrollmentActivated(input) {
        assert.ok(input.clientId, "the tracker port needs the client id");
        assert.ok(input.enrollmentId, "the tracker port needs the enrollment id");
        calls.tracker += 1;
      },
    },
  };

  return { calls, deps, order, providerCancelIntent: () => providerCancelIntent, state: () => state };
}

test("the happy path creates one subscription and ends active", async () => {
  const testHarness = harness({ idvResults: [{ outcome: "pass", verifiedAt: NOW.toISOString() }] });
  const view = await submitIdv(
    testHarness.state().view.enrollmentId,
    { kind: "sms", code: "fixture" },
    actor,
    testHarness.deps,
  );
  assert.equal(view.status, "active");
  assert.equal(testHarness.calls.startSubscription, 1);
  assert.equal(testHarness.calls.settleSub, 1);
  assert.equal(testHarness.calls.reviewSub, 0);
  assert.equal(testHarness.calls.tracker, 1);
});

for (const mismatch of [
  {
    name: "mismatched subscription amount",
    result: { amountCents: 5000, currency: "usd", currentPeriodEnd: "2026-09-16T00:00:00.000Z", status: "active", subscriptionRef: "mock_sub_amount" },
  },
  {
    name: "zero subscription amount",
    result: { amountCents: 0, currency: "usd", currentPeriodEnd: "2026-09-16T00:00:00.000Z", status: "active", subscriptionRef: "mock_sub_zero" },
  },
  {
    name: "mismatched subscription currency",
    result: { amountCents: 4900, currency: "eur", currentPeriodEnd: "2026-09-16T00:00:00.000Z", status: "active", subscriptionRef: "mock_sub_currency" },
  },
  {
    // R4C-01: an off-price `incomplete` is a configuration fault and still reviews.
    name: "off-price incomplete subscription",
    result: { amountCents: 3900, currency: "usd", currentPeriodEnd: "2026-09-16T00:00:00.000Z", status: "incomplete", subscriptionRef: "mock_sub_incomplete_offprice" },
  },
  {
    name: "past-due subscription",
    result: { amountCents: 4900, currency: "usd", currentPeriodEnd: "2026-09-16T00:00:00.000Z", status: "past_due", subscriptionRef: "mock_sub_past_due" },
  },
] satisfies Array<{ name: string; result: StartSubscriptionResult }>) {
  test(`${mismatch.name} is retained for review and never settled`, async () => {
    const state = baseState({ view: { ...baseState().view, idvState: "passed", status: "enrolled" } });
    const testHarness = harness({ state, subscriptionResult: mismatch.result });

    await assert.rejects(
      reconcile(state.view.enrollmentId, actor, testHarness.deps),
      (error: unknown) => error instanceof AppError && error.code === "billing_configuration",
    );
    assert.equal(testHarness.calls.startSubscription, 1);
    assert.equal(testHarness.calls.reviewSub, 1);
    assert.equal(testHarness.calls.settleSub, 0);
    assert.equal(testHarness.calls.tracker, 0, `${mismatch.name} creates no paid activation`);
    assert.equal(testHarness.state().view.status, "enrolled");
    assert.equal(testHarness.state().subscription?.status, "review_required");
    assert.equal(testHarness.state().subscription?.subscriptionRef, mismatch.result.subscriptionRef);

    await assert.rejects(
      reconcile(state.view.enrollmentId, actor, testHarness.deps),
      (error: unknown) => error instanceof AppError && error.code === "billing_configuration",
    );
    assert.equal(testHarness.calls.startSubscription, 1);
  });
}

test("start enrollment threads the optional affiliate code into the existing begin call", async () => {
  const testHarness = harness();
  await startEnrollment({
    ip: "127.0.0.1",
    request: {
      aff: "partner-code",
      analysis: true,
      draftId: "11111111-1111-4111-8111-111111111111",
      email: "consumer@example.test",
      monitoring: true,
      name: "Lane B Consumer",
      phone: "+15550102210",
      signature: "Lane B Consumer",
    },
    userAgent: "test",
  }, actor, testHarness.deps);
  assert.equal(testHarness.calls.affiliateReferralSlug, "partner-code");
});

test("CRS enrollment hands full identity only to IDV and never to the repository", async () => {
  const pending = baseState({
    memberRef: null,
    subscription: null,
    view: { ...baseState().view, idvState: "pending" },
  });
  const testHarness = harness({ state: pending });
  testHarness.deps.idvDriver = "crs";
  const crsIdentity = {
    dateOfBirth: "1990-01-01",
    ssn: "999991234",
    address: {
      line1: "1 Contract Way",
      city: "Contract",
      state: "CA",
      postalCode: "00000",
    },
  };
  assert.deepEqual(Object.keys(crsIdentity), [...CRS_SPEC_TRANSIENT_IDENTITY_KEYS]);

  await startEnrollment({
    ip: "127.0.0.1",
    request: {
      analysis: true,
      crsIdentity,
      draftId: "11111111-1111-4111-8111-111111111111",
      email: "consumer@example.test",
      monitoring: true,
      name: "Lane B Consumer",
      phone: "+1 (555) 010-2210",
      signature: "Lane B Consumer",
    },
    userAgent: "test",
  }, actor, testHarness.deps);

  assert.doesNotMatch(JSON.stringify(testHarness.calls.beginInput), /999991234|1990-01-01|Contract Way/);
  assert.deepEqual(testHarness.calls.idvStartRequest, {
    clientId: pending.clientId,
    enrollmentId: pending.view.enrollmentId,
    identity: {
      email: "consumer@example.test",
      fullName: "Lane B Consumer",
      phone: "+1 (555) 010-2210",
    },
    crsIdentity: {
      firstName: "Lane",
      lastName: "B Consumer",
      email: "consumer@example.test",
      phone: "5550102210",
      ...crsIdentity,
    },
  });
});

test("a malformed CRS success response stays a provider failure and never blames the consumer", async () => {
  const pending = baseState({
    memberRef: null,
    subscription: null,
    view: { ...baseState().view, idvState: "pending" },
  });
  const testHarness = harness({ state: pending });
  testHarness.deps.idvDriver = "crs";
  testHarness.deps.idv.start = async () => {
    throw new CrsDriverError("sandbox", "submitDit", 502);
  };

  await assert.rejects(
    startEnrollment({
      ip: "127.0.0.1",
      request: {
        analysis: true,
        crsIdentity: {
          dateOfBirth: "1990-01-01",
          ssn: "999991234",
          address: { line1: "1 Contract Way", city: "Contract", state: "CA", postalCode: "00000" },
        },
        draftId: "11111111-1111-4111-8111-111111111111",
        email: "consumer@example.test",
        monitoring: true,
        name: "Lane B Consumer",
        phone: "+1 (555) 010-2210",
        signature: "Lane B Consumer",
      },
      userAgent: "test",
    }, actor, testHarness.deps),
    (error: unknown) => error instanceof AppError
      && error.code === "driver_unavailable"
      && error.message === "The enrollment provider could not complete the request. Try again later."
      && !/your identity|enrollment did not start/i.test(error.message),
  );
});

test("an existing CRS registration has a stable resumability error instead of a retryable provider fault", async () => {
  const pending = baseState({
    memberRef: null,
    subscription: null,
    view: { ...baseState().view, idvState: "pending" },
  });
  const testHarness = harness({ state: pending });
  testHarness.deps.idvDriver = "crs";
  testHarness.deps.idv.start = async () => {
    throw new CrsDriverError("sandbox", "registerUser", 400, [CRS_SPEC_ERROR_CODES.userAlreadyRegistered]);
  };

  await assert.rejects(
    startEnrollment({
      ip: "127.0.0.1",
      request: {
        analysis: true,
        crsIdentity: {
          dateOfBirth: "1990-01-01",
          ssn: "999991234",
          address: { line1: "1 Contract Way", city: "Contract", state: "CA", postalCode: "00000" },
        },
        draftId: "11111111-1111-4111-8111-111111111111",
        email: "consumer@example.test",
        monitoring: true,
        name: "Lane B Consumer",
        phone: "+1 (555) 010-2210",
        signature: "Lane B Consumer",
      },
      userAgent: "test",
    }, actor, testHarness.deps),
    (error: unknown) => error instanceof AppError
      && error.code === "identity_account_exists"
      && error.status === 409
      && error.message === "A verification account already exists for this email. Contact support to resume enrollment."
      && !/try again later|identity failed|could not verify/i.test(error.message),
  );
});

test("an explicit CRS identity rejection has a matching non-provider error code", async () => {
  const pending = baseState({
    memberRef: null,
    subscription: null,
    view: { ...baseState().view, idvState: "pending" },
  });
  const testHarness = harness({ state: pending });
  testHarness.deps.idvDriver = "crs";
  testHarness.deps.idv.start = async () => {
    throw new CrsDriverError("sandbox", "submitDit", 400, [CRS_SPEC_ERROR_CODES.ditRejected]);
  };

  await assert.rejects(
    startEnrollment({
      ip: "127.0.0.1",
      request: {
        analysis: true,
        crsIdentity: {
          dateOfBirth: "1990-01-01",
          ssn: "999991234",
          address: { line1: "1 Contract Way", city: "Contract", state: "CA", postalCode: "00000" },
        },
        draftId: "11111111-1111-4111-8111-111111111111",
        email: "consumer@example.test",
        monitoring: true,
        name: "Lane B Consumer",
        phone: "+1 (555) 010-2210",
        signature: "Lane B Consumer",
      },
      userAgent: "test",
    }, actor, testHarness.deps),
    (error: unknown) => error instanceof AppError
      && error.code === "identity_verification_failed"
      && error.status === 422
      && /your identity/i.test(error.message),
  );
});

test("CRS development enrollment returns its transient sandbox verification link without persisting it", async () => {
  const pending = baseState({
    memberRef: null,
    subscription: null,
    view: { ...baseState().view, idvState: "pending" },
  });
  const testHarness = harness({ state: pending });
  testHarness.deps.idvDriver = "crs";
  const verificationUrl = `${CRS_SPEC_HOSTS.development.widget}/api/smfa/auth/not-a-real-session`;
  testHarness.deps.idv.start = async (request) => {
    testHarness.calls.idvStartRequest = request;
    return {
      challenge: {
        attemptsRemaining: 1,
        expiresAt: new Date(NOW.getTime() + 15 * 60 * 1000).toISOString(),
        kind: CRS_SPEC_SMFA_CHALLENGE_KIND,
        verificationUrl,
      },
      idpass: false,
      memberRef: "not-a-real-member" as never,
    };
  };

  const started = await startEnrollment({
    ip: "127.0.0.1",
    request: {
      analysis: true,
      crsIdentity: {
        dateOfBirth: "1990-01-01",
        ssn: "999991234",
        address: { line1: "1 Contract Way", city: "Contract", state: "CA", postalCode: "00000" },
      },
      draftId: "11111111-1111-4111-8111-111111111111",
      email: "consumer@example.test",
      monitoring: true,
      name: "Lane B Consumer",
      phone: "+1 (555) 010-2210",
      signature: "Lane B Consumer",
    },
    userAgent: "test",
  }, actor, testHarness.deps);

  assert.equal(started.verificationUrl, verificationUrl);
  assert.equal("verificationUrl" in testHarness.state().view, false);
});

test("an incomplete CRS SMFA check stays pending without spending a mock quiz attempt", async () => {
  const testHarness = harness({
    idvResults: [{
      outcome: "retry",
      challenge: { kind: "smfa_link", attemptsRemaining: 1, expiresAt: NOW.toISOString() },
    }],
  });
  testHarness.deps.idvDriver = "crs";
  const before = testHarness.state().view;
  const view = await submitIdv(
    before.enrollmentId,
    { kind: "smfa_status" },
    actor,
    testHarness.deps,
  );
  assert.deepEqual(view, before);
  assert.equal(testHarness.calls.idvSettled, 0);
  assert.equal(testHarness.calls.startSubscription, 0);
});

test("the signed-in service path completes CRS enrollment, pause, and close without retaining identity", async () => {
  const memberRef = "550e8400-e29b-41d4-a716-446655440000" as CrsMemberRef;
  const continuation = "v1.encrypted-short-lived-state" as CrsIdvContinuation;
  const operations: string[] = [];
  const crs = {
    driver: "sandbox",
    async createMember() {
      operations.push("create");
      return {
        memberRef,
        idpass: false,
        continuation,
        challenge: {
          kind: CRS_SPEC_SMFA_CHALLENGE_KIND,
          attemptsRemaining: 1,
          expiresAt: NOW.toISOString(),
        },
      };
    },
    async submitIdvStep(_memberRef: CrsMemberRef, submission: { kind: string }, suppliedContinuation?: string) {
      assert.equal(submission.kind, CRS_SPEC_IDV_SUBMISSION_KIND);
      assert.equal(suppliedContinuation, continuation);
      operations.push("submit");
      return { outcome: "pass" as const, verifiedAt: NOW.toISOString() };
    },
    async pauseMember() {
      operations.push("pause");
      return { pausedAt: NOW.toISOString() };
    },
    async closeMember() {
      operations.push("close");
      return { closedAt: NOW.toISOString() };
    },
  } as unknown as CrsAdapter;
  const pending = baseState({
    memberRef: null,
    subscription: null,
    view: { ...baseState().view, idvState: "pending" },
  });
  const testHarness = harness({ state: pending });
  testHarness.deps.idvDriver = "crs";
  testHarness.deps.idv = createCrsIdvAdapter(crs);
  const transient = {
    dateOfBirth: "1990-01-01",
    ssn: "999991234",
    address: { line1: "1 Contract Way", city: "Contract", state: "CA", postalCode: "00000" },
  };

  const started = await startEnrollment({
    ip: "127.0.0.1",
    request: {
      analysis: true,
      crsIdentity: transient,
      draftId: "11111111-1111-4111-8111-111111111111",
      email: "consumer@example.test",
      monitoring: true,
      name: "Lane B Consumer",
      phone: "+1 (555) 010-2210",
      signature: "Lane B Consumer",
    },
    userAgent: "test",
  }, actor, testHarness.deps);
  assert.equal(started.idvState, "sms_sent");
  const active = await submitIdv(started.enrollmentId, { kind: CRS_SPEC_IDV_SUBMISSION_KIND }, actor, testHarness.deps);
  assert.equal(active.status, "active");
  await revokeConsent(active.enrollmentId, "monitoring", actor, testHarness.deps);
  const cancelled = await cancelEnrollment(active.enrollmentId, actor, testHarness.deps);

  assert.equal(cancelled.status, "cancelled");
  assert.deepEqual(operations, ["create", "submit", "pause", "close"]);
  assert.doesNotMatch(JSON.stringify(testHarness.state()), /999991234|1990-01-01|Contract Way/);
});

test("two quiz misses park without reaching the charge call", async () => {
  const state = baseState({ view: { ...baseState().view, idvState: "quiz" } });
  const testHarness = harness({
    idvResults: [
      { challenge: { attemptsRemaining: 1, expiresAt: NOW.toISOString(), kind: "quiz" }, outcome: "retry" },
      { lockedUntil: new Date(NOW.getTime() + 72 * HOUR_MS).toISOString(), outcome: "locked" },
    ],
    mustNotCharge: true,
    state,
  });
  await submitIdv(state.view.enrollmentId, { kind: "quiz", answers: [{ answerId: "wrong", questionId: "q1" }] }, actor, testHarness.deps);
  const view = await submitIdv(state.view.enrollmentId, { kind: "quiz", answers: [{ answerId: "wrong", questionId: "q1" }] }, actor, testHarness.deps);
  assert.equal(view.status, "parked");
  assert.equal(testHarness.calls.startSubscription, 0);
  assert.equal(view.parkedUntil, "2026-08-19T00:00:00.000Z");
});

test("the final allowed miss locks for exactly 72 hours and never charges", async () => {
  const initial = baseState({
    attemptsUsed: 1,
    view: { ...baseState().view, attemptsRemaining: 1, idvState: "retry" },
  });
  const testHarness = harness({
    idvResults: [{ lockedUntil: "2026-08-19T00:00:00.000Z", outcome: "locked" }],
    mustNotCharge: true,
    state: initial,
  });
  const view = await submitIdv(initial.view.enrollmentId, { kind: "quiz", answers: [{ answerId: "wrong", questionId: "q1" }] }, actor, testHarness.deps);
  assert.equal(view.lockedUntil, "2026-08-19T00:00:00.000Z");
  assert.equal(testHarness.calls.startSubscription, 0);
});

test("fresh interrupted settlement is driven exactly once", async () => {
  const state = baseState({ view: { ...baseState().view, idvState: "passed", status: "enrolled" } });
  const testHarness = harness({ state });
  const view = await reconcile(state.view.enrollmentId, actor, testHarness.deps);
  assert.equal(view.status, "active");
  assert.equal(testHarness.calls.startSubscription, 1);
  assert.equal(testHarness.calls.settleSub, 1);
});

test("a fixed 25-hour-old attempt reconciles instead of stopping for operator attention", async () => {
  const state = baseState({
    subscription: { ...baseState().subscription!, subscriptionAttemptAt: new Date(NOW.getTime() - 25 * HOUR_MS).toISOString() },
    view: { ...baseState().view, idvState: "passed", status: "enrolled" },
  });
  const testHarness = harness({ state });
  const view = await reconcile(state.view.enrollmentId, actor, testHarness.deps);
  assert.equal(view.status, "active");
  assert.equal(testHarness.calls.startSubscription, 1);
  assert.equal(testHarness.calls.recordSubscriptionProviderReturned, 1);
});

test("a provider-return crash reconciles across fresh adapters without a second subscription", async () => {
  const initial = baseState({
    subscription: { ...baseState().subscription!, subscriptionAttemptAt: new Date(NOW.getTime() - 25 * HOUR_MS).toISOString() },
    view: { ...baseState().view, idvState: "passed", status: "enrolled" },
  });
  const first = harness({ recordProviderFailsOnce: true, state: initial });
  await assert.rejects(reconcile(initial.view.enrollmentId, actor, first.deps));
  assert.equal(first.calls.startSubscription, 1);
  assert.equal(first.calls.settleSub, 0);

  const providerResult: StartSubscriptionResult = {
    amountCents: 4900,
    currency: "usd",
    currentPeriodEnd: "2026-09-16T00:00:00.000Z",
    status: "active",
    subscriptionRef: "mock_sub_lane_b",
  };
  const second = harness({ reconciledSubscription: providerResult, state: first.state() });
  const view = await reconcile(initial.view.enrollmentId, actor, second.deps);
  assert.equal(view.status, "active");
  assert.equal(second.calls.findSubscription, 1);
  assert.equal(second.calls.startSubscription, 0, "a crash retry does not create a second subscription");
  assert.equal(first.calls.startSubscription + second.calls.startSubscription, 1);
});

test("reconcile is idempotent after the interrupted settlement is repaired", async () => {
  const state = baseState({ view: { ...baseState().view, idvState: "passed", status: "enrolled" } });
  const testHarness = harness({ state });
  const first = await reconcile(state.view.enrollmentId, actor, testHarness.deps);
  const counts = { ...testHarness.calls };
  const second = await reconcile(state.view.enrollmentId, actor, testHarness.deps);
  assert.deepEqual(second, first);
  assert.deepEqual(testHarness.calls, counts);
});

test("revocation appends through the repository and leaves the other consent authorized", async () => {
  const testHarness = harness();
  testHarness.deps.idvDriver = "crs";
  const view = await revokeConsent(testHarness.state().view.enrollmentId, "monitoring", actor, testHarness.deps);
  assert.equal(testHarness.calls.revocations, 1);
  assert.equal(view.consents.find((item) => item.kind === "monitoring")?.authorized, false);
  assert.equal(view.consents.find((item) => item.kind === "analysis")?.authorized, true);
  assert.equal(testHarness.calls.idvPause, 1);
  assert.deepEqual(testHarness.order, ["crs_pause"]);
});

test("a revoked analysis permission is restored with current signed evidence and read back", async () => {
  const initial = baseState();
  const state = {
    ...initial,
    view: {
      ...initial.view,
      consents: initial.view.consents.map((consent) => consent.kind === "analysis"
        ? { ...consent, authorized: false }
        : consent),
    },
  };
  const testHarness = harness({ state });
  const view = await reauthorizeConsent(
    state.view.enrollmentId,
    {
      accepted: true,
      draftId: "11111111-1111-4111-8111-111111111119",
      ip: "127.0.0.1",
      kind: "analysis",
      signature: "Lane B Consumer",
      userAgent: "test",
    },
    actor,
    testHarness.deps,
  );

  assert.equal(view.consents.find((item) => item.kind === "analysis")?.authorized, true);
  assert.deepEqual(testHarness.calls.reauthorizationInput, {
    actorId: actor.id,
    draftId: "11111111-1111-4111-8111-111111111119",
    enrollmentId: state.view.enrollmentId,
    ip: "127.0.0.1",
    kind: "analysis",
    signerName: "Lane B Consumer",
    textVersion: "analysis-2026-08-16.1",
    typedSignature: "Lane B Consumer",
    userAgent: "test",
  });
  assert.equal(testHarness.calls.idvResume, 0, "analysis grant does not alter monitoring provider state");
});

test("monitoring reauthorization retries provider resume without duplicating its signed grant", async () => {
  const initial = baseState();
  const state = {
    ...initial,
    view: {
      ...initial.view,
      consents: initial.view.consents.map((consent) => consent.kind === "monitoring"
        ? { ...consent, authorized: false }
        : consent),
    },
  };
  const testHarness = harness({ resumeFailsOnce: true, state });
  testHarness.deps.idvDriver = "crs";
  const input = {
    accepted: true as const,
    draftId: "11111111-1111-4111-8111-111111111120",
    ip: "127.0.0.1",
    kind: "monitoring" as const,
    signature: "Lane B Consumer",
    userAgent: "test",
  };

  await assert.rejects(
    reauthorizeConsent(state.view.enrollmentId, input, actor, testHarness.deps),
    (error: unknown) => error instanceof AppError && error.code === "driver_unavailable",
  );
  assert.equal(testHarness.state().view.consents.find((item) => item.kind === "monitoring")?.authorized, true);

  const view = await reauthorizeConsent(state.view.enrollmentId, input, actor, testHarness.deps);
  assert.equal(view.consents.find((item) => item.kind === "monitoring")?.authorized, true);
  assert.equal(testHarness.calls.reauthorizations, 2, "the same draft reaches the idempotent RPC twice");
  assert.equal(testHarness.calls.idvResume, 2, "the opaque provider member resume is retried");
  assert.deepEqual(testHarness.order, ["crs_resume", "crs_resume"]);
});

test("reauthorization requires the consumer's exact affirmative signature", async () => {
  const initial = baseState();
  const state = {
    ...initial,
    view: {
      ...initial.view,
      consents: initial.view.consents.map((consent) => consent.kind === "analysis"
        ? { ...consent, authorized: false }
        : consent),
    },
  };
  const testHarness = harness({ state });
  await assert.rejects(
    reauthorizeConsent(
      state.view.enrollmentId,
      {
        accepted: true,
        draftId: "11111111-1111-4111-8111-111111111121",
        ip: "127.0.0.1",
        kind: "analysis",
        signature: "Someone Else",
        userAgent: "test",
      },
      actor,
      testHarness.deps,
    ),
    (error: unknown) => error instanceof AppError && error.code === "invalid_payload",
  );
  assert.equal(testHarness.calls.reauthorizations, 0);
});

test("a canceled enrollment and a non-consumer actor cannot reauthorize", async () => {
  const cancelled = baseState({ view: { ...baseState().view, status: "cancelled" } });
  const testHarness = harness({ state: cancelled });
  const input = {
    accepted: true as const,
    draftId: "11111111-1111-4111-8111-111111111122",
    ip: "127.0.0.1",
    kind: "analysis" as const,
    signature: "Lane B Consumer",
    userAgent: "test",
  };
  await assert.rejects(
    reauthorizeConsent(cancelled.view.enrollmentId, input, actor, testHarness.deps),
    (error: unknown) => error instanceof AppError && error.code === "conflict",
  );
  await assert.rejects(
    reauthorizeConsent(
      cancelled.view.enrollmentId,
      input,
      { ...actor, role: "operator_member" },
      testHarness.deps,
    ),
    (error: unknown) => error instanceof AppError && error.code === "forbidden",
  );
  assert.equal(testHarness.calls.reauthorizations, 0);
});

test("cancel records the stop intent before provider work and never starts a subscription", async () => {
  const state = baseState({
    subscription: { ...baseState().subscription!, subscriptionRef: "mock_sub_lane_b" },
    view: { ...baseState().view, idvState: "passed", status: "active" },
  });
  const testHarness = harness({ state });
  testHarness.deps.idvDriver = "crs";
  const view = await cancelEnrollment(state.view.enrollmentId, actor, testHarness.deps);
  assert.equal(view.status, "cancelled");
  assert.deepEqual(testHarness.order, ["stop_intent", "provider_cancel", "provider_cancel_completed", "crs_close"]);
  assert.equal(testHarness.calls.idvClose, 1);
  assert.equal(testHarness.calls.startSubscription, 0);
  assert.deepEqual(testHarness.providerCancelIntent(), { completed: true, ref: "mock_sub_lane_b" });
});

test("provider cancellation failure leaves a durable stop intent and retries without a charge", async () => {
  const state = baseState({
    subscription: { ...baseState().subscription!, subscriptionRef: "mock_sub_lane_b" },
    view: { ...baseState().view, idvState: "passed", status: "active" },
  });
  const testHarness = harness({ cancelFailsOnce: true, state });
  await assert.rejects(cancelEnrollment(state.view.enrollmentId, actor, testHarness.deps));
  assert.equal(testHarness.state().view.status, "cancelled");
  await cancelEnrollment(state.view.enrollmentId, actor, testHarness.deps);
  assert.deepEqual(testHarness.order,
    ["stop_intent", "provider_cancel", "stop_intent", "provider_cancel", "provider_cancel_completed"]);
  assert.equal(testHarness.calls.startSubscription, 0);
  // R4C-07: the obligation is confirmed exactly once, on the provider's confirmation.
  assert.equal(testHarness.calls.completeProviderCancel, 1);
  assert.deepEqual(testHarness.providerCancelIntent(), { completed: true, ref: "mock_sub_lane_b" });
});

test("analysis withdrawal followed by reconciliation never starts a subscription", async () => {
  const state = baseState({ view: { ...baseState().view, idvState: "passed", status: "active" } });
  const testHarness = harness({ state });
  await revokeConsent(state.view.enrollmentId, "analysis", actor, testHarness.deps);
  const view = await reconcile(state.view.enrollmentId, actor, testHarness.deps);
  assert.equal(testHarness.calls.revocations, 1);
  assert.equal(testHarness.calls.startSubscription, 0, "analysis withdrawal blocks subscription start");
  assert.equal(testHarness.calls.recordSetup, 0);
  assert.equal(testHarness.state().subscription?.subscriptionRef, null);
  assert.equal(view.needsOperatorAttention, "consent_withdrawn");
});

test("monitoring withdrawal followed by reconciliation never starts a subscription", async () => {
  const state = baseState({ view: { ...baseState().view, idvState: "passed", status: "active" } });
  const testHarness = harness({ state });
  await revokeConsent(state.view.enrollmentId, "monitoring", actor, testHarness.deps);
  const view = await reconcile(state.view.enrollmentId, actor, testHarness.deps);
  assert.equal(testHarness.calls.startSubscription, 0, "monitoring withdrawal blocks subscription start");
  assert.equal(testHarness.calls.recordSetup, 0);
  assert.equal(testHarness.state().subscription?.subscriptionRef, null);
  assert.equal(view.needsOperatorAttention, "consent_withdrawn");
});

test("milestone recording is idempotent through one recorder call", async () => {
  const testHarness = harness();
  await recordMilestone(testHarness.state().view.enrollmentId, "onboarding_call_completed", actor, testHarness.deps);
  const view = await recordMilestone(testHarness.state().view.enrollmentId, "onboarding_call_completed", actor, testHarness.deps);
  assert.equal(testHarness.calls.milestones, 1);
  assert.equal(view.milestones.filter((item) => item.kind === "onboarding_call_completed").length, 1);
});

const startRequest = {
  ip: "127.0.0.1",
  request: {
    analysis: true,
    draftId: "00000000-0000-0000-0000-000000000399",
    email: "consumer@example.test",
    monitoring: true,
    name: "Lane B Consumer",
    phone: "+15550102210",
    signature: "Lane B Consumer",
  },
  userAgent: "test",
};

test("foreign registered email is refused before every enrollment mutation seam", async () => {
  const testHarness = harness();
  testHarness.deps.emailAvailability = {
    async registeredElsewhere(input) {
      assert.deepEqual(input, { actorId: actor.id, email: "consumer@example.test" });
      return true;
    },
  };
  testHarness.deps.tenancyEnabled = () => true;
  await assert.rejects(
    startEnrollment(startRequest, actor, testHarness.deps),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "EMAIL_ALREADY_REGISTERED",
  );
  assert.equal(testHarness.calls.resolveClient, 0);
  assert.equal(testHarness.calls.begin, 0);
  assert.equal(testHarness.calls.recordSetup, 0);
  assert.equal(testHarness.calls.startSubscription, 0);
});

test("available or same-actor email preserves the existing begin path", async () => {
  const testHarness = harness();
  testHarness.deps.emailAvailability = {
    async registeredElsewhere() { return false; },
  };
  testHarness.deps.tenancyEnabled = () => true;
  await startEnrollment(startRequest, actor, testHarness.deps);
  assert.equal(testHarness.calls.resolveClient, 1);
  assert.equal(testHarness.calls.begin, 1);
});

test("tenancy flag off preserves the pre-Phase-20 enrollment begin path", async () => {
  const testHarness = harness();
  testHarness.deps.tenancyEnabled = () => false;
  testHarness.deps.emailAvailability = {
    async registeredElsewhere() { throw new Error("must not read while disabled"); },
  };
  await startEnrollment(startRequest, actor, testHarness.deps);
  assert.equal(testHarness.calls.resolveClient, 1);
  assert.equal(testHarness.calls.begin, 1);
});

// R4C-08 / R4D-02. Both consents behave identically at both seams. On c2df7ae
// every one of these fails: `hasCurrentSubscriptionConsents(state)` at
// service.ts:269 reads the snapshot taken before `recordSetup`, so the
// revocation is invisible, `startSubscription` runs and settlement activates
// (monitoring) or the enqueue rolls the local write back while the provider
// subscription survives with no cancellation path (analysis).
for (const kind of ["analysis", "monitoring"] as const) {
  test(`${kind} withdrawal committed before dispatch stops the charge`, async () => {
    const state = baseState({ view: { ...baseState().view, idvState: "passed", status: "active" } });
    const testHarness = harness({ revokeDuringSetup: kind, state });

    await assert.rejects(
      reconcile(state.view.enrollmentId, actor, testHarness.deps),
      (error: unknown) => error instanceof AppError && error.code === "settlement_blocked",
    );
    assert.equal(testHarness.calls.beginSubscriptionAttempt, 1);
    assert.equal(testHarness.calls.findSubscription, 0);
    assert.equal(testHarness.calls.startSubscription, 0, "no provider dispatch after withdrawal");
    assert.equal(testHarness.calls.settleSub, 0);
    assert.equal(testHarness.calls.tracker, 0);
    assert.equal(testHarness.state().subscription?.status, "authorized");
    assert.equal(testHarness.providerCancelIntent(), null, "nothing was created, so nothing is owed");
  });

  test(`${kind} withdrawal inside the provider window activates nothing and leaves one cancellation`, async () => {
    const state = baseState({ view: { ...baseState().view, idvState: "passed", status: "active" } });
    const testHarness = harness({ revokeDuringAttempt: kind, state });

    const view = await reconcile(state.view.enrollmentId, actor, testHarness.deps);
    assert.equal(testHarness.calls.startSubscription, 1, "the provider had already been reached");
    assert.equal(testHarness.calls.settleSub, 1);
    assert.notEqual(view.status, "active");
    assert.equal(testHarness.calls.tracker, 0, "no activation and no initial analysis tuple");
    assert.deepEqual(testHarness.providerCancelIntent(), { completed: true, ref: "mock_sub_lane_b" });
    assert.equal(testHarness.calls.cancelProvider, 1, "exactly one outbound cancellation");
    assert.equal(testHarness.calls.completeProviderCancel, 1);
  });
}

// R4C-08 crash seam: the fast path is only a fast path. With the provider
// unavailable the obligation stays open for the `purge.derived` handler.
test("a provider that cannot confirm leaves the durable cancellation obligation open", async () => {
  const state = baseState({ view: { ...baseState().view, idvState: "passed", status: "active" } });
  const testHarness = harness({ cancelFailsOnce: true, revokeDuringAttempt: "monitoring", state });

  await assert.rejects(
    reconcile(state.view.enrollmentId, actor, testHarness.deps),
    (error: unknown) => error instanceof AppError && error.code === "driver_unavailable",
  );
  assert.deepEqual(testHarness.providerCancelIntent(), { completed: false, ref: "mock_sub_lane_b" });
  assert.equal(testHarness.calls.completeProviderCancel, 0);
  assert.equal(testHarness.calls.tracker, 0);
});

// R4C-07: cancellation while the provider call is in flight. On c2df7ae the
// service reads `state.subscription?.subscriptionRef` from the pre-cancel
// snapshot, which is null for a subscription created during the cancellation,
// so no cancellation is issued and no obligation is recorded.
test("a subscription that arrives after cancellation is retained and owed a cancellation", async () => {
  const state = baseState({
    subscription: { ...baseState().subscription!, attemptSubscriptionRef: "mock_sub_race", operationState: "provider_returned" },
    view: { ...baseState().view, idvState: "passed", status: "active" },
  });
  const testHarness = harness({ state });
  const view = await cancelEnrollment(state.view.enrollmentId, actor, testHarness.deps);
  assert.equal(view.status, "cancelled");
  assert.deepEqual(testHarness.order, ["stop_intent", "provider_cancel", "provider_cancel_completed"]);
  assert.deepEqual(testHarness.providerCancelIntent(), { completed: true, ref: "mock_sub_race" });
});

// R4C-01: an exact-price `incomplete` is retryable, so it must not enter the
// review state that migration 330 refuses to settle from. On c2df7ae this
// calls `reviewSub` and the account can never activate.
test("an exact-price incomplete first payment stays settleable instead of entering review", async () => {
  const state = baseState({ view: { ...baseState().view, idvState: "passed", status: "enrolled" } });
  const testHarness = harness({
    state,
    subscriptionResult: {
      amountCents: 4900, currency: "usd", currentPeriodEnd: "2026-09-16T00:00:00.000Z",
      status: "incomplete", subscriptionRef: "mock_sub_incomplete",
    },
  });

  await assert.rejects(
    reconcile(state.view.enrollmentId, actor, testHarness.deps),
    (error: unknown) => error instanceof AppError && error.code === "conflict",
  );
  assert.equal(testHarness.calls.reviewSub, 0, "a retryable payment is not a configuration fault");
  assert.equal(testHarness.calls.settleSub, 0);
  assert.equal(testHarness.calls.tracker, 0);
  assert.equal(testHarness.state().subscription?.status, "authorized");
  assert.equal(testHarness.state().subscription?.attemptSubscriptionRef, "mock_sub_incomplete");
  assert.equal(testHarness.state().view.needsOperatorAttention, null);
});
