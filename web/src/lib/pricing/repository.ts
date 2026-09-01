import "server-only";

import type { BillingDriver, OneOffPaymentOutcome } from "@/lib/billing";

type AdminClient = ReturnType<(typeof import("../supabase/admin.ts"))["createAdminClient"]>;

export type PaidRefreshRequestState =
  | "initiated"
  | "payment_failed"
  | "requires_action"
  | "paid"
  | "queued"
  /**
   * R5C-01. The money moved and the analysis can never be run for it. Terminal by construction:
   * `link_paid_refresh_analysis` requires `paid` and `advance_paid_refresh_payment` refuses any
   * state outside its own five, so nothing moves a request back out. Every transition into it
   * writes an open `paid_refresh_remediations` row, so no request can sit paid and inert.
   */
  | "unfulfillable";

export type PaidRefreshPaymentAttemptState =
  | "none"
  | "dispatching"
  | "provider_returned"
  | "recorded"
  | "needs_review";

export interface PaidRefreshPaymentAttempt {
  state: PaidRefreshPaymentAttemptState;
  idempotencyKey: string | null;
  dispatchStartedAt: string | null;
  providerEventKey: string | null;
  providerPaymentRef: string | null;
  providerOutcome: OneOffPaymentOutcome | null;
  providerReturnedAt: string | null;
}

export interface PaidRefreshRequest {
  id: string;
  actorProfileId: string;
  clientId: string;
  orgId: string;
  idempotencyKey: string;
  amountCents: number;
  currency: "usd";
  driver: BillingDriver;
  state: PaidRefreshRequestState;
  providerPaymentRef: string | null;
  analysisRunId: string | null;
  createdAt: string;
  updatedAt: string;
  paymentAttempt: PaidRefreshPaymentAttempt;
}

export interface PaidRefreshPaymentEvent {
  id: string;
  requestId: string;
  providerEventKey: string;
  providerPaymentRef: string;
  outcome: OneOffPaymentOutcome;
  amountCents: number;
  currency: "usd";
  occurredAt: string;
}

export interface PaidRefreshDurableState {
  requestId: string;
  actorProfileId: string;
  clientId: string;
  amountCents: number;
  currency: "usd";
  driver: BillingDriver;
  state: PaidRefreshRequestState;
  providerPaymentRef: string | null;
  analysisRunId: string | null;
  paymentSucceeded: boolean;
  latestPaymentOutcome: OneOffPaymentOutcome | null;
  paymentAttempt: PaidRefreshPaymentAttempt;
}

export interface CreatePaidRefreshRequestInput {
  actorProfileId: string;
  clientId: string;
  idempotencyKey: string;
  amountCents: number;
  currency: "usd";
  driver: BillingDriver;
}

export interface RecordPaidRefreshPaymentInput {
  requestId: string;
  providerEventKey: string;
  providerPaymentRef: string;
  outcome: OneOffPaymentOutcome;
  amountCents: number;
  currency: "usd";
}

export interface AnalysisAuthorizationInput {
  clientId: string;
  actorProfileId: string;
  idempotencyKey: string;
}

export interface AnalysisAuthorization {
  authorized: boolean;
  /**
   * Set only when authorization is refused and a request under this idempotency key had already
   * been paid, which is the crash case: the money moved, the enqueue never happened, and the
   * refusal that used to hide it now names the terminal state it just resolved.
   */
  unfulfillableRequestId: string | null;
}

