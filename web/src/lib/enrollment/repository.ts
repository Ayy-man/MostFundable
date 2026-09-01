import "server-only";

import { randomUUID } from "node:crypto";

// This is lane B's only admin-client import. The merged auth session also owns
// one foundation import; plan 03-15 audits that the enrollment tree has no
// second bypass-RLS entry point.
import { createAdminClient } from "@/lib/supabase/admin";

import type { SessionProfile } from "@/lib/auth/session";
import type { ParsedWebhook } from "@/lib/billing/types";
import { isAuthorized } from "@/lib/enrollment/consents";
import { AppError } from "@/lib/enrollment/errors";
import type {
  ConsentKind,
  EnrollmentSummary,
  EnrollmentStatus,
  EnrollmentView,
  MilestoneKind,
} from "@/lib/enrollment/types";
import { MAX_IDV_ATTEMPTS } from "@/lib/idv/config";
import type { IdvState } from "@/lib/idv/types";

type DatabaseFailure = { code?: string | null };
type DatabaseResponse<T> = PromiseLike<{
  count?: number | null;
  data: T | null;
  error: DatabaseFailure | null;
}>;

type EnrollmentQuery = DatabaseResponse<unknown> & {
  eq(column: string, value: string): EnrollmentQuery;
  insert(values: Record<string, unknown>): EnrollmentQuery;
  limit(count: number): EnrollmentQuery;
  maybeSingle(): DatabaseResponse<unknown>;
  order(column: string, options: { ascending: boolean }): EnrollmentQuery;
  select(
    columns: string,
    options?: { count?: "exact"; head?: boolean },
  ): EnrollmentQuery;
  update(values: Record<string, unknown>): EnrollmentQuery;
  upsert(values: Record<string, unknown>): EnrollmentQuery;
};

type EnrollmentAdmin = {
  from(table: string): EnrollmentQuery;
  rpc(name: string, args: Record<string, unknown>): DatabaseResponse<unknown>;
};

export type RepositoryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AppError };

export type SubscriptionState = {
  /** Migration 332's retained provider reference for the in-flight attempt. */
  attemptSubscriptionRef: string | null;
  currency: string;
  customerRef: string;
  idempotencyKey: string;
  operationId: string | null;
  operationState: "dispatching" | "none" | "provider_returned" | "review" | "settled";
  paymentMethodRef: string;
  priceCents: number;
  priceRef: string;
  provider: string;
  setupIntentRef: string;
  status: "authorized" | "active" | "cancelled" | "review_required";
  subscriptionAttemptAt: string | null;
  subscriptionRef: string | null;
};

/**
 * The explicit verdict migration 355 returns. `cancel_pending` means the
 * provider result was retained and a durable cancellation obligation exists;
 * the caller must not treat it as activation.
 */
export type SettlementVerdict = {
  reasonCode: "activated" | "consent_withdrawn" | "enrollment_cancelled" | "replay";
  subscriptionRef: string | null;
  verdict: "cancel_pending" | "settled";
};

export type CancellationOutcome = {
  providerCancelRef: string | null;
};

export type ConsumerSubscriptionAttempt = {
  amountCents: number | null;
  currency: string | null;
  operationId: string;
  state: SubscriptionState["operationState"];
  status: string | null;
  subscriptionRef: string | null;
};

export type EnrollmentState = {
  attemptsUsed: number;
  /**
   * The client's own `business_name`, off the `clients` row this read already
   * joins. Carried so the mock IDV quiz can grade "Which business is associated
   * with this application?" against the consumer's own company instead of the
   * fixture persona's — see `src/lib/idv/config.ts`.
   */
  businessName: string | null;
  clientId: string;
  identity: { email: string; fullName: string; phone: string };
  /** Encrypted CRS SMFA continuation; absent for mock and completed sessions. */
  idvContinuation?: string | null;
  maxAttempts: number;
  memberRef: string | null;
  subscription: SubscriptionState | null;
  view: EnrollmentView;
};

export type EnrollmentE2eEvidence = {
  activeSubscriptionCount: number;
  auditActions: string[];
  consents: Array<{
    action: "granted" | "revoked";
    id: string;
    kind: ConsentKind;
    signedAt: string;
    textVersion: string;
  }>;
  enrollment: {
    enrollmentId: string;
    parkedUntil: string | null;
    status: EnrollmentStatus;
  };
  esignatures: Array<{
    id: string;
    signedAt: string;
    textVersion: string;
  }>;
  milestones: Array<{ kind: MilestoneKind }>;
  revocations: Array<{
    consentId: string;
    kind: ConsentKind;
    revokedAt: string;
  }>;
  subscriptionCount: number;
  subscriptions: Array<{
    status: "authorized" | "active" | "cancelled" | "failed" | "review_required";
    subscriptionRef: string | null;
  }>;
};

export type WebhookEventStatus = "processed" | "ignored" | "failed";

export type ConsumerSubscriptionEventVerdict = {
  applied: boolean;
  reasonCode: "applied" | "duplicate_event" | "equal_timestamp" | "older_event" | "terminal_closed";
};

export type ApplyConsumerSubscriptionEventInput = {
  enrollmentId: string;
  eventId: string;
  eventType: string;
  occurredAt: string;
  providerStatus: string | null;
  source?: "provider.snapshot" | "stripe";
};

