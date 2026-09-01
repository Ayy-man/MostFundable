import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createPaidRefresh } from "./paid-refresh.ts";
import {
  createPaidRefreshRepository,
  PaidRefreshOutstandingRequestError,
} from "./repository.ts";

import type { AnalysisJob } from "@/lib/analysis/ports";
import type {
  OneOffBillingAdapter,
  OneOffPaymentOutcome,
  OneOffPaymentRequest,
  OneOffPaymentResult,
} from "@/lib/billing";
import type { PaidRefreshTransition } from "./paid-refresh.ts";
import type {
  CreatePaidRefreshRequestInput,
  PaidRefreshDurableState,
  PaidRefreshPaymentAttempt,
  PaidRefreshPaymentEvent,
  PaidRefreshRepository,
  PaidRefreshRequest,
  RecordPaidRefreshPaymentInput,
} from "./repository.ts";

const ACTOR_ID = "58000000-0000-4000-8000-000000000101";
const CLIENT_ID = "58000000-0000-4000-8000-000000000201";
const ORG_ID = "58000000-0000-4000-8000-000000000301";
const REQUEST_ID = "58000000-0000-4000-8000-000000000401";
const EVENT_ID = "58000000-0000-4000-8000-000000000501";
const JOB_ID = "58000000-0000-4000-8000-000000000601";
const ANALYSIS_RUN_ID = "58000000-0000-4000-8000-000000000701";
const INSTANT = "2026-08-16T03:00:00.000Z";
const ENABLED = {
  FEATURE_PAID_REFRESH: "true",
  FEATURE_ANALYSIS: "true",
  FEATURE_ANCILLARY: "true",
};
const STRIPE_WITH_SANDBOX_CRS = {
  ...ENABLED,
  BILLING_DRIVER: "stripe",
  CONSUMER_MONITORING_PRICE_REF: "price_monitoring",
  CRS_API_KEY: "api-key",
  CRS_BASE_URL: "https://sandbox.crs.example",
  CRS_DRIVER: "sandbox",
  CRS_SECRET: "crs-secret",
  STRIPE_PRICE_OPERATOR_BASE: "price_base",
  STRIPE_PRICE_OPERATOR_SEAT: "price_seat",
  STRIPE_SECRET_KEY: "stripe-secret",
  STRIPE_WEBHOOK_SECRET: "stripe-webhook",
} as const;
const INPUT = {
  actorId: ACTOR_ID,
  clientId: CLIENT_ID,
  expectedAmountCents: 1_900,
  idempotencyKey: "manual-refresh-1",
};

function databaseAttempt(overrides: Record<string, unknown> = {}) {
  return {
    payment_attempt_state: "dispatching",
    payment_idempotency_key: `force_pull:${REQUEST_ID}`,
    payment_dispatch_started_at: INSTANT,
    payment_provider_event_key: null,
    payment_provider_payment_ref: null,
    payment_provider_outcome: null,
    payment_provider_returned_at: null,
    ...overrides,
  };
}

function databaseRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: REQUEST_ID,
    actor_profile_id: ACTOR_ID,
    client_id: CLIENT_ID,
    org_id: ORG_ID,
    idempotency_key: INPUT.idempotencyKey,
    amount_cents: 1_900,
    currency: "usd",
    driver: "mock",
    state: "initiated",
    provider_payment_ref: null,
    analysis_run_id: null,
    created_at: INSTANT,
    updated_at: INSTANT,
    ...databaseAttempt({
      payment_attempt_state: "none",
      payment_idempotency_key: null,
      payment_dispatch_started_at: null,
    }),
    ...overrides,
  };
}

function databaseEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    request_id: REQUEST_ID,
    provider_event_key: `mock:event:${REQUEST_ID}`,
    provider_payment_ref: `mock:payment:${REQUEST_ID}`,
    outcome: "succeeded",
    amount_cents: 1_900,
    currency: "usd",
    occurred_at: INSTANT,
    ...overrides,
  };
}

function databaseState(overrides: Record<string, unknown> = {}) {
  return {
    request_id: REQUEST_ID,
    actor_profile_id: ACTOR_ID,
    client_id: CLIENT_ID,
    amount_cents: 1_900,
    currency: "usd",
    driver: "mock",
    state: "initiated",
    provider_payment_ref: null,
    analysis_run_id: null,
    payment_succeeded: false,
    latest_payment_outcome: null,
    ...databaseAttempt({
      payment_attempt_state: "none",
      payment_idempotency_key: null,
      payment_dispatch_started_at: null,
    }),
    ...overrides,
  };
}

class FakeRpcClient {
  readonly calls: Array<{ name: string; args: Record<string, unknown> }> = [];

  async rpc(name: string, args: Record<string, unknown>) {
    this.calls.push({ name, args });
    const data = name === "create_paid_refresh_request"
      ? [databaseRequest()]
      : name === "begin_paid_refresh_payment_attempt"
        ? [databaseAttempt()]
        : name === "record_paid_refresh_provider_returned"
          ? [databaseAttempt({
              payment_attempt_state: "provider_returned",
              payment_provider_event_key: `mock:event:${REQUEST_ID}`,
              payment_provider_payment_ref: `mock:payment:${REQUEST_ID}`,
              payment_provider_outcome: "succeeded",
              payment_provider_returned_at: INSTANT,
            })]
      : name === "record_paid_refresh_payment_event"
        ? [databaseEvent()]
        : name === "read_paid_refresh_request"
          ? [databaseState()]
          : name === "link_paid_refresh_analysis"
            ? [databaseRequest({
                state: "queued",
                provider_payment_ref: `mock:payment:${REQUEST_ID}`,
                analysis_run_id: ANALYSIS_RUN_ID,
              })]
            : name === "reserve_paid_refresh_pull"
              ? [{ allowed: true, reason: null }]
              : name === "commit_paid_refresh_pull" || name === "release_paid_refresh_pull" || name === "mark_paid_refresh_payment_needs_review" || name === "resolve_paid_refresh_unfulfillable"
                ? true
                : name === "paid_refresh_analysis_authorization"
                  ? [{ authorized: true, unfulfillable_request_id: null }]
                : null;
    return { data, error: null };
  }
}