export interface PaidRefreshRepository {
  /**
   * R5C-01. Reads the authority and, when it refuses, resolves everything that refusal strands —
   * one call, one transaction, so there is no new interval between deciding and recording.
   */
  analysisAuthorization(input: AnalysisAuthorizationInput): Promise<AnalysisAuthorization>;
  /**
   * Terminalize a request whose paid analysis cannot lawfully be enqueued. Returns false when the
   * request is not paid-and-inert or when the authority is still intact, which keeps a transient
   * enqueue failure retryable instead of burning the money.
   */
  resolveUnfulfillable(requestId: string): Promise<boolean>;
  createRequest(input: CreatePaidRefreshRequestInput): Promise<PaidRefreshRequest>;
  beginPaymentAttempt(requestId: string, idempotencyKey: string): Promise<PaidRefreshPaymentAttempt>;
  recordProviderReturned(input: RecordPaidRefreshPaymentInput & { idempotencyKey: string }): Promise<PaidRefreshPaymentAttempt>;
  markPaymentNeedsReview(requestId: string, idempotencyKey: string): Promise<boolean>;
  readRequest(requestId: string): Promise<PaidRefreshDurableState | null>;
  recordPaymentEvent(input: RecordPaidRefreshPaymentInput): Promise<PaidRefreshPaymentEvent>;
  linkAnalysis(requestId: string, analysisRunId: string): Promise<PaidRefreshRequest>;
  reservePull(clientId: string, requestId: string): Promise<{ allowed: boolean; reason: string | null }>;
  commitPull(requestId: string): Promise<boolean>;
  releasePull(requestId: string): Promise<boolean>;
}

/** Another idempotency key cannot create a second purchase while money or work is unresolved. */
export class PaidRefreshOutstandingRequestError extends Error {
  constructor() {
    super("PAID_REFRESH_OUTSTANDING_REQUEST");
    this.name = "PaidRefreshOutstandingRequestError";
  }
}

interface RepositoryOptions {
  createClient?: () => AdminClient | Promise<AdminClient>;
}

