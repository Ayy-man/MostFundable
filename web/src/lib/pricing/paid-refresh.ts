import "server-only";

import { enqueueAnalysisRun } from "@/lib/analysis/worker";
import {
  getOneOffBillingAdapter,
  readOneOffPaymentSource,
  type OneOffBillingAdapter,
  type OneOffPaymentSource,
} from "@/lib/billing";
import { createSupabaseMemberRefResolver } from "@/lib/crs/supabase-ports";
import { featureFlag, resolveDriver, type EnvSource } from "@/lib/env";

import {
  createPaidRefreshRepository,
  PaidRefreshOutstandingRequestError,
} from "./repository.ts";
import { resolvePrice } from "./resolver.ts";
import { resolveGovernedForcePullPrice } from "@/lib/admin/settings";

import type { AnalysisJob } from "@/lib/analysis/ports";
import type { EnqueueAnalysisRunInput } from "@/lib/analysis/worker";
import type { PaidRefreshDurableState, PaidRefreshRepository } from "./repository.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY = /^[^\s][\s\S]{0,126}[^\s]$|^[^\s]$/;

export interface CreatePaidRefreshInput {
  actorId: string;
  clientId: string;
  /**
   * The amount the consumer confirmed, in cents.
   *
   * R4B-01. Round 3 put the quote comparison in the route and left this
   * service resolving the governed price a second time, so an administrator
   * changing the price between the two reads meant the consumer confirmed one
   * amount, had another persisted into the payment request, and got a 202. The
   * route's read is now a cheap early rejection and this value is the
   * authority: the price is resolved once, here, and compared before anything
   * durable or outbound happens.
   */
  expectedAmountCents: number;
  idempotencyKey: string;
}

export type PaidRefreshResult =
  | {
      ok: true;
      status: "queued";
      requestId: string;
      analysisRunId: string;
      amountCents: number;
      currency: "usd";
    }
  | {
      ok: false;
      reason:
        | "dependency_disabled"
        | "price_changed"
        | "cap_denied"
        | "payment_source_unavailable"
        | "payment_failed"
        | "payment_needs_review"
        | "payment_requires_action"
        | "request_in_progress"
        | "analysis_unavailable";
      requestId: string | null;
    };

export type PaidRefreshTransition =
  | "request_created"
  | "provider_returned"
  | "payment_recorded"
  | "analysis_enqueued"
  | "analysis_linked"
  /** R5C-01. A paid request that reached its terminal state instead of an analysis run. */
  | "analysis_unfulfillable";

export interface PaidRefreshDependencies {
  env: EnvSource;
  repository: PaidRefreshRepository;
  /** Reads only the provider routing handle; report content never crosses this boundary. */
  readCrsMemberRef(clientId: string): Promise<string | null>;
  readPaymentSource(clientId: string): Promise<OneOffPaymentSource>;
  getBillingAdapter(): OneOffBillingAdapter;
  enqueueAnalysis(input: EnqueueAnalysisRunInput): Promise<AnalysisJob | null>;
  afterTransition(stage: PaidRefreshTransition): Promise<void>;
  resolveGovernedPrice(env: EnvSource): Promise<EnvSource>;
  now(): Date;
  /**
   * Called once the paid analysis run is durably linked to the request.
   *
   * It changes only how SOON the queued run executes, never whether it does, so it is deliberately
   * fire-and-forget and its failure is not an outcome the caller reports.
   */
  onAnalysisLinked(input: { analysisRunId: string; clientId: string }): void;
}

/**
 * Run the queued analysis immediately, on the mock driver only.
 *
 * The queue is drained by the quarter-hourly cron, so without this a consumer who has just paid
 * watches an unchanged page for up to fifteen minutes and the purchase has no visible outcome for
 * most of that time. This drains the one run this request created and nothing else.
 *
 * Four properties make it safe rather than a shortcut:
 *
 *   - `after` schedules it past the response, so it cannot delay or fail the request the consumer
 *     is waiting on, and everything durable has already been written by this point.
 *   - It is TARGETED at this analysis run and claims it under the same lease the cron uses, so a
 *     tick firing concurrently cannot process the row twice.
 *   - It is gated on the mock CRS driver. A real pull is billed per report and R5C-04's replay
 *     protection exists precisely to stop a second one, so the cron stays the only thing that
 *     schedules real work; the mock fabricates in-process, where a repeat costs nothing.
 *   - Every import is lazy, so nothing here reaches a request-scoped API at module load and the
 *     service stays constructible from literals in a test.
 *
 * The cron remains the authority: if this never runs, or throws, the next tick finds the same
 * queued row and does the work.
 */