describe("paid refresh repository", () => {
  it("maps exact RPC results and sends only named arguments", async () => {
    const fake = new FakeRpcClient();
    let clients = 0;
    const repository = createPaidRefreshRepository({
      createClient: () => {
        clients += 1;
        return fake as never;
      },
    });
    assert.equal(clients, 0);
    assert.deepEqual(
      await repository.analysisAuthorization({
        clientId: CLIENT_ID,
        actorProfileId: ACTOR_ID,
        idempotencyKey: INPUT.idempotencyKey,
      }),
      { authorized: true, unfulfillableRequestId: null },
    );
    assert.equal(await repository.resolveUnfulfillable(REQUEST_ID), true);
    await repository.createRequest({
      actorProfileId: ACTOR_ID,
      clientId: CLIENT_ID,
      idempotencyKey: INPUT.idempotencyKey,
      amountCents: 1_900,
      currency: "usd",
      driver: "mock",
    });
    await repository.readRequest(REQUEST_ID);
    await repository.beginPaymentAttempt(REQUEST_ID, `force_pull:${REQUEST_ID}`);
    await repository.recordProviderReturned({
      requestId: REQUEST_ID,
      idempotencyKey: `force_pull:${REQUEST_ID}`,
      providerEventKey: `mock:event:${REQUEST_ID}`,
      providerPaymentRef: `mock:payment:${REQUEST_ID}`,
      outcome: "succeeded",
      amountCents: 1_900,
      currency: "usd",
    });
    await repository.markPaymentNeedsReview(REQUEST_ID, `force_pull:${REQUEST_ID}`);
    await repository.recordPaymentEvent({
      requestId: REQUEST_ID,
      providerEventKey: `mock:event:${REQUEST_ID}`,
      providerPaymentRef: `mock:payment:${REQUEST_ID}`,
      outcome: "succeeded",
      amountCents: 1_900,
      currency: "usd",
    });
    await repository.linkAnalysis(REQUEST_ID, ANALYSIS_RUN_ID);
    await repository.reservePull(CLIENT_ID, REQUEST_ID);
    await repository.commitPull(REQUEST_ID);
    await repository.releasePull(REQUEST_ID);
    assert.equal(clients, 1);
    assert.deepEqual(fake.calls, [
      {
        name: "paid_refresh_analysis_authorization",
        args: {
          p_client_id: CLIENT_ID,
          p_actor_profile_id: ACTOR_ID,
          p_idempotency_key: INPUT.idempotencyKey,
        },
      },
      { name: "resolve_paid_refresh_unfulfillable", args: { p_request_id: REQUEST_ID } },
      {
        name: "create_paid_refresh_request",
        args: {
          p_actor_profile_id: ACTOR_ID,
          p_client_id: CLIENT_ID,
          p_idempotency_key: INPUT.idempotencyKey,
          p_amount_cents: 1_900,
          p_currency: "usd",
          p_driver: "mock",
        },
      },
      { name: "read_paid_refresh_request", args: { p_request_id: REQUEST_ID } },
      {
        name: "begin_paid_refresh_payment_attempt",
        args: { p_request_id: REQUEST_ID, p_idempotency_key: `force_pull:${REQUEST_ID}` },
      },
      {
        name: "record_paid_refresh_provider_returned",
        args: {
          p_request_id: REQUEST_ID,
          p_idempotency_key: `force_pull:${REQUEST_ID}`,
          p_provider_event_key: `mock:event:${REQUEST_ID}`,
          p_provider_payment_ref: `mock:payment:${REQUEST_ID}`,
          p_outcome: "succeeded",
          p_amount_cents: 1_900,
          p_currency: "usd",
        },
      },
      {
        name: "mark_paid_refresh_payment_needs_review",
        args: { p_idempotency_key: `force_pull:${REQUEST_ID}`, p_request_id: REQUEST_ID },
      },
      {
        name: "record_paid_refresh_payment_event",
        args: {
          p_request_id: REQUEST_ID,
          p_provider_event_key: `mock:event:${REQUEST_ID}`,
          p_provider_payment_ref: `mock:payment:${REQUEST_ID}`,
          p_outcome: "succeeded",
          p_amount_cents: 1_900,
          p_currency: "usd",
        },
      },
      {
        name: "link_paid_refresh_analysis",
        args: { p_request_id: REQUEST_ID, p_analysis_run_id: ANALYSIS_RUN_ID },
      },
      {
        name: "reserve_paid_refresh_pull",
        args: { p_client_id: CLIENT_ID, p_request_id: REQUEST_ID, p_lease_seconds: 900 },
      },
      { name: "commit_paid_refresh_pull", args: { p_request_id: REQUEST_ID } },
      { name: "release_paid_refresh_pull", args: { p_request_id: REQUEST_ID } },
    ]);
  });

  it("rejects widened RPC rows", async () => {
    const fake = new FakeRpcClient();
    fake.rpc = async (name: string, args: Record<string, unknown>) => {
      fake.calls.push({ name, args });
      return { data: [{ ...databaseRequest(), provider_payload: {} }], error: null };
    };
    const repository = createPaidRefreshRepository({ createClient: () => fake as never });
    await assert.rejects(
      repository.createRequest({
        actorProfileId: ACTOR_ID,
        clientId: CLIENT_ID,
        idempotencyKey: INPUT.idempotencyKey,
        amountCents: 1_900,
        currency: "usd",
        driver: "mock",
      }),
      { message: "PAID_REFRESH_REPOSITORY_RESULT_INVALID" },
    );
  });

  it("preserves the database outstanding-request refusal as a closed domain error", async () => {
    for (const databaseError of [
      { code: "55000", message: "PAID_REFRESH_OUTSTANDING_REQUEST" },
      {
        code: "23505",
        details: "Key violates paid_refresh_one_open_stripe_payment_idx",
        message: "duplicate key value violates unique constraint",
      },
    ]) {
      const fake = new FakeRpcClient();
      fake.rpc = async (name: string, args: Record<string, unknown>) => {
        fake.calls.push({ name, args });
        return { data: null, error: databaseError as never };
      };
      const repository = createPaidRefreshRepository({ createClient: () => fake as never });
      await assert.rejects(
        repository.createRequest({
          actorProfileId: ACTOR_ID,
          clientId: CLIENT_ID,
          idempotencyKey: "another-key",
          amountCents: 1_900,
          currency: "usd",
          driver: "stripe",
        }),
        PaidRefreshOutstandingRequestError,
      );
    }
  });
});