export interface EnrollmentWebhookRepository {
  applySubscriptionEvent(input: ApplyConsumerSubscriptionEventInput): Promise<RepositoryResult<ConsumerSubscriptionEventVerdict>>;
  claimWebhookEvent(event: ParsedWebhook, leaseOwner: string): Promise<RepositoryResult<boolean>>;
  markWebhookEvent(eventId: string, leaseOwner: string, status: WebhookEventStatus, errorCode?: string): Promise<RepositoryResult<void>>;
  readWebhookEnrollment(event: ParsedWebhook): Promise<RepositoryResult<EnrollmentState | null>>;
  settleSub(enrollmentId: string, actorId: string | null, subscriptionRef: string): Promise<RepositoryResult<SettlementVerdict>>;
}

export async function applySubscriptionEvent(
  input: ApplyConsumerSubscriptionEventInput,
): Promise<RepositoryResult<ConsumerSubscriptionEventVerdict>> {
  const { data, error } = await adminClient().rpc("consumer_subscription_apply_event", {
    p_enrollment_id: input.enrollmentId,
    p_event_id: input.eventId,
    p_event_type: input.eventType,
    p_occurred_at: input.occurredAt,
    p_provider_status: input.providerStatus,
    p_source: input.source ?? "stripe",
  });
  if (error) return { ok: false, error: databaseError(error) };
  const row = data as { applied?: unknown; reason_code?: unknown } | null;
  const reasons = new Set(["applied", "duplicate_event", "equal_timestamp", "older_event", "terminal_closed"]);
  return typeof row?.applied === "boolean" && typeof row.reason_code === "string" && reasons.has(row.reason_code)
    ? { ok: true, value: { applied: row.applied, reasonCode: row.reason_code as ConsumerSubscriptionEventVerdict["reasonCode"] } }
    : { ok: false, error: new AppError("unexpected", "The subscription event returned no result.") };
}

export type BeginEnrollmentInput = {
  actorId: string;
  affiliateReferralSlug?: string;
  agreementVersion: string;
  analysisVersion: string;
  clientId: string;
  draftId: string;
  ip: string;
  monitoringVersion: string;
  signerName: string;
  typedSignature: string;
  userAgent: string;
};

export type ReauthorizeConsentInput = {
  actorId: string;
  draftId: string;
  enrollmentId: string;
  ip: string;
  kind: ConsentKind;
  signerName: string;
  textVersion: string;
  typedSignature: string;
  userAgent: string;
};

export type ReauthorizeConsentRecord = {
  consentId: string;
  replayed: boolean;
  signedAt: string;
};

export type RecordSetupInput = {
  actorId: string;
  clientId: string;
  customerRef: string;
  enrollmentId: string;
  idempotencyKey: string;
  paymentMethodRef: string;
  priceCents: number;
  priceRef: string;
  provider: string;
  setupIntentRef: string;
};

export type IdvStartedInput = {
  actorId: string;
  clientId: string;
  driver: string;
  enrollmentId: string;
  kind: string;
  maxAttempts: number;
  memberRef: string;
  continuation?: string | null;
};

export type IdvSettledInput = {
  actorId: string;
  enrollmentId: string;
  lockedUntil: string | null;
  nextState: IdvState;
  outcome: string;
  parkedUntil: string | null;
};

export type ReviewSubInput = {
  actorId: string;
  amountCents: number;
  currency: string;
  enrollmentId: string;
  providerStatus: string;
  subscriptionRef: string;
};

export interface EnrollmentRepository {
  beginSubscriptionAttempt(enrollmentId: string, operationId: string): Promise<RepositoryResult<ConsumerSubscriptionAttempt>>;
  beginEnrollment(input: BeginEnrollmentInput): Promise<RepositoryResult<{ enrollmentId: string; esignatureId: string }>>;
  cancelSub(enrollmentId: string, actorId: string, reason: string): Promise<RepositoryResult<CancellationOutcome>>;
  completeProviderCancel(enrollmentId: string, subscriptionRef: string): Promise<RepositoryResult<void>>;
  idvSettled(input: IdvSettledInput): Promise<RepositoryResult<void>>;
  idvStarted(input: IdvStartedInput): Promise<RepositoryResult<void>>;
  readEnrollmentState(enrollmentId: string, actor: SessionProfile): Promise<RepositoryResult<EnrollmentState>>;
  reauthorizeConsent(input: ReauthorizeConsentInput): Promise<RepositoryResult<ReauthorizeConsentRecord>>;
  recordMilestone(clientId: string, kind: MilestoneKind, actorId: string): Promise<RepositoryResult<void>>;
  recordSetup(input: RecordSetupInput): Promise<RepositoryResult<void>>;
  recordSubscriptionProviderReturned(input: { enrollmentId: string; operationId: string; result: { amountCents: number; currency: string; status: string; subscriptionRef: string } }): Promise<RepositoryResult<ConsumerSubscriptionAttempt>>;
  reviewSub(input: ReviewSubInput): Promise<RepositoryResult<void>>;
  resolveConsumerClient(actor: SessionProfile): Promise<RepositoryResult<string>>;
  revokeConsent(clientId: string, kind: ConsentKind, actorId: string): Promise<RepositoryResult<void>>;
  settleSub(enrollmentId: string, actorId: string, subscriptionRef: string): Promise<RepositoryResult<SettlementVerdict>>;
}

function adminClient(): EnrollmentAdmin {
  return createAdminClient() as unknown as EnrollmentAdmin;
}