function scheduleMockAnalysisRun(input: { analysisRunId: string; clientId: string }): void {
  void (async () => {
    try {
      const [{ after }, { resolveDriver: resolve }, worker] = await Promise.all([
        import("next/server"),
        import("@/lib/env"),
        import("@/lib/analysis/worker"),
      ]);
      if (resolve("crs") !== "mock") return;
      after(async () => {
        try {
          await worker.drainAnalysisQueue({
            maxJobs: 1,
            target: { analysisRunId: input.analysisRunId, clientId: input.clientId },
            workerId: worker.getAnalysisWorkerId(),
          });
        } catch {
          // The next tick re-claims the same queued row.
        }
      });
    } catch {
      // Outside a request scope — a test, or a job runner — there is nothing to schedule past.
    }
  })();
}

const memberRefResolver = createSupabaseMemberRefResolver();

const productionDependencies: PaidRefreshDependencies = {
  env: process.env,
  repository: createPaidRefreshRepository(),
  readCrsMemberRef: (clientId) => memberRefResolver.resolveForClient(clientId),
  readPaymentSource: readOneOffPaymentSource,
  getBillingAdapter: getOneOffBillingAdapter,
  enqueueAnalysis: enqueueAnalysisRun,
  async afterTransition() {},
  resolveGovernedPrice: resolveGovernedForcePullPrice,
  now: () => new Date(),
  onAnalysisLinked: scheduleMockAnalysisRun,
};

// Stripe retains idempotency results for at least this operating window. Once
// the durable dispatch is older, absence from metadata search is not proof that
// no payment was created, so recovery stops for review instead of creating.
const PAYMENT_IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1_000;

function paymentFromAttempt(
  state: Awaited<ReturnType<PaidRefreshRepository["beginPaymentAttempt"]>>,
  request: { amountCents: number; currency: "usd"; driver: "mock" | "stripe" },
) {
  if (!state.providerEventKey || !state.providerPaymentRef || !state.providerOutcome) {
    throw new Error("PAID_REFRESH_PROVIDER_RESULT_MISSING");
  }
  return {
    amountCents: request.amountCents,
    currency: request.currency,
    outcome: state.providerOutcome,
    provider: request.driver,
    providerEventKey: state.providerEventKey,
    providerPaymentRef: state.providerPaymentRef,
  };
}

function dependencies(overrides: Partial<PaidRefreshDependencies>): PaidRefreshDependencies {
  return { ...productionDependencies, ...overrides };
}

type CapRecovery =
  | { allowed: true; state: PaidRefreshDurableState }
  | {
      allowed: false;
      reason: "cap_denied" | "payment_failed" | "payment_needs_review" | "payment_requires_action";
    };

/**
 * Reconcile an already-created provider payment before refusing this request
 * for capacity (R4C-02).
 *
 * A consumer who completes the card challenge after their reservation lease
 * expired has been charged by the provider, and migration 285's protected
 * branch exists precisely to give that request its capacity back — but the
 * branch keys off a durable `succeeded` payment event, which cannot exist while
 * the provider lookup happens on the far side of the denial. So the lookup has
 * to run here, and only a same-reference, exact amount/currency/provider
 * success is appended; anything else persists nothing and reports what the
 * payment is actually doing.
 *
 * Cap-before-charge is untouched. Nothing in here creates a payment: the fresh
 * attempt still has to earn its reservation before any money moves.
 */