interface HarnessOptions {
  authorized?: boolean;
  outcome?: OneOffPaymentOutcome;
  failStageOnce?: PaidRefreshTransition;
  capAllowed?: boolean;
  sourceAvailable?: boolean;
  amountCents?: number;
  dispatchStartedAt?: string;
  initialDispatching?: boolean;
  providerRecordFailsOnce?: boolean;
}

function analysisJob(): AnalysisJob {
  return {
    id: JOB_ID,
    job: "analysis.run",
    clientId: CLIENT_ID,
    sourceKind: "force_pull",
    sourceId: REQUEST_ID,
    analysisRunId: ANALYSIS_RUN_ID,
    trigger: "force_pull",
    subject: `client:${CLIENT_ID}`,
    window: `run:${ANALYSIS_RUN_ID}`,
    idempotencyKey: `analysis.run|client:${CLIENT_ID}|run:${ANALYSIS_RUN_ID}`,
    status: "queued",
    attemptCount: 0,
    availableAt: INSTANT,
    leaseOwner: null,
    leaseUntil: null,
    errorCode: null,
    createdAt: INSTANT,
    updatedAt: INSTANT,
  };
}

function createHarness(options: HarnessOptions = {}) {
  const trace: string[] = [];
  const paymentCalls: OneOffPaymentRequest[] = [];
  const repositoryPaymentCalls: RecordPaidRefreshPaymentInput[] = [];
  const analysisCalls: Array<{ clientId: string; sourceKind: string; sourceId: string; trigger: string }> = [];
  const capCalls: Array<{ clientId: string; cause: string; sourceId: string }> = [];
  const analysis = analysisJob();
  let request: PaidRefreshRequest | null = null;
  let state: PaidRefreshDurableState | null = null;
  const events: PaidRefreshPaymentEvent[] = [];
  let failedStage = false;
  let providerRecordFailed = false;
  let durableReadAfterCreate = false;
  let otherCapacityTaken = false;
  let reservation: "none" | "reserved" | "committed" | "released" | "expired" = "none";
  let paymentAttempt: PaidRefreshPaymentAttempt = {
    state: options.initialDispatching ? "dispatching" : "none",
    idempotencyKey: options.initialDispatching ? `force_pull:${REQUEST_ID}` : null,
    dispatchStartedAt: options.initialDispatching ? (options.dispatchStartedAt ?? INSTANT) : null,
    providerEventKey: null,
    providerPaymentRef: null,
    providerOutcome: null,
    providerReturnedAt: null,
  };

  // R5C-01. The fake models the authority the way the database does — one reading, shared by the
  // pre-charge check, the enqueue and the resolution — so a test can withdraw it at a chosen
  // instant and every consumer of it sees the same thing from then on.
  let authorized = options.authorized !== false;
  const remediations: Array<{ requestId: string; reason: string; state: string }> = [];

  function sweepUnfulfillable(reason: string): string | null {
    if (!state || !request) return null;
    if (state.state !== "paid" || state.analysisRunId) {
      return state.state === "unfulfillable" ? state.requestId : null;
    }
    trace.push("request:unfulfillable");
    state = { ...state, state: "unfulfillable" };
    request = { ...request, state: "unfulfillable" };
    remediations.push({ requestId: state.requestId, reason, state: "open" });
    reservation = "released";
    return state.requestId;
  }

  const repository: PaidRefreshRepository = {
    async analysisAuthorization() {
      if (authorized) return { authorized: true, unfulfillableRequestId: null };
      return {
        authorized: false,
        unfulfillableRequestId: sweepUnfulfillable("analysis_authorization_withdrawn"),
      };
    },
    async resolveUnfulfillable(requestId) {
      if (state?.state === "unfulfillable") return true;
      if (!state || state.state !== "paid" || state.analysisRunId) return false;
      if (authorized) return false;
      return sweepUnfulfillable("analysis_authorization_withdrawn") === requestId;
    },
    async createRequest(input: CreatePaidRefreshRequestInput) {
      trace.push("request:create");
      durableReadAfterCreate = false;
      if (request) {
        if (
          request.actorProfileId !== input.actorProfileId ||
          request.clientId !== input.clientId ||
          request.idempotencyKey !== input.idempotencyKey ||
          request.amountCents !== input.amountCents ||
          request.currency !== input.currency ||
          request.driver !== input.driver
        ) {
          throw new Error("PAID_REFRESH_REPLAY_MISMATCH");
        }
        return { ...request };
      }
      request = {
        id: REQUEST_ID,
        actorProfileId: input.actorProfileId,
        clientId: input.clientId,
        orgId: ORG_ID,
        idempotencyKey: input.idempotencyKey,
        amountCents: input.amountCents,
        currency: input.currency,
        driver: input.driver,
        state: "initiated",
        providerPaymentRef: null,
        analysisRunId: null,
        createdAt: INSTANT,
        updatedAt: INSTANT,
        paymentAttempt: { ...paymentAttempt },
      };
      state = {
        requestId: request.id,
        actorProfileId: request.actorProfileId,
        clientId: request.clientId,
        amountCents: request.amountCents,
        currency: request.currency,
        driver: request.driver,
        state: "initiated",
        providerPaymentRef: null,
        analysisRunId: null,
        paymentSucceeded: false,
        latestPaymentOutcome: null,
        paymentAttempt: { ...paymentAttempt },
      };
      return { ...request };
    },
    async beginPaymentAttempt(_requestId, idempotencyKey) {
      trace.push("payment:begin");
      if (paymentAttempt.idempotencyKey && paymentAttempt.idempotencyKey !== idempotencyKey) {
        throw new Error("PAID_REFRESH_PAYMENT_ATTEMPT_MISMATCH");
      }
      if (paymentAttempt.state === "none") {
        paymentAttempt = {
          ...paymentAttempt,
          state: "dispatching",
          idempotencyKey,
          dispatchStartedAt: options.dispatchStartedAt ?? INSTANT,
        };
      }
      if (state) state = { ...state, paymentAttempt: { ...paymentAttempt } };
      if (request) request = { ...request, paymentAttempt: { ...paymentAttempt } };
      return { ...paymentAttempt };
    },
    async recordProviderReturned(input) {
      trace.push("payment:provider-returned");
      if (options.providerRecordFailsOnce && !providerRecordFailed) {
        providerRecordFailed = true;
        throw new Error("PAID_REFRESH_PROVIDER_RESULT_RECORD_FAILED");
      }
      paymentAttempt = {
        ...paymentAttempt,
        state: "provider_returned",
        providerEventKey: input.providerEventKey,
        providerPaymentRef: input.providerPaymentRef,
        providerOutcome: input.outcome,
        providerReturnedAt: INSTANT,
      };
      if (state) state = { ...state, paymentAttempt: { ...paymentAttempt } };
      if (request) request = { ...request, paymentAttempt: { ...paymentAttempt } };
      return { ...paymentAttempt };
    },
    async markPaymentNeedsReview() {
      trace.push("payment:review");
      paymentAttempt = { ...paymentAttempt, state: "needs_review" };
      if (state) state = { ...state, paymentAttempt: { ...paymentAttempt } };
      if (request) request = { ...request, paymentAttempt: { ...paymentAttempt } };
      return true;
    },
    async readRequest() {
      trace.push("request:read");
      durableReadAfterCreate = true;
      return state ? { ...state } : null;
    },
    async recordPaymentEvent(input: RecordPaidRefreshPaymentInput) {
      trace.push("payment:persist");
      repositoryPaymentCalls.push({ ...input });
      let event = events.find((candidate) => candidate.providerEventKey === input.providerEventKey);
      if (!event) {
        event = {
          id: EVENT_ID,
          requestId: input.requestId,
          providerEventKey: input.providerEventKey,
          providerPaymentRef: input.providerPaymentRef,
          outcome: input.outcome,
          amountCents: input.amountCents,
          currency: input.currency,
          occurredAt: INSTANT,
        };
        events.push(event);
      }
      if (!state || !request) throw new Error("test state missing");
      state = {
        ...state,
        state: input.outcome === "succeeded"
          ? "paid"
          : input.outcome === "requires_action"
            ? "requires_action"
            : "payment_failed",
        providerPaymentRef: input.providerPaymentRef,
        paymentSucceeded: input.outcome === "succeeded",
        latestPaymentOutcome: input.outcome,
        paymentAttempt: { ...paymentAttempt, state: "recorded" },
      };
      paymentAttempt = { ...paymentAttempt, state: "recorded" };
      request = {
        ...request,
        state: state.state,
        providerPaymentRef: input.providerPaymentRef,
        paymentAttempt: { ...paymentAttempt },
      };
      return { ...event };
    },
    async linkAnalysis(requestId, analysisRunId) {
      trace.push("analysis:link");
      if (!request || !state || requestId !== request.id) throw new Error("test request missing");
      if (state.analysisRunId && state.analysisRunId !== analysisRunId) {
        throw new Error("PAID_REFRESH_ANALYSIS_MISMATCH");
      }
      state = { ...state, state: "queued", analysisRunId };
      request = { ...request, state: "queued", analysisRunId };
      return { ...request };
    },
    async reservePull(clientId, requestId) {
      trace.push("cap:reserve");
      capCalls.push({ clientId, cause: "force_pull", sourceId: requestId });
      if (options.capAllowed === false) return { allowed: false, reason: "count_window" };
      if (durableReadAfterCreate && (state?.paymentSucceeded || state?.state === "queued")) {
        reservation = "committed";
        return { allowed: true, reason: null };
      }
      if (otherCapacityTaken) {
        return { allowed: false, reason: "count_window" };
      }
      reservation = "reserved";
      return { allowed: true, reason: null };
    },
    async commitPull() {
      trace.push("cap:commit");
      reservation = "committed";
      return true;
    },
    async releasePull() {
      trace.push("cap:release");
      reservation = "released";
      return true;
    },
  };

  const paymentResult: OneOffPaymentResult & { providerPayload?: unknown } = {
    amountCents: options.amountCents ?? 1_900,
    currency: "usd",
    outcome: options.outcome ?? "succeeded",
    provider: "mock",
    providerEventKey: `mock:event:${REQUEST_ID}`,
    providerPaymentRef: `mock:payment:${REQUEST_ID}`,
    providerPayload: { mustNotCrossBoundary: true },
  };
  let providerLedger: OneOffPaymentResult | null = null;
  const adapter: OneOffBillingAdapter = {
    async createOneOffPayment(input) {
      trace.push("provider:call");
      paymentCalls.push({ ...input });
      providerLedger = { ...paymentResult };
      return { ...providerLedger };
    },
    async findOneOffPayment() {
      trace.push("provider:find");
      return providerLedger ? { ...providerLedger } : null;
    },
  };

  const deps = {
    env: ENABLED,
    repository,
    async readPaymentSource() {
      trace.push("source:read");
      if (options.sourceAvailable === false) throw new Error("source missing");
      return { customerRef: "mock_customer", paymentMethodRef: "mock_method" };
    },
    getBillingAdapter() {
      trace.push("provider:resolve");
      return adapter;
    },
    async enqueueAnalysis(input: typeof analysisCalls[number]) {
      trace.push("analysis:enqueue");
      analysisCalls.push({ ...input });
      capCalls.push({ clientId: input.clientId, cause: "force_pull", sourceId: input.sourceId });
      // `enqueue_analysis_job` raises on a withdrawn authority (R1C-15 / migration 260); it does
      // not return null. The fake raises the same way so the service cannot pass by classifying it.
      if (!authorized) throw new Error("ANALYSIS_NOT_AUTHORIZED");
      return analysis;
    },
    async afterTransition(stage: PaidRefreshTransition) {
      trace.push(`after:${stage}`);
      if (options.failStageOnce === stage && !failedStage) {
        failedStage = true;
        throw new Error(`TEST_CRASH_${stage}`);
      }
    },
    now: () => new Date(INSTANT),
  };
  return {
    deps,
    trace,
    paymentCalls,
    repositoryPaymentCalls,
    analysisCalls,
    capCalls,
    advancePayment(outcome: "succeeded" | "failed") {
      if (!providerLedger) throw new Error("test provider payment missing");
      providerLedger = {
        ...providerLedger,
        outcome,
        providerEventKey: `mock:${providerLedger.providerPaymentRef}:${outcome}`,
      };
    },
    expireReservationAndTakeCapacity() {
      reservation = "expired";
      otherCapacityTaken = true;
    },
    /** Withdraw analysis consent at a chosen instant, exactly as the consumer can mid-interval. */
    revokeAuthorization() {
      authorized = false;
    },
    readState: () => state,
    readReservation: () => reservation,
    readRemediations: () => remediations.map((entry) => ({ ...entry })),
  };
}