function databaseError(error: DatabaseFailure): AppError {
  if (error.code === "23514") {
    return new AppError(
      "settlement_blocked",
      "The enrollment state does not permit subscription settlement.",
    );
  }
  if (error.code === "23505") {
    return new AppError("conflict", "The requested record already exists.");
  }
  if (error.code === "42501") {
    return new AppError("forbidden", "The requested write is not permitted.");
  }
  return new AppError("unexpected", "The database request could not be completed.");
}

function result<T>(data: T | null, error: DatabaseFailure | null): RepositoryResult<T> {
  if (error) return { ok: false, error: databaseError(error) };
  if (data === null) {
    return { ok: false, error: new AppError("not_found", "Enrollment not found.") };
  }
  return { ok: true, value: data };
}

function voidResult(error: DatabaseFailure | null): RepositoryResult<void> {
  return error
    ? { ok: false, error: databaseError(error) }
    : { ok: true, value: undefined };
}

function subscriptionAttempt(data: unknown): RepositoryResult<ConsumerSubscriptionAttempt> {
  const value = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  const states = new Set(["none", "dispatching", "provider_returned", "settled", "review"]);
  if (!value || typeof value.operation_id !== "string" || typeof value.operation_state !== "string" || !states.has(value.operation_state)) {
    return { ok: false, error: new AppError("unexpected", "The subscription attempt returned no record.") };
  }
  return { ok: true, value: {
    amountCents: typeof value.attempt_provider_amount_cents === "number" ? value.attempt_provider_amount_cents : null,
    currency: typeof value.attempt_provider_currency === "string" ? value.attempt_provider_currency : null,
    operationId: value.operation_id,
    state: value.operation_state as ConsumerSubscriptionAttempt["state"],
    status: typeof value.attempt_provider_status === "string" ? value.attempt_provider_status : null,
    subscriptionRef: typeof value.attempt_provider_subscription_ref === "string" ? value.attempt_provider_subscription_ref : null,
  } };
}

export async function beginSubscriptionAttempt(
  enrollmentId: string,
  operationId: string,
): Promise<RepositoryResult<ConsumerSubscriptionAttempt>> {
  const { data, error } = await adminClient().rpc("begin_consumer_subscription_attempt", {
    p_enrollment_id: enrollmentId,
    p_operation_id: operationId,
  });
  return error ? { ok: false, error: databaseError(error) } : subscriptionAttempt(data);
}

export async function recordSubscriptionProviderReturned(input: {
  enrollmentId: string;
  operationId: string;
  result: { amountCents: number; currency: string; status: string; subscriptionRef: string };
}): Promise<RepositoryResult<ConsumerSubscriptionAttempt>> {
  const { data, error } = await adminClient().rpc("record_consumer_subscription_provider_returned", {
    p_amount_cents: input.result.amountCents,
    p_currency: input.result.currency,
    p_enrollment_id: input.enrollmentId,
    p_operation_id: input.operationId,
    p_status: input.result.status,
    p_subscription_ref: input.result.subscriptionRef,
  });
  return error ? { ok: false, error: databaseError(error) } : subscriptionAttempt(data);
}

export async function resolveConsumerClient(
  actor: SessionProfile,
): Promise<RepositoryResult<string>> {
  if (actor.role !== "consumer") {
    return { ok: false, error: new AppError("not_found", "Client not found.") };
  }

  const { data, error } = await adminClient()
    .from("clients")
    .select("id")
    .eq("consumer_profile_id", actor.id)
    .maybeSingle();

  if (error) return { ok: false, error: databaseError(error) };
  const row = data as { id?: unknown } | null;
  return typeof row?.id === "string"
    ? { ok: true, value: row.id }
    : { ok: false, error: new AppError("not_found", "Client not found.") };
}

/**
 * Demo-only: is this consumer one of the seeded personas the reset may act on? Read through the
 * admin client because the session carries no address; compared case-insensitively against the
 * closed list the caller passes, which the route derives from `DEMO_CONSUMER_PERSONA_EMAILS`.
 */
export async function consumerIsDemoPersona(
  actor: SessionProfile,
  allowedEmails: readonly string[],
): Promise<boolean> {
  if (actor.role !== "consumer") return false;
  const { data, error } = await adminClient()
    .from("profiles")
    .select("email")
    .eq("id", actor.id)
    .maybeSingle();
  if (error) return false;
  const email = (data as { email?: unknown } | null)?.email;
  return typeof email === "string" && allowedEmails.includes(email.toLowerCase());
}

/**
 * Demo-only: archive the consumer's current client and bind the profile to a fresh Onboarding
 * client, so the enrollment beat can be walked again. Migration 392 does the whole rebinding in one
 * transaction and erases nothing; it refuses any profile outside `allowedEmails` itself, so the
 * list is passed through rather than trusted to have been checked here.
 */
export async function resetDemoConsumerWorkspace(
  actor: SessionProfile,
  allowedEmails: readonly string[],
): Promise<RepositoryResult<string>> {
  const { data, error } = await adminClient().rpc("demo_reset_consumer_workspace", {
    p_allowed_emails: [...allowedEmails],
    p_profile_id: actor.id,
  });
  if (error) {
    if (error.code === "42501") {
      return { ok: false, error: new AppError("not_found", "Client not found.") };
    }
    return { ok: false, error: databaseError(error) };
  }
  return typeof data === "string"
    ? { ok: true, value: data }
    : { ok: false, error: new AppError("not_found", "Client not found.") };
}