async function recoverCapacityFromExistingPayment(
  deps: PaidRefreshDependencies,
  input: CreatePaidRefreshInput,
  request: { amountCents: number; currency: "usd"; driver: "mock" | "stripe"; id: string },
  state: PaidRefreshDurableState,
): Promise<CapRecovery> {
  const attempt = state.paymentAttempt;
  if (attempt.state === "needs_review") {
    return { allowed: false, reason: "payment_needs_review" };
  }
  // `provider_returned` and `recorded` are both "the provider has an answer we
  // wrote down"; `dispatching` is "the provider may hold a payment we never
  // heard about". All three can carry a charge the consumer already made.
  const outstanding = attempt.state === "dispatching"
    || ((attempt.state === "recorded" || attempt.state === "provider_returned")
      && attempt.providerOutcome === "requires_action");
  if (!outstanding) return { allowed: false, reason: "cap_denied" };

  const idempotencyKey = attempt.idempotencyKey ?? `force_pull:${request.id}`;
  let advanced;
  try {
    advanced = await deps.getBillingAdapter().findOneOffPayment({
      idempotencyKey,
      requestId: request.id,
    });
  } catch {
    return { allowed: false, reason: "payment_failed" };
  }
  if (!advanced) {
    return {
      allowed: false,
      reason: attempt.providerOutcome === "requires_action" ? "payment_requires_action" : "cap_denied",
    };
  }
  if (
    advanced.amountCents !== request.amountCents
    || advanced.currency !== request.currency
    || advanced.provider !== request.driver
    || (attempt.providerPaymentRef !== null
      && advanced.providerPaymentRef !== attempt.providerPaymentRef)
  ) {
    throw new Error("PAID_REFRESH_PAYMENT_RESULT_MISMATCH");
  }
  if (advanced.outcome !== "succeeded") {
    return {
      allowed: false,
      reason: advanced.outcome === "requires_action" ? "payment_requires_action" : "payment_failed",
    };
  }

  const returned = await deps.repository.recordProviderReturned({
    requestId: request.id,
    idempotencyKey,
    providerEventKey: advanced.providerEventKey,
    providerPaymentRef: advanced.providerPaymentRef,
    outcome: advanced.outcome,
    amountCents: advanced.amountCents,
    currency: advanced.currency,
  });
  await deps.afterTransition("provider_returned");
  const payment = paymentFromAttempt(returned, request);
  await deps.repository.recordPaymentEvent({
    requestId: request.id,
    providerEventKey: payment.providerEventKey,
    providerPaymentRef: payment.providerPaymentRef,
    outcome: payment.outcome,
    amountCents: payment.amountCents,
    currency: payment.currency,
  });
  await deps.afterTransition("payment_recorded");

  // The success is durable now, so the reservation RPC's protected branch can
  // see the evidence it was written for.
  const reacquired = await deps.repository.reservePull(input.clientId, request.id);
  if (!reacquired.allowed) throw new Error("PAID_REFRESH_PAID_CAP_RECOVERY_FAILED");
  const refreshed = await deps.repository.readRequest(request.id);
  if (!refreshed?.paymentSucceeded) throw new Error("PAID_REFRESH_PAYMENT_NOT_DURABLE");
  return { allowed: true, state: refreshed };
}

function validateInput(input: CreatePaidRefreshInput): void {
  if (!UUID.test(input.actorId)) throw new Error("PAID_REFRESH_ACTOR_INVALID");
  if (!UUID.test(input.clientId)) throw new Error("PAID_REFRESH_CLIENT_INVALID");
  if (!IDEMPOTENCY.test(input.idempotencyKey)) {
    throw new Error("PAID_REFRESH_IDEMPOTENCY_INVALID");
  }
  if (!Number.isSafeInteger(input.expectedAmountCents) || input.expectedAmountCents <= 0) {
    throw new Error("PAID_REFRESH_EXPECTED_AMOUNT_INVALID");
  }
}

function disabled(env: EnvSource): boolean {
  return !featureFlag("FEATURE_PAID_REFRESH", env) ||
    !featureFlag("FEATURE_ANALYSIS", env) ||
    !featureFlag("FEATURE_ANCILLARY", env);
}