describe("paid refresh orchestration", () => {
  it("never reaches durable or payment work when Stripe is paired with mock or unset CRS", async () => {
    for (const crsDriver of [undefined, "mock"] as const) {
      const harness = createHarness();
      const result = await createPaidRefresh(INPUT, {
        ...harness.deps,
        env: { ...STRIPE_WITH_SANDBOX_CRS, CRS_DRIVER: crsDriver },
      });
      assert.deepEqual(result, { ok: false, reason: "dependency_disabled", requestId: null });
      assert.deepEqual(harness.trace, []);
      assert.equal(harness.paymentCalls.length, 0);
    }
  });

  it("never charges Stripe when the client has no provider-compatible CRS member", async () => {
    for (const memberRef of [null, "mock_clean_123", ""] as const) {
      const harness = createHarness();
      let memberReads = 0;
      const result = await createPaidRefresh(INPUT, {
        ...harness.deps,
        env: STRIPE_WITH_SANDBOX_CRS,
        async readCrsMemberRef(clientId) {
          memberReads += 1;
          assert.equal(clientId, CLIENT_ID);
          return memberRef;
        },
      });
      assert.deepEqual(result, { ok: false, reason: "analysis_unavailable", requestId: null });
      assert.equal(memberReads, 1);
      assert.deepEqual(harness.trace, []);
      assert.equal(harness.paymentCalls.length, 0);
    }
  });

  it("maps the serialized database guard without touching payment or analysis", async () => {
    const harness = createHarness();
    const repository = {
      ...harness.deps.repository,
      async createRequest() {
        throw new PaidRefreshOutstandingRequestError();
      },
    };
    const result = await createPaidRefresh(INPUT, { ...harness.deps, repository });
    assert.deepEqual(result, { ok: false, reason: "request_in_progress", requestId: null });
    assert.equal(harness.paymentCalls.length, 0);
    assert.equal(harness.analysisCalls.length, 0);
  });

  it("releases reserved capacity when the payment transition loses a concurrency race", async () => {
    const harness = createHarness();
    const repository = {
      ...harness.deps.repository,
      async beginPaymentAttempt() {
        throw new PaidRefreshOutstandingRequestError();
      },
    };
    const result = await createPaidRefresh(INPUT, { ...harness.deps, repository });
    assert.deepEqual(result, { ok: false, reason: "request_in_progress", requestId: REQUEST_ID });
    assert.equal(harness.paymentCalls.length, 0);
    assert.equal(harness.analysisCalls.length, 0);
    assert.equal(harness.readReservation(), "released");
  });

  it("refuses withdrawn analysis authorization before creating or charging", async () => {
    const harness = createHarness({ authorized: false });
    const result = await createPaidRefresh(INPUT, harness.deps);
    assert.deepEqual(result, { ok: false, reason: "analysis_unavailable", requestId: null });
    assert.deepEqual(harness.trace, []);
    assert.equal(harness.paymentCalls.length, 0);
  });

  it("fails every feature prerequisite before touching durable or provider state", async () => {
    for (const missing of ["FEATURE_PAID_REFRESH", "FEATURE_ANALYSIS", "FEATURE_ANCILLARY"] as const) {
      const harness = createHarness();
      const result = await createPaidRefresh(INPUT, {
        ...harness.deps,
        env: { ...ENABLED, [missing]: "" },
      });
      assert.deepEqual(result, { ok: false, reason: "dependency_disabled", requestId: null });
      assert.deepEqual(harness.trace, []);
    }
  });

  it("stops cap denial before payment source and provider work", async () => {
    const harness = createHarness({ capAllowed: false });
    const result = await createPaidRefresh(INPUT, harness.deps);
    assert.deepEqual(result, { ok: false, reason: "cap_denied", requestId: REQUEST_ID });
    assert.deepEqual(harness.trace, [
      "request:create",
      "after:request_created",
      "request:read",
      "cap:reserve",
    ]);
  });

  it("fails closed when the server-side payment source is absent", async () => {
    const harness = createHarness({ sourceAvailable: false });
    const result = await createPaidRefresh(INPUT, harness.deps);
    assert.deepEqual(result, {
      ok: false,
      reason: "payment_source_unavailable",
      requestId: REQUEST_ID,
    });
    assert.equal(harness.analysisCalls.length, 0);
    assert.equal(harness.paymentCalls.length, 0);
  });

  for (const outcome of ["failed", "requires_action"] as const) {
    it(`persists ${outcome} and never enqueues analysis`, async () => {
      const harness = createHarness({ outcome });
      const result = await createPaidRefresh(INPUT, harness.deps);
      assert.deepEqual(result, {
        ok: false,
        reason: outcome === "failed" ? "payment_failed" : "payment_requires_action",
        requestId: REQUEST_ID,
      });
      assert.equal(harness.repositoryPaymentCalls.length, 1);
      assert.equal(harness.analysisCalls.length, 0);
      assert.equal(harness.readReservation(), "released");
    });
  }

  it("advances one stable payment from action required to success and queues one analysis", async () => {
    const harness = createHarness({ outcome: "requires_action" });
    const first = await createPaidRefresh(INPUT, harness.deps);
    assert.deepEqual(first, {
      ok: false,
      reason: "payment_requires_action",
      requestId: REQUEST_ID,
    });

    harness.advancePayment("succeeded");
    const second = await createPaidRefresh(INPUT, harness.deps);
    const replay = await createPaidRefresh(INPUT, harness.deps);

    assert.equal(second.ok, true);
    assert.deepEqual(replay, second);
    assert.equal(harness.paymentCalls.length, 1, "the provider payment identity remains stable");
    assert.equal(harness.repositoryPaymentCalls.length, 2, "the provider progression is append-only");
    assert.deepEqual(harness.repositoryPaymentCalls.map((entry) => entry.outcome), [
      "requires_action",
      "succeeded",
    ]);
    assert.equal(harness.analysisCalls.length, 1, "the progression creates exactly one analysis tuple");
    assert.equal(harness.readReservation(), "committed");
  });

  it("keeps an abandoned action-required payment retryable without a new provider charge", async () => {
    const harness = createHarness({ outcome: "requires_action" });
    const first = await createPaidRefresh(INPUT, harness.deps);
    const second = await createPaidRefresh(INPUT, harness.deps);

    assert.deepEqual(second, first);
    assert.equal(harness.paymentCalls.length, 1);
    assert.equal(harness.repositoryPaymentCalls.length, 1);
    assert.equal(harness.analysisCalls.length, 0);
    assert.equal(harness.readReservation(), "released");
  });

  it("persists payment success before enqueue and repeats the exact cap tuple", async () => {
    const harness = createHarness();
    const result = await createPaidRefresh(INPUT, harness.deps);
    assert.deepEqual(result, {
      ok: true,
      status: "queued",
      requestId: REQUEST_ID,
      analysisRunId: ANALYSIS_RUN_ID,
      amountCents: 1_900,
      currency: "usd",
    });
    assert.ok(harness.trace.indexOf("payment:persist") < harness.trace.indexOf("analysis:enqueue"));
    assert.deepEqual(harness.capCalls, [
      { clientId: CLIENT_ID, cause: "force_pull", sourceId: REQUEST_ID },
      { clientId: CLIENT_ID, cause: "force_pull", sourceId: REQUEST_ID },
    ]);
    assert.equal(harness.readReservation(), "committed");
    assert.deepEqual(harness.analysisCalls, [{
      clientId: CLIENT_ID,
      sourceKind: "force_pull",
      sourceId: REQUEST_ID,
      trigger: "force_pull",
    }]);
    assert.deepEqual(Object.keys(harness.repositoryPaymentCalls[0]).sort(), [
      "amountCents", "currency", "outcome", "providerEventKey", "providerPaymentRef", "requestId",
    ]);
  });

  it("uses one governed env read for the durable charged amount", async () => {
    const harness = createHarness({ amountCents: 2_500 });
    let reads = 0;
    const result = await createPaidRefresh({ ...INPUT, expectedAmountCents: 2_500 }, {
      ...harness.deps,
      async resolveGovernedPrice(env) {
        reads += 1;
        return { ...env, FORCE_PULL_PRICE_CENTS: "2500" };
      },
    });
    assert.equal(reads, 1);
    assert.equal(result.ok && result.amountCents, 2_500);
    assert.equal(harness.paymentCalls[0].amountCents, 2_500);
  });

  for (const stage of ["provider_returned", "payment_recorded", "analysis_enqueued"] as const) {
    it(`resumes after a crash at ${stage} with stable external identities`, async () => {
      const harness = createHarness({ failStageOnce: stage });
      await assert.rejects(createPaidRefresh(INPUT, harness.deps), {
        message: `TEST_CRASH_${stage}`,
      });
      const result = await createPaidRefresh(INPUT, harness.deps);
      assert.equal(result.ok, true);
      assert.equal(new Set(harness.paymentCalls.map((call) => call.idempotencyKey)).size, 1);
      assert.equal(new Set(harness.paymentCalls.map((call) => call.requestId)).size, 1);
      assert.equal(new Set(harness.analysisCalls.map((call) => call.sourceId)).size, 1);
      assert.equal(harness.readState()?.analysisRunId, ANALYSIS_RUN_ID);
      assert.equal(harness.paymentCalls.length, 1, "crash recovery performs one provider create call");
    });
  }

  it("recovers paid work after reservation expiry without a second payment or analysis tuple", async () => {
    const harness = createHarness({ failStageOnce: "payment_recorded" });
    await assert.rejects(createPaidRefresh(INPUT, harness.deps), {
      message: "TEST_CRASH_payment_recorded",
    });
    assert.equal(harness.readState()?.paymentSucceeded, true);
    harness.expireReservationAndTakeCapacity();
    const retryStart = harness.trace.length;

    const result = await createPaidRefresh(INPUT, harness.deps);

    assert.equal(result.ok, true);
    assert.deepEqual(harness.trace.slice(retryStart, retryStart + 4), [
      "request:create",
      "after:request_created",
      "request:read",
      "cap:reserve",
    ]);
    assert.equal(harness.paymentCalls.length, 1);
    assert.equal(harness.analysisCalls.length, 1);
    assert.equal(new Set(harness.analysisCalls.map((call) => `${call.sourceKind}:${call.sourceId}`)).size, 1);
    assert.equal(harness.readReservation(), "committed");
  });

  it("reconciles a dispatching attempt after provider success without another create", async () => {
    const harness = createHarness({ providerRecordFailsOnce: true });
    await assert.rejects(createPaidRefresh(INPUT, harness.deps), {
      message: "PAID_REFRESH_PROVIDER_RESULT_RECORD_FAILED",
    });
    const result = await createPaidRefresh(INPUT, harness.deps);
    assert.equal(result.ok, true);
    assert.equal(harness.paymentCalls.length, 1, "dispatch recovery finds the existing provider payment");
    assert.equal(harness.trace.filter((entry) => entry === "provider:find").length, 1);
  });

  it("fails an unresolved dispatch closed after the idempotency retention window", async () => {
    const harness = createHarness({
      dispatchStartedAt: "2026-08-15T02:00:00.000Z",
      initialDispatching: true,
    });
    const result = await createPaidRefresh(INPUT, harness.deps);
    assert.deepEqual(result, {
      ok: false,
      reason: "payment_needs_review",
      requestId: REQUEST_ID,
    });
    assert.equal(harness.paymentCalls.length, 0);
    assert.equal(harness.readState()?.paymentAttempt.state, "needs_review");
  });

  it("returns the same queued identity without provider or analysis replay once linked", async () => {
    const harness = createHarness();
    const first = await createPaidRefresh(INPUT, harness.deps);
    const second = await createPaidRefresh(INPUT, harness.deps);
    assert.deepEqual(second, first);
    assert.equal(harness.paymentCalls.length, 1);
    assert.equal(harness.analysisCalls.length, 1);
  });

  it("rejects replay parameter drift before cap, payment, or enqueue", async () => {
    const harness = createHarness();
    await createPaidRefresh(INPUT, harness.deps);
    const before = harness.trace.length;
    // The consumer confirmed the new price, so the service comparison passes
    // and the durable request row is the guard that refuses the drift.
    await assert.rejects(
      createPaidRefresh(
        { ...INPUT, expectedAmountCents: 2_100 },
        { ...harness.deps, env: { ...ENABLED, FORCE_PULL_PRICE_CENTS: "2100" } },
      ),
      { message: "PAID_REFRESH_REPLAY_MISMATCH" },
    );
    assert.deepEqual(harness.trace.slice(before), ["request:create"]);
  });

  // R4B-01. Round 3 compared the quote in the route and left this service
  // resolving the governed price a second time, so a change landing between the
  // two reads charged an amount the consumer never saw and answered 202. On
  // `c2df7ae` this fails at `assert.equal(result.ok, false)`: the pre-fix tree
  // returns `{ ok: true, amountCents: 2_900 }` after one create call.
  it("refuses a governed price that moved after the displayed quote, before any durable or provider work", async () => {
    const harness = createHarness({ amountCents: 2_900 });
    const result = await createPaidRefresh(INPUT, {
      ...harness.deps,
      async resolveGovernedPrice(env) {
        return { ...env, FORCE_PULL_PRICE_CENTS: "2900" };
      },
    });

    assert.deepEqual(result, { ok: false, reason: "price_changed", requestId: null });
    assert.deepEqual(harness.trace, [], "no request row, no reservation, no provider call");
    assert.equal(harness.paymentCalls.length, 0);
    assert.equal(harness.analysisCalls.length, 0);
  });

  it("still accepts the quote the governed price actually resolves to", async () => {
    const harness = createHarness({ amountCents: 2_900 });
    const result = await createPaidRefresh({ ...INPUT, expectedAmountCents: 2_900 }, {
      ...harness.deps,
      async resolveGovernedPrice(env) {
        return { ...env, FORCE_PULL_PRICE_CENTS: "2900" };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.amountCents, 2_900);
    assert.equal(harness.paymentCalls[0].amountCents, 2_900);
  });

  // R4C-02. `reservePull` ran before the provider reconciliation, so a consumer
  // who completed the card challenge after their lease expired was charged and
  // then refused for capacity with zero provider lookups — and migration 285's
  // protected branch, which exists to give that request its capacity back,
  // never saw the durable success it keys off. On `c2df7ae` this fails at
  // `assert.equal(result.ok, true)`: the pre-fix tree returns
  // `{ ok: false, reason: "cap_denied" }` with `provider:find` count 0.
  it("reconciles a challenged payment that succeeded before refusing it for capacity", async () => {
    const harness = createHarness({ outcome: "requires_action" });
    const first = await createPaidRefresh(INPUT, harness.deps);
    assert.deepEqual(first, {
      ok: false,
      reason: "payment_requires_action",
      requestId: REQUEST_ID,
    });
    assert.equal(harness.readReservation(), "released");

    harness.expireReservationAndTakeCapacity();
    harness.advancePayment("succeeded");
    const retryStart = harness.trace.length;

    const result = await createPaidRefresh(INPUT, harness.deps);

    assert.equal(result.ok, true);
    assert.equal(
      harness.trace.slice(retryStart).filter((entry) => entry === "provider:find").length,
      1,
      "exactly one provider lookup",
    );
    assert.equal(harness.paymentCalls.length, 1, "zero new provider create calls");
    assert.equal(harness.readReservation(), "committed");
    assert.equal(harness.analysisCalls.length, 1);
    assert.equal(
      new Set(harness.analysisCalls.map((call) => `${call.sourceKind}:${call.sourceId}`)).size,
      1,
      "one analysis tuple",
    );
  });

  it("takes no capacity when the challenged payment has not advanced", async () => {
    const harness = createHarness({ outcome: "requires_action" });
    await createPaidRefresh(INPUT, harness.deps);
    harness.expireReservationAndTakeCapacity();
    const retryStart = harness.trace.length;

    const result = await createPaidRefresh(INPUT, harness.deps);

    assert.deepEqual(result, {
      ok: false,
      reason: "payment_requires_action",
      requestId: REQUEST_ID,
    });
    assert.equal(
      harness.trace.slice(retryStart).filter((entry) => entry === "provider:find").length,
      1,
    );
    assert.equal(harness.readReservation(), "expired", "no capacity is taken");
    assert.equal(harness.paymentCalls.length, 1);
    assert.equal(harness.analysisCalls.length, 0);
  });

  // Cap-before-charge is the correct ordering for a fresh attempt and the fix
  // must not relax it: a first request refused for capacity still reaches no
  // provider at all.
  it("keeps cap-before-charge for a fresh attempt", async () => {
    const harness = createHarness({ capAllowed: false });
    const result = await createPaidRefresh(INPUT, harness.deps);
    assert.deepEqual(result, { ok: false, reason: "cap_denied", requestId: REQUEST_ID });
    assert.equal(harness.trace.filter((entry) => entry.startsWith("provider:")).length, 0);
    assert.equal(harness.paymentCalls.length, 0);
  });

  it("refuses a confirmed amount that is not a positive whole number of cents", async () => {
    const harness = createHarness();
    for (const expectedAmountCents of [0, -1900, 1900.5, Number.NaN]) {
      await assert.rejects(
        createPaidRefresh({ ...INPUT, expectedAmountCents }, harness.deps),
        { message: "PAID_REFRESH_EXPECTED_AMOUNT_INVALID" },
      );
    }
    assert.deepEqual(harness.trace, []);
  });
});

// R5C-01 regression. Analysis consent can be withdrawn in the interval between the pre-charge
// authorization check and the enqueue, and on d6ae268 the money moved, the enqueue raised, and the
// request stayed `paid` with no run and no record that anything was owed. Replaying re-hit the
// refusal at the top of the function and returned before it ever reached the paid row.
//
// Named failing assertions on d6ae268:
//   - 'terminalizes a request whose authority is withdrawn after the charge': the call rejects with
//     ANALYSIS_NOT_AUTHORIZED instead of returning, and the request is still `paid`.
//   - 'recovers a crashed paid request on replay without charging again': the replay returns
//     `requestId: null` and the request is still `paid`.
//   - 'leaves no paid request inert whenever the authority is withdrawn': fails at the
//     `payment_recorded` stage with "withdrawing at payment_recorded left a paid and inert request".
describe("paid refresh — a paid request that can never be fulfilled", () => {
  /** Withdraw the authority at a chosen transition, the way a consumer can mid-interval. */
  function revokingAt(harness: ReturnType<typeof createHarness>, stage: PaidRefreshTransition) {
    return {
      ...harness.deps,
      async afterTransition(reached: PaidRefreshTransition) {
        await harness.deps.afterTransition(reached);
        if (reached === stage) harness.revokeAuthorization();
      },
    };
  }

  it("terminalizes a request whose authority is withdrawn after the charge", async () => {
    const harness = createHarness();
    const result = await createPaidRefresh(INPUT, revokingAt(harness, "payment_recorded"));

    assert.deepEqual(result, {
      ok: false,
      reason: "analysis_unavailable",
      requestId: REQUEST_ID,
    });
    assert.equal(harness.readState()?.state, "unfulfillable");
    assert.equal(harness.readState()?.analysisRunId, null);
    assert.deepEqual(harness.readRemediations(), [
      { requestId: REQUEST_ID, reason: "analysis_authorization_withdrawn", state: "open" },
    ]);
    // The consumer is not getting a pull, so the capacity goes back.
    assert.equal(harness.readReservation(), "released");
    assert.equal(harness.paymentCalls.length, 1);
  });

  it("recovers a crashed paid request on replay without charging again", async () => {
    const harness = createHarness({ failStageOnce: "payment_recorded" });
    await assert.rejects(createPaidRefresh(INPUT, harness.deps), {
      message: "TEST_CRASH_payment_recorded",
    });
    // The exact state the finding describes: charged, no run, nothing owed on record.
    assert.equal(harness.readState()?.state, "paid");
    assert.equal(harness.readState()?.analysisRunId, null);
    assert.deepEqual(harness.readRemediations(), []);

    harness.revokeAuthorization();
    const replay = await createPaidRefresh(INPUT, harness.deps);

    assert.deepEqual(replay, {
      ok: false,
      reason: "analysis_unavailable",
      requestId: REQUEST_ID,
    });
    assert.equal(harness.readState()?.state, "unfulfillable");
    assert.deepEqual(harness.readRemediations(), [
      { requestId: REQUEST_ID, reason: "analysis_authorization_withdrawn", state: "open" },
    ]);
    assert.equal(harness.paymentCalls.length, 1);

    // And the terminal state is idempotent: a third call opens nothing new and charges nothing.
    const third = await createPaidRefresh(INPUT, harness.deps);
    assert.deepEqual(third, replay);
    assert.equal(harness.readRemediations().length, 1);
    assert.equal(harness.paymentCalls.length, 1);
  });

  // The property, not the reproduction. The stages are read out of a successful run rather than
  // transcribed, so a transition added to the service is covered the moment it is emitted.
  it("leaves no paid request inert whenever the authority is withdrawn", async () => {
    const probe = createHarness();
    assert.ok((await createPaidRefresh(INPUT, probe.deps)).ok);
    const stages = probe.trace
      .filter((entry) => entry.startsWith("after:"))
      .map((entry) => entry.slice("after:".length) as PaidRefreshTransition);
    assert.ok(stages.length >= 4, "the successful path emits every transition under test");

    for (const stage of stages) {
      const harness = createHarness();
      try {
        await createPaidRefresh(INPUT, revokingAt(harness, stage));
      } catch (error) {
        assert.fail(`withdrawing at ${stage} threw instead of resolving: ${String(error)}`);
      }
      const final = harness.readState();
      assert.ok(final, `withdrawing at ${stage} lost the request`);
      assert.equal(
        final.state === "paid" && final.analysisRunId === null,
        false,
        `withdrawing at ${stage} left a paid and inert request`,
      );
      // Whenever money moved and no run exists, something is on record as owed.
      const stranded = final.state === "unfulfillable";
      assert.equal(
        harness.readRemediations().length,
        stranded ? 1 : 0,
        `withdrawing at ${stage} produced the wrong number of obligations`,
      );
      // Nothing is ever charged after the authority is gone.
      assert.ok(harness.paymentCalls.length <= 1, `withdrawing at ${stage} charged twice`);
    }
  });

  it("charges nothing when the authority is withdrawn before the provider call", async () => {
    const harness = createHarness();
    const result = await createPaidRefresh(INPUT, revokingAt(harness, "request_created"));

    assert.deepEqual(result, {
      ok: false,
      reason: "analysis_unavailable",
      requestId: REQUEST_ID,
    });
    assert.equal(harness.paymentCalls.length, 0);
    assert.equal(harness.readState()?.state, "initiated");
    assert.deepEqual(harness.readRemediations(), []);
    assert.equal(harness.readReservation(), "released");
  });
});