export async function beginEnrollment(
  input: BeginEnrollmentInput,
  suppliedClient?: EnrollmentAdmin,
): Promise<RepositoryResult<{ enrollmentId: string; esignatureId: string }>> {
  const client = suppliedClient ?? adminClient();
  const { data, error } = await client.rpc("enrollment_begin", {
    p_actor_id: input.actorId,
    p_aff: input.affiliateReferralSlug ?? null,
    p_agreement_version: input.agreementVersion,
    p_analysis_version: input.analysisVersion,
    p_client_id: input.clientId,
    p_draft_id: input.draftId,
    p_ip: input.ip,
    p_monitoring_version: input.monitoringVersion,
    p_signer_name: input.signerName,
    p_typed_signature: input.typedSignature,
    p_user_agent: input.userAgent,
  });
  if (error?.code === "23505") {
    // The RPC is idempotent by draft id, but a browser reload creates a new draft id. The client
    // still has exactly one enrollment, so recover that durable row and let the service resume any
    // missing provider steps. The actor-scoped read immediately after this call remains the
    // authorization boundary; this lookup only identifies the row by the already-resolved client.
    const existing = await client
      .from("enrollments")
      .select("id, esig_doc_id")
      .eq("client_id", input.clientId)
      .maybeSingle();
    if (existing.error) return { ok: false, error: databaseError(existing.error) };
    const row = existing.data as { esig_doc_id?: unknown; id?: unknown } | null;
    if (typeof row?.id === "string" && typeof row.esig_doc_id === "string") {
      return {
        ok: true,
        value: { enrollmentId: row.id, esignatureId: row.esig_doc_id },
      };
    }
  }
  if (error) return { ok: false, error: databaseError(error) };
  const row = Array.isArray(data) ? data[0] : data;
  const value = row as { enrollment_id?: unknown; esignature_id?: unknown } | null;
  return typeof value?.enrollment_id === "string" && typeof value.esignature_id === "string"
    ? { ok: true, value: { enrollmentId: value.enrollment_id, esignatureId: value.esignature_id } }
    : { ok: false, error: new AppError("unexpected", "Enrollment creation returned no record.") };
}

export async function recordSetup(input: RecordSetupInput): Promise<RepositoryResult<void>> {
  const { error } = await adminClient().rpc("enrollment_record_setup", {
    p_actor_id: input.actorId,
    p_client_id: input.clientId,
    p_customer_ref: input.customerRef,
    p_enrollment_id: input.enrollmentId,
    p_idempotency_key: input.idempotencyKey,
    p_payment_method_ref: input.paymentMethodRef,
    p_price_cents: input.priceCents,
    p_price_ref: input.priceRef,
    p_provider: input.provider,
    p_setup_intent_ref: input.setupIntentRef,
  });
  return voidResult(error);
}

export async function idvStarted(input: IdvStartedInput): Promise<RepositoryResult<void>> {
  const { error } = await adminClient().rpc("enrollment_idv_started", {
    p_actor_id: input.actorId,
    p_client_id: input.clientId,
    p_driver: input.driver,
    p_enrollment_id: input.enrollmentId,
    p_kind: input.kind,
    p_max_attempts: input.maxAttempts,
    p_member_ref: input.memberRef,
    p_continuation: input.continuation ?? null,
  });
  return voidResult(error);
}

export async function idvSettled(input: IdvSettledInput): Promise<RepositoryResult<void>> {
  const { error } = await adminClient().rpc("enrollment_idv_settled", {
    p_actor_id: input.actorId,
    p_enrollment_id: input.enrollmentId,
    p_locked_until: input.lockedUntil,
    p_next_state: input.nextState,
    p_outcome: input.outcome,
    p_parked_until: input.parkedUntil,
  });
  return voidResult(error);
}

function settlementVerdict(data: unknown): RepositoryResult<SettlementVerdict> {
  const row = data as { reason_code?: unknown; subscription_ref?: unknown; verdict?: unknown } | null;
  const verdicts = new Set(["cancel_pending", "settled"]);
  const reasons = new Set(["activated", "consent_withdrawn", "enrollment_cancelled", "replay"]);
  if (typeof row?.verdict !== "string" || !verdicts.has(row.verdict)
    || typeof row.reason_code !== "string" || !reasons.has(row.reason_code)) {
    return { ok: false, error: new AppError("unexpected", "The settlement returned no verdict.") };
  }
  return { ok: true, value: {
    reasonCode: row.reason_code as SettlementVerdict["reasonCode"],
    subscriptionRef: typeof row.subscription_ref === "string" ? row.subscription_ref : null,
    verdict: row.verdict as SettlementVerdict["verdict"],
  } };
}

export async function settleSub(
  enrollmentId: string,
  actorId: string | null,
  subscriptionRef: string,
): Promise<RepositoryResult<SettlementVerdict>> {
  const { data, error } = await adminClient().rpc("enrollment_settle_sub", {
    p_actor_id: actorId,
    p_enrollment_id: enrollmentId,
    p_subscription_ref: subscriptionRef,
  });
  return error ? { ok: false, error: databaseError(error) } : settlementVerdict(data);
}