export async function createPaidRefresh(
  input: CreatePaidRefreshInput,
  overrides: Partial<PaidRefreshDependencies> = {},
): Promise<PaidRefreshResult> {
  validateInput(input);
  const deps = dependencies(overrides);
  if (disabled(deps.env)) {
    return { ok: false, reason: "dependency_disabled", requestId: null };
  }

  let driver;
  try {
    driver = resolveDriver("billing", deps.env);
  } catch {
    return { ok: false, reason: "dependency_disabled", requestId: null };
  }

  // Stripe is allowed to move money only when this exact client can be routed
  // to the real CRS adapter. This service-level preflight protects callers
  // that bypass the page and route availability checks, and it happens before
  // a request row, reservation, payment-source read, or provider call exists.
  if (driver === "stripe") {
    try {
      if (resolveDriver("crs", deps.env) !== "sandbox") {
        return { ok: false, reason: "dependency_disabled", requestId: null };
      }
    } catch {
      return { ok: false, reason: "dependency_disabled", requestId: null };
    }

    let memberRef: string | null;
    try {
      memberRef = await deps.readCrsMemberRef(input.clientId);
    } catch {
      return { ok: false, reason: "analysis_unavailable", requestId: null };
    }
    if (
      memberRef === null
      || memberRef.length === 0
      || memberRef !== memberRef.trim()
      || memberRef.startsWith("mock_")
    ) {
      return { ok: false, reason: "analysis_unavailable", requestId: null };
    }
  }

  // R5C-01. The authority read and the resolution of everything it strands are one call, because
  // the failure this replaces is exactly a refusal that returned before reaching the paid row it
  // had already been charged for. When a crash lost the interval between the provider's success and
  // the enqueue, this is where the request reaches its terminal state, and the id comes back so the
  // caller reports the request rather than a bare refusal.
  const authorization = await deps.repository.analysisAuthorization({
    clientId: input.clientId,
    actorProfileId: input.actorId,
    idempotencyKey: input.idempotencyKey,
  });
  if (!authorization.authorized) {
    return {
      ok: false,
      reason: "analysis_unavailable",
      requestId: authorization.unfulfillableRequestId,
    };
  }

  // One resolution, one comparison, and both of them before anything durable
  // or outbound exists. The route reads the governed price too, but only as a
  // cheap early rejection: this is the read whose value gets persisted into the
  // payment request, so this is the read the consumer's confirmed amount has to
  // agree with (R4B-01).
  const governedEnv = await deps.resolveGovernedPrice(deps.env);
  const price = resolvePrice("force_pull", { env: governedEnv });
  if (price.valueCents !== input.expectedAmountCents) {
    return { ok: false, reason: "price_changed", requestId: null };
  }
  let request;
  try {
    request = await deps.repository.createRequest({
      actorProfileId: input.actorId,
      clientId: input.clientId,
      idempotencyKey: input.idempotencyKey,
      amountCents: price.valueCents,
      currency: price.currency,
      driver,
    });
  } catch (error) {
    if (error instanceof PaidRefreshOutstandingRequestError) {
      return { ok: false, reason: "request_in_progress", requestId: null };
    }
    throw error;
  }
  // The other half of "one amount" is already durable: migration 151 raises
  // `PAID_REFRESH_REPLAY_MISMATCH` when a replay of this key arrives at a
  // different amount, so a request row's amount can never drift away from the
  // one compared above and everything below can charge `request.amountCents`.
  await deps.afterTransition("request_created");

  let state = await deps.repository.readRequest(request.id);
  if (!state) throw new Error("PAID_REFRESH_STATE_MISSING");

  // Read payment and queue state before asking for fresh capacity. The reserve
  // RPC uses the same durable row under lock to recover capacity for work that
  // has already been paid or linked, even when its original lease expired.
  const allowance = await deps.repository.reservePull(input.clientId, request.id);
  if (!allowance.allowed) {
    if (state.paymentSucceeded || state.state === "queued") {
      throw new Error("PAID_REFRESH_PAID_CAP_RECOVERY_FAILED");
    }
    const recovery = await recoverCapacityFromExistingPayment(deps, input, request, state);
    if (!recovery.allowed) {
      return { ok: false, reason: recovery.reason, requestId: request.id };
    }
    state = recovery.state;
  }

  if (state.state === "queued" && state.analysisRunId) {
    return {
      ok: true,
      status: "queued",
      requestId: state.requestId,
      analysisRunId: state.analysisRunId,
      amountCents: state.amountCents,
      currency: state.currency,
    };
  }

  if (!state.paymentSucceeded) {
    const idempotencyKey = `force_pull:${request.id}`;
    if (state.paymentAttempt.state === "needs_review") {
      return { ok: false, reason: "payment_needs_review", requestId: request.id };
    }

    const freshAttempt = state.paymentAttempt.state === "none";
    let source: OneOffPaymentSource | null = null;
    if (freshAttempt) {
      try {
        source = await deps.readPaymentSource(input.clientId);
      } catch {
        return { ok: false, reason: "payment_source_unavailable", requestId: request.id };
      }
    }

    let attempt;
    try {
      attempt = await deps.repository.beginPaymentAttempt(request.id, idempotencyKey);
    } catch (error) {
      if (error instanceof PaidRefreshOutstandingRequestError) {
        await deps.repository.releasePull(request.id);
        return { ok: false, reason: "request_in_progress", requestId: request.id };
      }
      throw error;
    }
    if (attempt.state === "needs_review") {
      return { ok: false, reason: "payment_needs_review", requestId: request.id };
    }
    let payment = attempt.state === "provider_returned" || attempt.state === "recorded"
      ? paymentFromAttempt(attempt, request)
      : null;

    if (attempt.state === "recorded" && payment?.outcome === "requires_action") {
      const adapter = deps.getBillingAdapter();
      let advanced;
      try {
        advanced = await adapter.findOneOffPayment({ idempotencyKey, requestId: request.id });
      } catch {
        return { ok: false, reason: "payment_failed", requestId: request.id };
      }
      if (
        advanced
        && (advanced.providerEventKey !== payment.providerEventKey
          || advanced.outcome !== payment.outcome)
      ) {
        if (
          advanced.providerPaymentRef !== payment.providerPaymentRef
          || advanced.amountCents !== request.amountCents
          || advanced.currency !== request.currency
          || advanced.provider !== request.driver
        ) {
          throw new Error("PAID_REFRESH_PAYMENT_RESULT_MISMATCH");
        }
        attempt = await deps.repository.recordProviderReturned({
          requestId: request.id,
          idempotencyKey,
          providerEventKey: advanced.providerEventKey,
          providerPaymentRef: advanced.providerPaymentRef,
          outcome: advanced.outcome,
          amountCents: advanced.amountCents,
          currency: advanced.currency,
        });
        payment = paymentFromAttempt(attempt, request);
        await deps.afterTransition("provider_returned");
      }
    }

    if (!payment && attempt.state === "dispatching") {
      const adapter = deps.getBillingAdapter();
      if (!freshAttempt) {
        try {
          payment = await adapter.findOneOffPayment({ idempotencyKey, requestId: request.id });
        } catch {
          return { ok: false, reason: "payment_failed", requestId: request.id };
        }
      }

      if (!payment) {
        const dispatchStarted = attempt.dispatchStartedAt
          ? Date.parse(attempt.dispatchStartedAt)
          : Number.NaN;
        if (!Number.isFinite(dispatchStarted)) {
          throw new Error("PAID_REFRESH_DISPATCH_TIME_INVALID");
        }
        if (deps.now().getTime() - dispatchStarted >= PAYMENT_IDEMPOTENCY_RETENTION_MS) {
          if (!await deps.repository.markPaymentNeedsReview(request.id, idempotencyKey)) {
            throw new Error("PAID_REFRESH_PAYMENT_REVIEW_FAILED");
          }
          return { ok: false, reason: "payment_needs_review", requestId: request.id };
        }
        if (!source) {
          try {
            source = await deps.readPaymentSource(input.clientId);
          } catch {
            return { ok: false, reason: "payment_source_unavailable", requestId: request.id };
          }
        }
        // R5C-01, the narrowing half. The authority was read before the price resolution, the
        // request row, the reservation and the payment-source lookup; re-reading it here leaves the
        // provider round trip as the only interval a revocation can land in, which is the part that
        // cannot be closed from this side. The recovery above is what covers that remainder.
        const stillAuthorized = await deps.repository.analysisAuthorization({
          clientId: input.clientId,
          actorProfileId: input.actorId,
          idempotencyKey: input.idempotencyKey,
        });
        if (!stillAuthorized.authorized) {
          await deps.repository.releasePull(request.id);
          return { ok: false, reason: "analysis_unavailable", requestId: request.id };
        }
        try {
          payment = await adapter.createOneOffPayment({
            clientId: input.clientId,
            requestId: request.id,
            customerRef: source.customerRef,
            paymentMethodRef: source.paymentMethodRef,
            amountCents: request.amountCents,
            currency: request.currency,
            idempotencyKey,
          });
        } catch {
          return { ok: false, reason: "payment_failed", requestId: request.id };
        }
      }

      if (
        payment.amountCents !== request.amountCents ||
        payment.currency !== request.currency ||
        payment.provider !== request.driver
      ) {
        throw new Error("PAID_REFRESH_PAYMENT_RESULT_MISMATCH");
      }
      attempt = await deps.repository.recordProviderReturned({
        requestId: request.id,
        idempotencyKey,
        providerEventKey: payment.providerEventKey,
        providerPaymentRef: payment.providerPaymentRef,
        outcome: payment.outcome,
        amountCents: payment.amountCents,
        currency: payment.currency,
      });
      payment = paymentFromAttempt(attempt, request);
      await deps.afterTransition("provider_returned");
    }

    if (!payment) throw new Error("PAID_REFRESH_PAYMENT_ATTEMPT_INVALID");

    if (
      payment.amountCents !== request.amountCents ||
      payment.currency !== request.currency ||
      payment.provider !== request.driver
    ) {
      throw new Error("PAID_REFRESH_PAYMENT_RESULT_MISMATCH");
    }
    if (attempt.state !== "recorded") {
      await deps.repository.recordPaymentEvent({
        requestId: request.id,
        providerEventKey: payment.providerEventKey,
        providerPaymentRef: payment.providerPaymentRef,
        outcome: payment.outcome,
        amountCents: payment.amountCents,
        currency: payment.currency,
      });
      await deps.afterTransition("payment_recorded");
    }

    if (payment.outcome !== "succeeded") {
      await deps.repository.releasePull(request.id);
      return {
        ok: false,
        reason: payment.outcome === "requires_action"
          ? "payment_requires_action"
          : "payment_failed",
        requestId: request.id,
      };
    }

    state = await deps.repository.readRequest(request.id);
    if (!state?.paymentSucceeded) throw new Error("PAID_REFRESH_PAYMENT_NOT_DURABLE");
  }

  // Everything from here on runs against a request that is already paid, so an enqueue that cannot
  // happen has to leave a terminal record rather than an inert row. `enqueueAnalysis` reports a
  // withdrawn authority by raising and a blocked cap by returning null, and a transient database
  // failure looks like the first of those, so the caller does not try to classify it: the resolution
  // re-derives the authority itself and refuses to terminalize anything still fulfillable (R5C-01).
  let analysis: AnalysisJob | null = null;
  try {
    analysis = await deps.enqueueAnalysis({
      clientId: input.clientId,
      sourceKind: "force_pull",
      sourceId: request.id,
      trigger: "force_pull",
    });
  } catch {
    analysis = null;
  }
  if (!analysis) {
    // A throw here is the right outcome, not a swallowed one: if the obligation cannot be recorded
    // the caller must not be told the charge simply did not go through.
    await deps.repository.resolveUnfulfillable(request.id);
    await deps.afterTransition("analysis_unfulfillable");
    return { ok: false, reason: "analysis_unavailable", requestId: request.id };
  }
  await deps.afterTransition("analysis_enqueued");
  const linked = await deps.repository.linkAnalysis(request.id, analysis.analysisRunId);
  if (!await deps.repository.commitPull(request.id)) {
    throw new Error("PAID_REFRESH_RESERVATION_NOT_FOUND");
  }
  await deps.afterTransition("analysis_linked");
  // Last, and only once the run is durably linked and its capacity committed: nothing may be
  // executed before the row that authorizes it is final.
  deps.onAnalysisLinked({ analysisRunId: analysis.analysisRunId, clientId: input.clientId });

  return {
    ok: true,
    status: "queued",
    requestId: linked.id,
    analysisRunId: analysis.analysisRunId,
    amountCents: linked.amountCents,
    currency: linked.currency,
  };
}