interface RpcClient {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

const REQUEST_KEYS = [
  "id", "actor_profile_id", "client_id", "org_id", "idempotency_key",
  "amount_cents", "currency", "driver", "state", "provider_payment_ref",
  "analysis_run_id", "created_at", "updated_at", "payment_attempt_state",
  "payment_idempotency_key", "payment_dispatch_started_at", "payment_provider_event_key",
  "payment_provider_payment_ref", "payment_provider_outcome", "payment_provider_returned_at",
] as const;
const EVENT_KEYS = [
  "id", "request_id", "provider_event_key", "provider_payment_ref", "outcome",
  "amount_cents", "currency", "occurred_at",
] as const;
const STATE_KEYS = [
  "request_id", "actor_profile_id", "client_id", "amount_cents", "currency",
  "driver", "state", "provider_payment_ref", "analysis_run_id", "payment_succeeded",
  "latest_payment_outcome", "payment_attempt_state", "payment_idempotency_key",
  "payment_dispatch_started_at", "payment_provider_event_key", "payment_provider_payment_ref",
  "payment_provider_outcome", "payment_provider_returned_at",
] as const;
const ATTEMPT_KEYS = [
  "payment_attempt_state", "payment_idempotency_key", "payment_dispatch_started_at",
  "payment_provider_event_key", "payment_provider_payment_ref", "payment_provider_outcome",
  "payment_provider_returned_at",
] as const;
const STATES = new Set<PaidRefreshRequestState>([
  "initiated", "payment_failed", "requires_action", "paid", "queued", "unfulfillable",
]);
const DRIVERS = new Set<BillingDriver>(["mock", "stripe"]);
const OUTCOMES = new Set<OneOffPaymentOutcome>(["succeeded", "requires_action", "failed"]);
const ATTEMPT_STATES = new Set<PaidRefreshPaymentAttemptState>([
  "none", "dispatching", "provider_returned", "recorded", "needs_review",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOutstandingRequestError(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.message === "PAID_REFRESH_OUTSTANDING_REQUEST") return true;
  const diagnostic = `${String(value.message ?? "")} ${String(value.details ?? "")}`;
  return value.code === "23505" && diagnostic.includes("paid_refresh_one_open_stripe_payment_idx");
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function mapAttempt(value: unknown): PaidRefreshPaymentAttempt {
  if (!isRecord(value) || !ATTEMPT_KEYS.every((key) => key in value)) {
    throw new Error("PAID_REFRESH_REPOSITORY_RESULT_INVALID");
  }
  if (
    !isString(value.payment_attempt_state)
    || !ATTEMPT_STATES.has(value.payment_attempt_state as PaidRefreshPaymentAttemptState)
    || !isNullableString(value.payment_idempotency_key)
    || !isNullableString(value.payment_dispatch_started_at)
    || !isNullableString(value.payment_provider_event_key)
    || !isNullableString(value.payment_provider_payment_ref)
    || !(value.payment_provider_outcome === null
      || (isString(value.payment_provider_outcome)
        && OUTCOMES.has(value.payment_provider_outcome as OneOffPaymentOutcome)))
    || !isNullableString(value.payment_provider_returned_at)
  ) {
    throw new Error("PAID_REFRESH_REPOSITORY_RESULT_INVALID");
  }
  return {
    state: value.payment_attempt_state as PaidRefreshPaymentAttemptState,
    idempotencyKey: value.payment_idempotency_key,
    dispatchStartedAt: value.payment_dispatch_started_at,
    providerEventKey: value.payment_provider_event_key,
    providerPaymentRef: value.payment_provider_payment_ref,
    providerOutcome: value.payment_provider_outcome as OneOffPaymentOutcome | null,
    providerReturnedAt: value.payment_provider_returned_at,
  };
}

function mapRequest(value: unknown): PaidRefreshRequest {
  if (!isRecord(value) || !hasExactKeys(value, REQUEST_KEYS)) {
    throw new Error("PAID_REFRESH_REPOSITORY_RESULT_INVALID");
  }
  if (
    !isString(value.id) || !isString(value.actor_profile_id) || !isString(value.client_id) ||
    !isString(value.org_id) || !isString(value.idempotency_key) ||
    !isPositiveInteger(value.amount_cents) || value.currency !== "usd" ||
    !isString(value.driver) || !DRIVERS.has(value.driver as BillingDriver) ||
    !isString(value.state) || !STATES.has(value.state as PaidRefreshRequestState) ||
    !isNullableString(value.provider_payment_ref) || !isNullableString(value.analysis_run_id) ||
    !isString(value.created_at) || !isString(value.updated_at)
  ) {
    throw new Error("PAID_REFRESH_REPOSITORY_RESULT_INVALID");
  }
  return {
    id: value.id,
    actorProfileId: value.actor_profile_id,
    clientId: value.client_id,
    orgId: value.org_id,
    idempotencyKey: value.idempotency_key,
    amountCents: value.amount_cents,
    currency: "usd",
    driver: value.driver as BillingDriver,
    state: value.state as PaidRefreshRequestState,
    providerPaymentRef: value.provider_payment_ref,
    analysisRunId: value.analysis_run_id,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
    paymentAttempt: mapAttempt(value),
  };
}

function mapEvent(value: unknown): PaidRefreshPaymentEvent {
  if (!isRecord(value) || !hasExactKeys(value, EVENT_KEYS)) {
    throw new Error("PAID_REFRESH_REPOSITORY_RESULT_INVALID");
  }
  if (
    !isString(value.id) || !isString(value.request_id) ||
    !isString(value.provider_event_key) || !isString(value.provider_payment_ref) ||
    !isString(value.outcome) || !OUTCOMES.has(value.outcome as OneOffPaymentOutcome) ||
    !isPositiveInteger(value.amount_cents) || value.currency !== "usd" ||
    !isString(value.occurred_at)
  ) {
    throw new Error("PAID_REFRESH_REPOSITORY_RESULT_INVALID");
  }
  return {
    id: value.id,
    requestId: value.request_id,
    providerEventKey: value.provider_event_key,
    providerPaymentRef: value.provider_payment_ref,
    outcome: value.outcome as OneOffPaymentOutcome,
    amountCents: value.amount_cents,
    currency: "usd",
    occurredAt: value.occurred_at,
  };
}

function mapState(value: unknown): PaidRefreshDurableState {
  if (!isRecord(value) || !hasExactKeys(value, STATE_KEYS)) {
    throw new Error("PAID_REFRESH_REPOSITORY_RESULT_INVALID");
  }
  if (
    !isString(value.request_id) || !isString(value.actor_profile_id) ||
    !isString(value.client_id) || !isPositiveInteger(value.amount_cents) ||
    value.currency !== "usd" || !isString(value.driver) ||
    !DRIVERS.has(value.driver as BillingDriver) || !isString(value.state) ||
    !STATES.has(value.state as PaidRefreshRequestState) ||
    !isNullableString(value.provider_payment_ref) || !isNullableString(value.analysis_run_id) ||
    typeof value.payment_succeeded !== "boolean" ||
    !(value.latest_payment_outcome === null ||
      (isString(value.latest_payment_outcome) &&
        OUTCOMES.has(value.latest_payment_outcome as OneOffPaymentOutcome)))
  ) {
    throw new Error("PAID_REFRESH_REPOSITORY_RESULT_INVALID");
  }
  return {
    requestId: value.request_id,
    actorProfileId: value.actor_profile_id,
    clientId: value.client_id,
    amountCents: value.amount_cents,
    currency: "usd",
    driver: value.driver as BillingDriver,
    state: value.state as PaidRefreshRequestState,
    providerPaymentRef: value.provider_payment_ref,
    analysisRunId: value.analysis_run_id,
    paymentSucceeded: value.payment_succeeded,
    latestPaymentOutcome: value.latest_payment_outcome as OneOffPaymentOutcome | null,
    paymentAttempt: mapAttempt(value),
  };
}

function oneRow<T>(data: unknown, map: (row: unknown) => T): T {
  if (!Array.isArray(data) || data.length !== 1) {
    throw new Error("PAID_REFRESH_REPOSITORY_RESULT_INVALID");
  }
  return map(data[0]);
}

async function createProductionClient(): Promise<AdminClient> {
  const { createAdminClient } = await import("../supabase/admin.ts");
  return createAdminClient();
}

export function createPaidRefreshRepository(
  options: RepositoryOptions = {},
): PaidRefreshRepository {
  let clientPromise: Promise<AdminClient> | null = null;
  const client = () => {
    if (!clientPromise) {
      clientPromise = Promise.resolve((options.createClient ?? createProductionClient)());
    }
    return clientPromise;
  };

  async function rpc<T>(
    name: string,
    args: Record<string, unknown>,
    code: string,
    map: (row: unknown) => T,
  ): Promise<T> {
    const result = await ((await client()) as unknown as RpcClient).rpc(name, args);
    if (result.error !== null) {
      if (isOutstandingRequestError(result.error)) {
        throw new PaidRefreshOutstandingRequestError();
      }
      throw new Error(code);
    }
    return oneRow(result.data, map);
  }

  return {
    async analysisAuthorization(input) {
      const result = await ((await client()) as unknown as RpcClient).rpc(
        "paid_refresh_analysis_authorization",
        {
          p_client_id: input.clientId,
          p_actor_profile_id: input.actorProfileId,
          p_idempotency_key: input.idempotencyKey,
        },
      );
      if (result.error !== null || !Array.isArray(result.data) || result.data.length !== 1) {
        throw new Error("PAID_REFRESH_AUTHORIZATION_READ_FAILED");
      }
      const row = result.data[0];
      if (
        !isRecord(row) || !hasExactKeys(row, ["authorized", "unfulfillable_request_id"])
        || typeof row.authorized !== "boolean"
        || !isNullableString(row.unfulfillable_request_id)
      ) {
        throw new Error("PAID_REFRESH_REPOSITORY_RESULT_INVALID");
      }
      return { authorized: row.authorized, unfulfillableRequestId: row.unfulfillable_request_id };
    },
    async resolveUnfulfillable(requestId) {
      const result = await ((await client()) as unknown as RpcClient).rpc(
        "resolve_paid_refresh_unfulfillable", { p_request_id: requestId },
      );
      if (result.error !== null || typeof result.data !== "boolean") {
        throw new Error("PAID_REFRESH_UNFULFILLABLE_RESOLUTION_FAILED");
      }
      return result.data;
    },
    async createRequest(input) {
      const result = await ((await client()) as unknown as RpcClient).rpc(
        "create_paid_refresh_request",
        {
          p_actor_profile_id: input.actorProfileId,
          p_client_id: input.clientId,
          p_idempotency_key: input.idempotencyKey,
          p_amount_cents: input.amountCents,
          p_currency: input.currency,
          p_driver: input.driver,
        },
      );
      if (result.error !== null) {
        if (isOutstandingRequestError(result.error)) {
          throw new PaidRefreshOutstandingRequestError();
        }
        throw new Error("PAID_REFRESH_REPOSITORY_CREATE_FAILED");
      }
      return oneRow(result.data, mapRequest);
    },
    beginPaymentAttempt(requestId, idempotencyKey) {
      return rpc("begin_paid_refresh_payment_attempt", {
        p_request_id: requestId,
        p_idempotency_key: idempotencyKey,
      }, "PAID_REFRESH_PAYMENT_ATTEMPT_BEGIN_FAILED", mapAttempt);
    },
    recordProviderReturned(input) {
      return rpc("record_paid_refresh_provider_returned", {
        p_request_id: input.requestId,
        p_idempotency_key: input.idempotencyKey,
        p_provider_event_key: input.providerEventKey,
        p_provider_payment_ref: input.providerPaymentRef,
        p_outcome: input.outcome,
        p_amount_cents: input.amountCents,
        p_currency: input.currency,
      }, "PAID_REFRESH_PROVIDER_RESULT_RECORD_FAILED", mapAttempt);
    },
    async markPaymentNeedsReview(requestId, idempotencyKey) {
      const result = await ((await client()) as unknown as RpcClient).rpc(
        "mark_paid_refresh_payment_needs_review",
        { p_idempotency_key: idempotencyKey, p_request_id: requestId },
      );
      if (result.error !== null || typeof result.data !== "boolean") {
        throw new Error("PAID_REFRESH_PAYMENT_REVIEW_FAILED");
      }
      return result.data;
    },
    async readRequest(requestId) {
      const result = await ((await client()) as unknown as RpcClient).rpc(
        "read_paid_refresh_request",
        { p_request_id: requestId },
      );
      if (result.error !== null) throw new Error("PAID_REFRESH_REPOSITORY_READ_FAILED");
      if (!Array.isArray(result.data)) throw new Error("PAID_REFRESH_REPOSITORY_RESULT_INVALID");
      if (result.data.length === 0) return null;
      return oneRow(result.data, mapState);
    },
    recordPaymentEvent(input) {
      return rpc("record_paid_refresh_payment_event", {
        p_request_id: input.requestId,
        p_provider_event_key: input.providerEventKey,
        p_provider_payment_ref: input.providerPaymentRef,
        p_outcome: input.outcome,
        p_amount_cents: input.amountCents,
        p_currency: input.currency,
      }, "PAID_REFRESH_REPOSITORY_PAYMENT_FAILED", mapEvent);
    },
    linkAnalysis(requestId, analysisRunId) {
      return rpc("link_paid_refresh_analysis", {
        p_request_id: requestId,
        p_analysis_run_id: analysisRunId,
      }, "PAID_REFRESH_REPOSITORY_LINK_FAILED", mapRequest);
    },
    async reservePull(clientId, requestId) {
      const result = await ((await client()) as unknown as RpcClient).rpc(
        "reserve_paid_refresh_pull",
        { p_client_id: clientId, p_request_id: requestId, p_lease_seconds: 900 },
      );
      if (result.error !== null || !Array.isArray(result.data) || result.data.length !== 1) {
        throw new Error("PAID_REFRESH_RESERVATION_FAILED");
      }
      const row = result.data[0];
      if (!isRecord(row) || !hasExactKeys(row, ["allowed", "reason"]) ||
          typeof row.allowed !== "boolean" || !isNullableString(row.reason)) {
        throw new Error("PAID_REFRESH_REPOSITORY_RESULT_INVALID");
      }
      return { allowed: row.allowed, reason: row.reason };
    },
    async commitPull(requestId) {
      const result = await ((await client()) as unknown as RpcClient).rpc(
        "commit_paid_refresh_pull", { p_request_id: requestId },
      );
      if (result.error !== null || typeof result.data !== "boolean") {
        throw new Error("PAID_REFRESH_RESERVATION_COMMIT_FAILED");
      }
      return result.data;
    },
    async releasePull(requestId) {
      const result = await ((await client()) as unknown as RpcClient).rpc(
        "release_paid_refresh_pull", { p_request_id: requestId },
      );
      if (result.error !== null || typeof result.data !== "boolean") {
        throw new Error("PAID_REFRESH_RESERVATION_RELEASE_FAILED");
      }
      return result.data;
    },
  };
}