export async function completeProviderCancel(
  enrollmentId: string,
  subscriptionRef: string,
): Promise<RepositoryResult<void>> {
  const { data, error } = await adminClient().rpc("consumer_subscription_provider_cancel_completed", {
    p_enrollment_id: enrollmentId,
    p_subscription_ref: subscriptionRef,
  });
  if (error) return { ok: false, error: databaseError(error) };
  return (data as { completed?: unknown } | null)?.completed === true
    ? { ok: true, value: undefined }
    : { ok: false, error: new AppError("conflict", "The provider cancellation has no matching intent.") };
}

export async function reviewSub(input: ReviewSubInput): Promise<RepositoryResult<void>> {
  const { error } = await adminClient().rpc("enrollment_review_sub", {
    p_actor_id: input.actorId,
    p_amount_cents: input.amountCents,
    p_currency: input.currency,
    p_enrollment_id: input.enrollmentId,
    p_provider_status: input.providerStatus,
    p_review_code: "provider_response_mismatch",
    p_subscription_ref: input.subscriptionRef,
  });
  return voidResult(error);
}

export async function claimWebhookEvent(
  event: ParsedWebhook,
  leaseOwner: string,
): Promise<RepositoryResult<boolean>> {
  const { data, error } = await adminClient().rpc("claim_stripe_webhook_event", {
    p_event_id: event.eventId,
    p_event_type: event.eventType,
    p_lease_owner: leaseOwner,
    p_lease_seconds: 300,
  });
  if (error) return { ok: false, error: databaseError(error) };
  return { ok: true, value: data === true };
}

export async function markWebhookEvent(
  eventId: string,
  leaseOwner: string,
  status: WebhookEventStatus,
  errorCode?: string,
): Promise<RepositoryResult<void>> {
  const { data, error } = await adminClient().rpc("finish_stripe_webhook_event", {
    p_error_code: errorCode ?? null,
    p_event_id: eventId,
    p_lease_owner: leaseOwner,
    p_status: status,
  });
  if (error) return { ok: false, error: databaseError(error) };
  return data
    ? { ok: true, value: undefined }
    : { ok: false, error: new AppError("conflict", "The webhook lease is no longer owned by this worker.") };
}

export async function cancelSub(
  enrollmentId: string,
  actorId: string,
  reason: string,
): Promise<RepositoryResult<CancellationOutcome>> {
  const { data, error } = await adminClient().rpc("enrollment_cancel_sub", {
    p_actor_id: actorId,
    p_enrollment_id: enrollmentId,
    p_reason: reason,
  });
  if (error) return { ok: false, error: databaseError(error) };
  const row = data as { provider_cancel_ref?: unknown } | null;
  return { ok: true, value: {
    providerCancelRef: typeof row?.provider_cancel_ref === "string" ? row.provider_cancel_ref : null,
  } };
}

export async function recordMilestone(
  clientId: string,
  kind: MilestoneKind,
  actorId: string,
): Promise<RepositoryResult<void>> {
  const { error } = await adminClient().rpc("enrollment_record_milestone", {
    p_actor_id: actorId,
    p_client_id: clientId,
    p_kind: kind,
  });
  return voidResult(error);
}

export async function revokeConsent(
  clientId: string,
  kind: ConsentKind,
  actorId: string,
): Promise<RepositoryResult<void>> {
  const { error } = await adminClient().rpc("enrollment_revoke_consent", {
    p_actor_id: actorId,
    p_client_id: clientId,
    p_kind: kind,
  });
  return voidResult(error);
}

export async function reauthorizeConsent(
  input: ReauthorizeConsentInput,
  suppliedClient?: EnrollmentAdmin,
): Promise<RepositoryResult<ReauthorizeConsentRecord>> {
  const client = suppliedClient ?? adminClient();
  const { data, error } = await client.rpc("enrollment_reauthorize_consent", {
    p_actor_id: input.actorId,
    p_draft_id: input.draftId,
    p_enrollment_id: input.enrollmentId,
    p_ip: input.ip,
    p_kind: input.kind,
    p_signer_name: input.signerName,
    p_text_version: input.textVersion,
    p_typed_signature: input.typedSignature,
    p_user_agent: input.userAgent,
  });
  if (error) return { ok: false, error: databaseError(error) };
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  return typeof row?.consent_id === "string"
    && typeof row.signed_at === "string"
    && typeof row.replayed === "boolean"
    ? {
        ok: true,
        value: {
          consentId: row.consent_id,
          replayed: row.replayed,
          signedAt: row.signed_at,
        },
      }
    : {
        ok: false,
        error: new AppError("unexpected", "Consent reauthorization returned no record."),
      };
}

type ConsentRead = {
  action: "granted" | "revoked";
  id: string;
  kind: ConsentKind;
  signed_at: string;
  supersedes_consent_id: string | null;
  text_version: string;
};

type EnrollmentRead = {
  client: {
    consent_revocations: Array<{ consent_id: string; kind: ConsentKind; revoked_at: string }>;
    business_name: string | null;
    consents: ConsentRead[];
    consumer_profile_id: string | null;
    display_name: string;
    enrollment_milestones: Array<{ completed_at: string; completed_by: string | null; kind: MilestoneKind }>;
    org_id: string;
    profile: { email: string; full_name: string; phone: string | null } | null;
  };
  client_id: string;
  consumer_subscriptions: Array<{
    activated_at: string | null;
    attempt_provider_subscription_ref: string | null;
    cancelled_at: string | null;
    created_at: string;
    currency: string;
    customer_ref: string;
    idempotency_key: string;
    operation_id: string | null;
    operation_state: SubscriptionState["operationState"];
    payment_method_ref: string;
    price_cents: number;
    price_ref: string;
    provider: string;
    setup_intent_ref: string;
    status: "authorized" | "active" | "cancelled" | "review_required";
    subscription_attempt_at: string | null;
    subscription_ref: string | null;
  }>;
  crs_member_ref: string | null;
  id: string;
  idv_sessions: Array<{
    attempts_used: number;
    continuation_ciphertext: string | null;
    locked_until: string | null;
    max_attempts: number;
    state: IdvState;
  }>;
  parked_until: string | null;
  status: EnrollmentStatus;
};

export async function readEnrollmentState(
  enrollmentId: string,
  actor: SessionProfile,
): Promise<RepositoryResult<EnrollmentState>> {
  let query = adminClient()
    .from("enrollments")
    .select(`
      id, client_id, status, crs_member_ref, parked_until,
      client:clients!inner(
        org_id, consumer_profile_id, display_name, business_name,
        profile:profiles!clients_consumer_org_fk(full_name, email, phone),
        consents(id, kind, action, text_version, signed_at, supersedes_consent_id),
        consent_revocations(consent_id, kind, revoked_at),
        enrollment_milestones(kind, completed_at, completed_by)
      ),
      idv_sessions(state, attempts_used, max_attempts, locked_until, continuation_ciphertext),
      consumer_subscriptions(
        provider, customer_ref, setup_intent_ref, payment_method_ref, currency,
        price_ref, price_cents, status, subscription_ref,
        idempotency_key, subscription_attempt_at, operation_id, operation_state,
        attempt_provider_subscription_ref,
        created_at, activated_at, cancelled_at
      )
    `)
    .eq("id", enrollmentId);

  // The admin client bypasses RLS. These actor filters are the authorization
  // control on this path and must not be removed as "redundant" with policies.
  if (actor.role === "consumer") {
    query = query.eq("client.consumer_profile_id", actor.id);
  } else if (actor.role === "operator_member" && actor.orgId) {
    query = query.eq("client.org_id", actor.orgId);
  } else if (actor.role !== "platform_admin") {
    return { ok: false, error: new AppError("not_found", "Enrollment not found.") };
  }

  const { data, error } = await query.maybeSingle();
  if (error) return { ok: false, error: databaseError(error) };
  if (!data) return { ok: false, error: new AppError("not_found", "Enrollment not found.") };

  return result(toEnrollmentState(data as EnrollmentRead), null);
}

type EnrollmentSummaryRead = {
  client: {
    consumer_profile_id: string | null;
    display_name: string;
    org_id: string;
    profile: { email: string | null } | null;
  };
  client_id: string;
  created_at: string;
  id: string;
  parked_until: string | null;
  status: EnrollmentStatus;
};

export async function listEnrollmentSummaries(
  actor: SessionProfile,
): Promise<RepositoryResult<EnrollmentSummary[]>> {
  let query = adminClient()
    .from("enrollments")
    .select(`
      id, client_id, status, parked_until, created_at,
      client:clients!inner(
        display_name, consumer_profile_id, org_id,
        profile:profiles!clients_consumer_org_fk(email)
      )
    `)
    .order("created_at", { ascending: false })
    .limit(200);

  if (actor.role === "consumer") {
    query = query.eq("client.consumer_profile_id", actor.id);
  } else if (actor.role === "operator_member" && actor.orgId) {
    query = query.eq("client.org_id", actor.orgId);
  } else if (actor.role !== "platform_admin") {
    return { ok: true, value: [] };
  }

  const { data, error } = await query;
  if (error) return { ok: false, error: databaseError(error) };
  const rows = Array.isArray(data) ? (data as EnrollmentSummaryRead[]) : [];
  return {
    ok: true,
    value: rows.map((row) => ({
      clientId: row.client_id,
      displayName: row.client.display_name,
      email: row.client.profile?.email ?? null,
      enrollmentId: row.id,
      parkedUntil: row.parked_until,
      status: row.status,
    })),
  };
}

export async function readWebhookEnrollment(
  event: ParsedWebhook,
): Promise<RepositoryResult<EnrollmentState | null>> {
  const candidates: Array<["attempt_provider_subscription_ref" | "subscription_ref" | "setup_intent_ref", string | null]> = [
    ["subscription_ref", event.subscriptionRef],
    ["attempt_provider_subscription_ref", event.subscriptionRef],
    ["setup_intent_ref", event.setupIntentRef],
  ];

  for (const [column, value] of candidates) {
    if (!value) continue;
    const { data, error } = await adminClient()
      .from("consumer_subscriptions")
      .select("enrollment_id")
      .eq(column, value)
      .maybeSingle();
    if (error) return { ok: false, error: databaseError(error) };
    const row = data as { enrollment_id?: unknown } | null;
    if (typeof row?.enrollment_id === "string") {
      const state = await readEnrollmentState(row.enrollment_id, {
        disabledAt: null,
        id: "00000000-0000-0000-0000-000000000000",
        manages: [],
        orgId: null,
        orgMembership: null,
        orgRole: null,
        role: "platform_admin",
      });
      return state.ok ? state : { ok: false, error: state.error };
    }
  }

  return { ok: true, value: null };
}

function toEnrollmentState(row: EnrollmentRead): EnrollmentState {
  const idv = row.idv_sessions[0];
  const subscriptionRow = row.consumer_subscriptions[0];
  const grants = row.client.consents.filter((consent) => consent.action === "granted");
  const eventRevocations = row.client.consents
    .filter((consent) => consent.action === "revoked" && consent.supersedes_consent_id)
    .map((consent) => ({ consentId: consent.supersedes_consent_id as string, kind: consent.kind, revokedAt: consent.signed_at }));
  const revocations = [
    ...row.client.consent_revocations.map((item) => ({ consentId: item.consent_id, kind: item.kind, revokedAt: item.revoked_at })),
    ...eventRevocations,
  ];
  const consentRows = grants.map((consent) => ({ id: consent.id, kind: consent.kind, signedAt: consent.signed_at, textVersion: consent.text_version }));
  const consentKinds: ConsentKind[] = ["monitoring", "analysis"];

  const subscription: SubscriptionState | null = subscriptionRow
    ? {
        currency: subscriptionRow.currency,
        customerRef: subscriptionRow.customer_ref,
        idempotencyKey: subscriptionRow.idempotency_key,
        attemptSubscriptionRef: subscriptionRow.attempt_provider_subscription_ref,
        operationId: subscriptionRow.operation_id,
        operationState: subscriptionRow.operation_state,
        paymentMethodRef: subscriptionRow.payment_method_ref,
        priceCents: subscriptionRow.price_cents,
        priceRef: subscriptionRow.price_ref,
        provider: subscriptionRow.provider,
        setupIntentRef: subscriptionRow.setup_intent_ref,
        status: subscriptionRow.status,
        subscriptionAttemptAt: subscriptionRow.subscription_attempt_at,
        subscriptionRef: subscriptionRow.subscription_ref,
      }
    : null;

  const view: EnrollmentView = {
    attemptsRemaining: Math.max(0, (idv?.max_attempts ?? MAX_IDV_ATTEMPTS) - (idv?.attempts_used ?? 0)),
    consents: consentKinds.map((kind) => {
      const latest = consentRows
        .filter((consent) => consent.kind === kind)
        .toSorted((left, right) => right.signedAt.localeCompare(left.signedAt))[0];
      return {
        authorized: isAuthorized(kind, consentRows, revocations),
        kind,
        signedAt: latest?.signedAt ?? null,
        textVersion: latest?.textVersion ?? "",
      };
    }),
    enrollmentId: row.id,
    idvState: idv?.state ?? "pending",
    lockedUntil: idv?.locked_until ?? null,
    milestones: row.client.enrollment_milestones.map((milestone) => ({
      by: milestone.completed_by,
      completedAt: milestone.completed_at,
      kind: milestone.kind,
    })),
    needsOperatorAttention: subscriptionRow?.status === "review_required"
      ? "subscription_configuration_review"
      : null,
    parkedUntil: row.parked_until,
    status: row.status,
    // The consumer-safe half of the same row `subscription` above carries in full. Only the money
    // facts and the timestamps cross the boundary; every provider reference stays server-side.
    // `payment_method_ref` is NOT NULL on rows that reach this read, so presence — not the id — is
    // what the browser is told, and the absence of a brand/last4 column is why the surface has to
    // render that detail as unavailable rather than as a card number.
    subscription: subscriptionRow
      ? {
          activatedAt: subscriptionRow.activated_at,
          authorizedAt: subscriptionRow.created_at,
          cancelledAt: subscriptionRow.cancelled_at,
          currency: subscriptionRow.currency,
          paymentMethodOnFile: typeof subscriptionRow.payment_method_ref === "string"
            && subscriptionRow.payment_method_ref.length > 0,
          priceCents: subscriptionRow.price_cents,
          status: subscriptionRow.status,
        }
      : null,
  };

  return {
    attemptsUsed: idv?.attempts_used ?? 0,
    businessName: row.client.business_name,
    clientId: row.client_id,
    identity: {
      email: row.client.profile?.email ?? "",
      fullName: row.client.profile?.full_name ?? row.client.display_name,
      phone: row.client.profile?.phone ?? "",
    },
    idvContinuation: idv?.continuation_ciphertext ?? null,
    maxAttempts: idv?.max_attempts ?? MAX_IDV_ATTEMPTS,
    memberRef: row.crs_member_ref,
    subscription,
    view,
  };
}

function requireE2eRepositoryAccess(): void {
  if (process.env.ENROLL_E2E !== "1") {
    throw new Error("Enrollment E2E repository access is disabled.");
  }
}

/**
 * Provisions a fresh, persistent consumer for the local HTTP suites. The
 * append-only enrollment evidence is intentionally not deleted after a run.
 */
export async function createEnrollmentE2eFixture(input: {
  clientId: string;
  email: string;
  fullName: string;
}): Promise<{ actorId: string }> {
  requireE2eRepositoryAccess();
  const client = createAdminClient();
  const database = client as unknown as EnrollmentAdmin;
  const orgId = randomUUID();
  // Migration 170 caps `orgs.slug` at 40 lowercase characters; the earlier
  // `enrollment-e2e-<uuid>` shape was 51 and every fixture insert failed 23514
  // once Phase 20 merged. Dashes are stripped so the slug is prefix + 32 hex.
  const slug = `e2e-${input.clientId.replace(/-/g, "")}`;

  const { error: orgError } = await database.from("orgs").insert({
    id: orgId,
    name: `Enrollment E2E ${input.clientId}`,
    slug,
  });
  if (orgError) throw databaseError(orgError);

  const { data: authData, error: authError } =
    await client.auth.admin.createUser({
      email: input.email,
      email_confirm: true,
      user_metadata: { full_name: input.fullName },
    });
  if (authError || !authData.user) {
    throw new Error("Enrollment E2E auth fixture creation failed.");
  }

  const actorId = authData.user.id;
  // upsert, not insert: migration 010's `on_auth_user_created` trigger writes a
  // profile row of its own for every `auth.users` insert, so by the time this
  // line runs the row already exists and an insert raises 23505. The trigger
  // arrived after this fixture did, and its row is the narrow fallback shape —
  // role `consumer`, org_id null — so the upsert still decides the final values.
  const { error: profileError } = await database.from("profiles").upsert({
    email: input.email,
    full_name: input.fullName,
    id: actorId,
    manages: [],
    org_id: orgId,
    org_role: null,
    phone: "+15555550100",
    role: "consumer",
  });
  if (profileError) throw databaseError(profileError);

  const { error: clientError } = await database.from("clients").insert({
    consumer_profile_id: actorId,
    display_name: input.fullName,
    id: input.clientId,
    org_id: orgId,
  });
  if (clientError) throw databaseError(clientError);

  return { actorId };
}

/** Reads durable E2E assertions through the application's sole DB repository. */
export async function readEnrollmentE2eEvidence(
  clientId: string,
): Promise<EnrollmentE2eEvidence> {
  requireE2eRepositoryAccess();
  const database = adminClient();
  const [
    consents,
    enrollment,
    esignatures,
    milestones,
    revocations,
    subscriptions,
    subscriptionCount,
    activeSubscriptionCount,
    audits,
  ] = await Promise.all([
    database
      .from("consents")
      .select("id, kind, action, signed_at, text_version")
      .eq("client_id", clientId),
    database
      .from("enrollments")
      .select("id, status, parked_until")
      .eq("client_id", clientId)
      .maybeSingle(),
    database
      .from("esignatures")
      .select("id, signed_at, text_version")
      .eq("client_id", clientId),
    database
      .from("enrollment_milestones")
      .select("kind")
      .eq("client_id", clientId),
    database
      .from("consent_revocations")
      .select("consent_id, kind, revoked_at")
      .eq("client_id", clientId),
    database
      .from("consumer_subscriptions")
      .select("status, subscription_ref")
      .eq("client_id", clientId),
    database
      .from("consumer_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId),
    database
      .from("consumer_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("status", "active"),
    database
      .from("audit_log")
      .select("action")
      .eq("client_id", clientId),
  ]);

  const failed = [
    consents,
    enrollment,
    esignatures,
    milestones,
    revocations,
    subscriptions,
    subscriptionCount,
    activeSubscriptionCount,
    audits,
  ].find((response) => response.error);
  if (failed?.error) throw databaseError(failed.error);
  if (!enrollment.data) {
    throw new AppError("not_found", "Enrollment not found.");
  }

  const enrollmentRow = enrollment.data as {
    id: string;
    parked_until: string | null;
    status: EnrollmentStatus;
  };
  return {
    activeSubscriptionCount: activeSubscriptionCount.count ?? 0,
    auditActions: ((audits.data ?? []) as Array<{ action: string }>).map(
      (row) => row.action,
    ),
    consents: ((consents.data ?? []) as Array<{
      action: "granted" | "revoked";
      id: string;
      kind: ConsentKind;
      signed_at: string;
      text_version: string;
    }>).map((row) => ({
      action: row.action,
      id: row.id,
      kind: row.kind,
      signedAt: row.signed_at,
      textVersion: row.text_version,
    })),
    enrollment: {
      enrollmentId: enrollmentRow.id,
      parkedUntil: enrollmentRow.parked_until,
      status: enrollmentRow.status,
    },
    esignatures: ((esignatures.data ?? []) as Array<{
      id: string;
      signed_at: string;
      text_version: string;
    }>).map((row) => ({
      id: row.id,
      signedAt: row.signed_at,
      textVersion: row.text_version,
    })),
    milestones: ((milestones.data ?? []) as Array<{
      kind: MilestoneKind;
    }>),
    revocations: ((revocations.data ?? []) as Array<{
      consent_id: string;
      kind: ConsentKind;
      revoked_at: string;
    }>).map((row) => ({
      consentId: row.consent_id,
      kind: row.kind,
      revokedAt: row.revoked_at,
    })),
    subscriptionCount: subscriptionCount.count ?? 0,
    subscriptions: ((subscriptions.data ?? []) as Array<{
      status: "authorized" | "active" | "cancelled" | "failed" | "review_required";
      subscription_ref: string | null;
    }>).map((row) => ({
      status: row.status,
      subscriptionRef: row.subscription_ref,
    })),
  };
}

export const enrollmentRepository: EnrollmentRepository = {
  beginSubscriptionAttempt,
  beginEnrollment,
  cancelSub,
  completeProviderCancel,
  idvSettled,
  idvStarted,
  readEnrollmentState,
  reauthorizeConsent,
  recordMilestone,
  recordSetup,
  recordSubscriptionProviderReturned,
  reviewSub,
  resolveConsumerClient,
  revokeConsent,
  settleSub,
};

export const enrollmentWebhookRepository: EnrollmentWebhookRepository = {
  applySubscriptionEvent,
  claimWebhookEvent,
  markWebhookEvent,
  readWebhookEnrollment,
  settleSub,
};
