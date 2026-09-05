import type { SessionProfile } from "@/lib/auth/session";
import type { BillingAdapter, BillingDriver } from "@/lib/billing/types";
import { setupIntentKey, subscriptionKey } from "@/lib/billing/ids";
import { currentVersion } from "@/lib/enrollment/consent-texts";
import { enrollmentPrice } from "@/lib/enrollment/config";
import { AppError } from "@/lib/enrollment/errors";
import { nextState } from "@/lib/enrollment/machine";
import type {
  EnrollmentRepository,
  EnrollmentState,
  RepositoryResult,
} from "@/lib/enrollment/repository";
import type {
  ConsentKind,
  EnrollRequest,
  EnrollmentView,
  IdvSubmitBody,
  MachineEffect,
  MachineEvent,
  MilestoneKind,
  ReauthorizeConsentBody,
} from "@/lib/enrollment/types";
import { MAX_IDV_ATTEMPTS } from "@/lib/idv/config";
import type { IdvAdapter, IdvDriver, IdvResult } from "@/lib/idv/types";
import type { CrsIdentity, CrsIdvContinuation, CrsMemberRef } from "@/lib/crs/types";
import { trackerEnrollmentPort } from "@/lib/tracker/enrollment-adapter";
import type { EnrollmentAnalysisTarget } from "@/lib/tracker/enrollment-adapter";
import type { EmailAvailabilityReader } from "@/lib/enrollment/email-availability";
import { CrsDriverError } from "@/lib/crs/errors";
import { crsEnrollmentFailure } from "@/lib/enrollment/crs-failures";
import { CRS_SPEC_ERROR_CODES } from "@/lib/crs/spec-catalog";

export type EnrollmentTrackerPort = {
  enrollmentActivated(input: {
    actorId: string;
    clientId: string;
    enrollmentId: string;
  }): Promise<EnrollmentAnalysisTarget | null | void>;
};

export type EnrollmentServiceDependencies = {
  billing: BillingAdapter;
  billingDriver: BillingDriver;
  idv: IdvAdapter;
  idvDriver: IdvDriver;
  now: () => Date;
  repository: EnrollmentRepository;
  tracker: EnrollmentTrackerPort;
  emailAvailability?: EmailAvailabilityReader;
  tenancyEnabled?: () => boolean;
};

export type StartEnrollmentInput = {
  ip: string;
  request: EnrollRequest;
  userAgent: string;
};

export type ReauthorizeConsentServiceInput = ReauthorizeConsentBody & {
  ip: string;
  userAgent: string;
};

async function defaultDependencies(): Promise<EnrollmentServiceDependencies> {
  const [{ getBillingAdapter }, env, { getIdvAdapter }, repository, emailAvailability] =
    await Promise.all([
      import("@/lib/billing"),
      import("@/lib/env"),
      import("@/lib/idv"),
      import("@/lib/enrollment/repository"),
      import("@/lib/enrollment/email-availability"),
    ]);

  return {
    billing: getBillingAdapter(),
    billingDriver: env.resolveDriver("billing"),
    idv: getIdvAdapter(),
    idvDriver: env.resolveDriver("idv") as IdvDriver,
    now: () => new Date(),
    repository: repository.enrollmentRepository,
    emailAvailability: await emailAvailability.productionEmailAvailabilityReader(),
    tracker: trackerEnrollmentPort,
    tenancyEnabled: () => env.featureFlag("FEATURE_TENANCY"),
  };
}

async function dependencies(
  supplied?: EnrollmentServiceDependencies,
): Promise<EnrollmentServiceDependencies> {
  return supplied ?? defaultDependencies();
}

function unwrap<T>(value: RepositoryResult<T>): T {
  if (!value.ok) throw value.error;
  return value.value;
}

function providerFailure(error?: unknown): AppError {
  if (error instanceof CrsDriverError) {
    const failure = crsEnrollmentFailure(error.codes);
    if (error.codes.includes(CRS_SPEC_ERROR_CODES.userAlreadyRegistered)) {
      return new AppError("identity_account_exists", failure.message);
    }
    if (error.codes.includes(CRS_SPEC_ERROR_CODES.ditRejected)) {
      return new AppError("identity_verification_failed", failure.message);
    }
    return new AppError("driver_unavailable", failure.message);
  }
  return new AppError(
    "driver_unavailable",
    "The enrollment provider could not complete the request.",
  );
}

function billingConfigurationFailure(): AppError {
  return new AppError(
    "billing_configuration",
    "The subscription result requires configuration review.",
  );
}

/**
 * R4C-01: an exact-price `incomplete` is the provider asking the consumer to
 * finish the card challenge, not a misconfiguration. The attempt keeps its
 * retained provider reference and the local status stays `authorized`, so the
 * later `invoice.paid` settles through the same locked gate.
 */
function paymentPendingFailure(): AppError {
  return new AppError("conflict", "The card payment has not completed yet.");
}

async function safeProvider<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw providerFailure(error);
  }
}

function machineState(state: EnrollmentState) {
  return {
    attemptsUsed: state.attemptsUsed,
    idvState: state.view.idvState,
    maxAttempts: state.maxAttempts,
    status: state.view.status,
    subscriptionSettled: state.subscription?.status === "active",
  };
}

function hasCurrentSubscriptionConsents(state: EnrollmentState): boolean {
  return (["monitoring", "analysis"] as const).every((kind) =>
    state.view.consents.some((consent) => consent.kind === kind && consent.authorized));
}

async function read(
  enrollmentId: string,
  actor: SessionProfile,
  deps: EnrollmentServiceDependencies,
): Promise<EnrollmentState> {
  return unwrap(await deps.repository.readEnrollmentState(enrollmentId, actor));
}

async function authorizeCard(
  state: EnrollmentState,
  actor: SessionProfile,
  deps: EnrollmentServiceDependencies,
): Promise<void> {
  if (state.subscription) return;
  const price = enrollmentPrice();
  const setup = await safeProvider(() =>
    deps.billing.createSetupIntent({
      clientId: state.clientId,
      email: state.identity.email,
      enrollmentId: state.view.enrollmentId,
      fullName: state.identity.fullName,
    }),
  );
  const confirmation = await safeProvider(() =>
    deps.billing.confirmCard({ setupIntentRef: setup.setupIntentRef }),
  );
  if (confirmation.status !== "succeeded" || !confirmation.paymentMethodRef) {
    throw new AppError("conflict", "The card authorization is not complete.");
  }
  unwrap(
    await deps.repository.recordSetup({
      actorId: actor.id,
      clientId: state.clientId,
      customerRef: setup.customerRef,
      enrollmentId: state.view.enrollmentId,
      idempotencyKey: setupIntentKey(state.view.enrollmentId),
      paymentMethodRef: confirmation.paymentMethodRef,
      priceCents: price.priceCents,
      priceRef: price.priceRef,
      provider: deps.billingDriver,
      setupIntentRef: setup.setupIntentRef,
    }),
  );
}

/**
 * The fast path for the durable provider-cancellation obligation migration 354
 * records. The intent is authoritative and completes only on provider
 * confirmation; if the provider is unavailable the obligation survives and the
 * `purge.derived` handler closes it.
 */
async function closeProviderSubscription(
  enrollmentId: string,
  subscriptionRef: string,
  deps: EnrollmentServiceDependencies,
): Promise<void> {
  await safeProvider(() => deps.billing.cancel({ atPeriodEnd: false, subscriptionRef }));
  unwrap(await deps.repository.completeProviderCancel(enrollmentId, subscriptionRef));
}

type EffectContext = {
  actor: SessionProfile;
  deps: EnrollmentServiceDependencies;
  identity: EnrollmentState["identity"];
  crsIdentity?: CrsIdentity;
  onIdvStarted?: (verificationUrl: string | undefined) => void;
  state: EnrollmentState;
};

async function executeEffect(
  effect: MachineEffect,
  context: EffectContext,
): Promise<EnrollmentAnalysisTarget | null | void> {
  const { actor, deps, identity, state } = context;
  const enrollmentId = state.view.enrollmentId;

  if (effect.kind === "start_idv") {
    const started = await safeProvider(() =>
      deps.idv.start({
        clientId: state.clientId,
        enrollmentId,
        identity,
        ...(context.crsIdentity ? { crsIdentity: context.crsIdentity } : {}),
      }),
    );
    context.onIdvStarted?.(started.challenge.verificationUrl);
    unwrap(
      await deps.repository.idvStarted({
        actorId: actor.id,
        clientId: state.clientId,
        continuation: started.continuation ?? null,
        driver: deps.idvDriver,
        enrollmentId,
        kind: started.challenge.kind,
        maxAttempts: MAX_IDV_ATTEMPTS,
        memberRef: started.memberRef,
      }),
    );
    return;
  }

  if (effect.kind === "settle_idv") {
    unwrap(
      await deps.repository.idvSettled({
        actorId: actor.id,
        enrollmentId,
        lockedUntil: null,
        nextState: effect.nextState,
        outcome: effect.outcome,
        parkedUntil: null,
      }),
    );
    return;
  }

  if (effect.kind === "activate") {
    unwrap(
      await deps.repository.idvSettled({
        actorId: actor.id,
        enrollmentId,
        lockedUntil: null,
        nextState: "passed",
        outcome: "pass",
        parkedUntil: null,
      }),
    );
    return;
  }

  if (effect.kind === "park") {
    unwrap(
      await deps.repository.idvSettled({
        actorId: actor.id,
        enrollmentId,
        lockedUntil: effect.until,
        nextState: "locked",
        outcome: "locked",
        parkedUntil: effect.until,
      }),
    );
    return;
  }

  if (effect.kind === "record_milestone") {
    unwrap(
      await deps.repository.recordMilestone(
        state.clientId,
        effect.milestone,
        actor.id,
      ),
    );
    return;
  }

  if (effect.kind === "cancel_subscription") {
    // The durable stop intent is authoritative and must win even if the provider is unavailable.
    // R4C-07: the reference to cancel comes from the RPC, which also sees the
    // attempt reference a subscription created during this cancellation left behind.
    const cancelled = unwrap(await deps.repository.cancelSub(enrollmentId, actor.id, "consumer_cancelled"));
    if (cancelled.providerCancelRef) {
      await closeProviderSubscription(enrollmentId, cancelled.providerCancelRef, deps);
    }
    if (deps.idvDriver === "crs" && state.memberRef) {
      await safeProvider(() => deps.idv.close(state.memberRef as CrsMemberRef));
    }
    return;
  }

  const subscription = state.subscription;
  if (!hasCurrentSubscriptionConsents(state)) return;
  if (!subscription) {
    throw new AppError("conflict", "The card authorization is missing.");
  }
  if (subscription.status === "review_required") {
    throw billingConfigurationFailure();
  }

  // Write the attempt timestamp before the money-moving provider call.
  unwrap(
    await deps.repository.recordSetup({
      actorId: actor.id,
      clientId: state.clientId,
      customerRef: subscription.customerRef,
      enrollmentId,
      idempotencyKey: subscriptionKey(enrollmentId),
      paymentMethodRef: subscription.paymentMethodRef,
      priceCents: subscription.priceCents,
      priceRef: subscription.priceRef,
      provider: subscription.provider,
      setupIntentRef: subscription.setupIntentRef,
    }),
  );
  const operationId = subscriptionKey(enrollmentId);
  const attempt = unwrap(await deps.repository.beginSubscriptionAttempt(enrollmentId, operationId));
  const retained = attempt.subscriptionRef && attempt.amountCents !== null && attempt.currency && attempt.status
    ? {
        amountCents: attempt.amountCents,
        currency: attempt.currency,
        currentPeriodEnd: "",
        status: attempt.status as "active" | "incomplete" | "past_due",
        subscriptionRef: attempt.subscriptionRef,
      }
    : null;
  const reconciled = retained ?? await safeProvider(() =>
    deps.billing.findSubscription({ enrollmentId, operationId }),
  );
  const settled = reconciled ?? await safeProvider(() =>
    deps.billing.startSubscription({
      customerRef: subscription.customerRef,
      enrollmentId,
      idempotencyKey: subscriptionKey(enrollmentId),
      operationId,
      paymentMethodRef: subscription.paymentMethodRef,
      priceRef: subscription.priceRef,
    }),
  );
  unwrap(await deps.repository.recordSubscriptionProviderReturned({ enrollmentId, operationId, result: settled }));
  const exactGovernedPrice = settled.amountCents === subscription.priceCents
    && settled.currency === subscription.currency;
  if (settled.status !== "active") {
    // An amount or currency mismatch is a configuration fault and stays
    // review-only; an exact-price `incomplete` is retryable and must keep the
    // retained reference settleable, so it never enters review.
    if (exactGovernedPrice && settled.status === "incomplete") throw paymentPendingFailure();
    unwrap(await deps.repository.reviewSub({
      actorId: actor.id,
      amountCents: settled.amountCents,
      currency: settled.currency,
      enrollmentId,
      providerStatus: settled.status,
      subscriptionRef: settled.subscriptionRef,
    }));
    throw billingConfigurationFailure();
  }
  if (!exactGovernedPrice) {
    unwrap(await deps.repository.reviewSub({
      actorId: actor.id,
      amountCents: settled.amountCents,
      currency: settled.currency,
      enrollmentId,
      providerStatus: settled.status,
      subscriptionRef: settled.subscriptionRef,
    }));
    throw billingConfigurationFailure();
  }
  const verdict = unwrap(await deps.repository.settleSub(enrollmentId, actor.id, settled.subscriptionRef));
  if (verdict.verdict === "cancel_pending") {
    // The authority ended inside the provider window. Nothing is granted; the
    // obligation is durable and this is only its fast path.
    if (verdict.subscriptionRef) {
      await closeProviderSubscription(enrollmentId, verdict.subscriptionRef, deps);
    }
    return;
  }
  return deps.tracker.enrollmentActivated({
    actorId: actor.id,
    clientId: state.clientId,
    enrollmentId,
  });
}

async function executeEffects(
  effects: readonly MachineEffect[],
  context: EffectContext,
): Promise<EnrollmentAnalysisTarget | null> {
  let analysisTarget: EnrollmentAnalysisTarget | null = null;
  for (const effect of effects) {
    const result = await executeEffect(effect, context);
    if (result) analysisTarget = result;
  }
  return analysisTarget;
}

export async function startEnrollment(
  input: StartEnrollmentInput,
  actor: SessionProfile,
  supplied?: EnrollmentServiceDependencies,
): Promise<EnrollmentView> {
  const deps = await dependencies(supplied);
  const crsIdentity = deps.idvDriver === "crs"
    ? buildCrsIdentity(input.request)
    : undefined;
  if (deps.tenancyEnabled?.() && await deps.emailAvailability?.registeredElsewhere({
    actorId: actor.id,
    email: input.request.email,
  })) {
    throw new AppError("EMAIL_ALREADY_REGISTERED", "EMAIL_ALREADY_REGISTERED");
  }
  const clientId = unwrap(await deps.repository.resolveConsumerClient(actor));
  const begun = unwrap(
    await deps.repository.beginEnrollment({
      actorId: actor.id,
      affiliateReferralSlug: input.request.aff,
      agreementVersion: currentVersion("enrollment_agreement"),
      analysisVersion: currentVersion("analysis"),
      clientId,
      draftId: input.request.draftId,
      ip: input.ip,
      monitoringVersion: currentVersion("monitoring"),
      signerName: input.request.name,
      typedSignature: input.request.signature,
      userAgent: input.userAgent,
    }),
  );

  let state = await read(begun.enrollmentId, actor, deps);
  state = { ...state, identity: { email: input.request.email, fullName: input.request.name, phone: input.request.phone } };
  await authorizeCard(state, actor, deps);
  state = await read(begun.enrollmentId, actor, deps);
  state = { ...state, identity: { email: input.request.email, fullName: input.request.name, phone: input.request.phone } };
  const transition = nextState(machineState(state), { kind: "idv_start" }, deps.now());
  let verificationUrl: string | undefined;
  await executeEffects(transition.effects, {
    actor,
    deps,
    identity: state.identity,
    ...(crsIdentity ? { crsIdentity } : {}),
    onIdvStarted(value) { verificationUrl = value; },
    state,
  });
  const view = (await read(begun.enrollmentId, actor, deps)).view;
  return verificationUrl === undefined ? view : { ...view, verificationUrl };
}

function buildCrsIdentity(request: EnrollRequest): CrsIdentity {
  if (!request.crsIdentity) {
    throw new AppError("invalid_payload", "Complete identity details are required for secure verification.");
  }
  const nameParts = request.name.trim().split(/\s+/);
  const firstName = nameParts.shift();
  const lastName = nameParts.join(" ");
  const digits = request.phone.replace(/\D/g, "");
  const phone = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (!firstName || !lastName || phone.length !== 10) {
    throw new AppError("invalid_payload", "Complete identity details are required for secure verification.");
  }
  return {
    firstName,
    lastName,
    email: request.email,
    phone,
    ...request.crsIdentity,
  };
}

function eventForResult(state: EnrollmentState, value: IdvResult): MachineEvent {
  if (value.outcome === "pass") {
    return state.view.idvState === "sms_sent"
      ? { kind: "idv_code_correct" }
      : { kind: "idv_answer_correct" };
  }
  // A terminal CRS SMFA rejection spends an identity attempt exactly like an incorrect answer;
  // the state machine owns subsequent retries and parking.
  if (value.outcome === "failed") {
    return state.view.idvState === "sms_sent"
      ? { kind: "idv_code_wrong" }
      : { kind: "idv_answer_wrong" };
  }
  return state.view.idvState === "sms_sent"
    ? { kind: "idv_code_wrong" }
    : { kind: "idv_answer_wrong" };
}

async function submitIdvWithActivationTarget(
  enrollmentId: string,
  body: IdvSubmitBody,
  actor: SessionProfile,
  supplied?: EnrollmentServiceDependencies,
): Promise<{ view: EnrollmentView; analysisTarget: EnrollmentAnalysisTarget | null }> {
  const deps = await dependencies(supplied);
  if (
    (deps.idvDriver === "crs" && body.kind !== "smfa_status") ||
    (deps.idvDriver === "mock" && body.kind === "smfa_status")
  ) {
    throw new AppError("invalid_payload", "The identity verification request is invalid.");
  }
  const state = await read(enrollmentId, actor, deps);
  if (!state.memberRef) throw new AppError("conflict", "Identity verification is not ready.");
  const providerResult = await safeProvider(() =>
    deps.idv.submit({
      attemptsUsed: state.attemptsUsed,
      // The quiz asks which business is associated with this application. It
      // used to grade against a fixture persona's company, because the adapter
      // was never told whose enrollment it was holding.
      businessName: state.businessName,
      enrollmentId,
      maxAttempts: state.maxAttempts,
      memberRef: state.memberRef as never,
      submission: body,
      ...(state.idvContinuation ? { continuation: state.idvContinuation as CrsIdvContinuation } : {}),
    }),
  );
  if (body.kind === "smfa_status" && providerResult.outcome === "retry") {
    return { view: state.view, analysisTarget: null };
  }
  const transition = nextState(machineState(state), eventForResult(state, providerResult), deps.now());
  const analysisTarget = await executeEffects(transition.effects, { actor, deps, identity: state.identity, state });
  return { view: (await read(enrollmentId, actor, deps)).view, analysisTarget };
}

export async function submitIdv(
  enrollmentId: string,
  body: IdvSubmitBody,
  actor: SessionProfile,
  supplied?: EnrollmentServiceDependencies,
): Promise<EnrollmentView> {
  // The delegated activation-aware path preserves `businessName: state.businessName` when it
  // submits the provider step; this public surface intentionally returns only the enrollment view.
  return (await submitIdvWithActivationTarget(enrollmentId, body, actor, supplied)).view;
}

export { submitIdvWithActivationTarget };

export async function revokeConsent(
  enrollmentId: string,
  kind: ConsentKind,
  actor: SessionProfile,
  supplied?: EnrollmentServiceDependencies,
): Promise<EnrollmentView> {
  const deps = await dependencies(supplied);
  const state = await read(enrollmentId, actor, deps);
  unwrap(await deps.repository.revokeConsent(state.clientId, kind, actor.id));
  if (kind === "monitoring" && deps.idvDriver === "crs" && state.memberRef) {
    await safeProvider(() => deps.idv.pause(state.memberRef as CrsMemberRef));
  }
  return (await read(enrollmentId, actor, deps)).view;
}

export async function reauthorizeConsent(
  enrollmentId: string,
  input: ReauthorizeConsentServiceInput,
  actor: SessionProfile,
  supplied?: EnrollmentServiceDependencies,
): Promise<EnrollmentView> {
  if (actor.role !== "consumer") {
    throw new AppError("forbidden", "Only the enrolled consumer can sign this authorization.");
  }
  const deps = await dependencies(supplied);
  const state = await read(enrollmentId, actor, deps);
  if (state.view.status === "cancelled") {
    throw new AppError("conflict", "A canceled enrollment cannot be reauthorized.");
  }
  const prior = state.view.consents.find((consent) => consent.kind === input.kind);
  if (!prior?.signedAt) {
    throw new AppError(
      "conflict",
      "This permission has no earlier signed grant to reauthorize.",
    );
  }
  const signature = input.signature.trim();
  if (signature.toLocaleLowerCase("en-US") !== state.identity.fullName.trim().toLocaleLowerCase("en-US")) {
    throw new AppError(
      "invalid_payload",
      "Type your full legal name exactly as it appears on your account.",
    );
  }

  // The RPC is the legal write boundary: it scopes the actor again, retains a
  // new e-signature and grant atomically, and returns the same grant when this
  // draft is retried. The browser never supplies the governed text version.
  unwrap(await deps.repository.reauthorizeConsent({
    actorId: actor.id,
    draftId: input.draftId,
    enrollmentId,
    ip: input.ip,
    kind: input.kind,
    signerName: state.identity.fullName.trim(),
    textVersion: currentVersion(input.kind),
    typedSignature: signature,
    userAgent: input.userAgent,
  }));

  // Durable authority is written before an external monitoring resume. If CRS
  // is temporarily unavailable, the same draft can be retried without another
  // grant and resumeMember's provider contract is idempotent. Only the opaque
  // member routing reference leaves this service; raw bureau data never does.
  if (input.kind === "monitoring" && deps.idvDriver === "crs" && state.memberRef) {
    await safeProvider(() => deps.idv.resume(state.memberRef as CrsMemberRef));
  }

  return (await read(enrollmentId, actor, deps)).view;
}

export async function recordMilestone(
  enrollmentId: string,
  kind: MilestoneKind,
  actor: SessionProfile,
  supplied?: EnrollmentServiceDependencies,
): Promise<EnrollmentView> {
  const deps = await dependencies(supplied);
  const state = await read(enrollmentId, actor, deps);
  unwrap(await deps.repository.recordMilestone(state.clientId, kind, actor.id));
  return (await read(enrollmentId, actor, deps)).view;
}

export async function cancelEnrollment(
  enrollmentId: string,
  actor: SessionProfile,
  supplied?: EnrollmentServiceDependencies,
): Promise<EnrollmentView> {
  const deps = await dependencies(supplied);
  const state = await read(enrollmentId, actor, deps);
  const transition = nextState(machineState(state), { kind: "cancel" }, deps.now());
  await executeEffects(transition.effects, { actor, deps, identity: state.identity, state });
  return (await read(enrollmentId, actor, deps)).view;
}

export async function reconcile(
  enrollmentId: string,
  actor: SessionProfile,
  supplied?: EnrollmentServiceDependencies,
): Promise<EnrollmentView> {
  const deps = await dependencies(supplied);
  let state = await read(enrollmentId, actor, deps);

  if (state.subscription?.status === "review_required") {
    throw billingConfigurationFailure();
  }

  // Crash case 2: the retained agreement exists but setup authorization did not finish.
  if (state.view.status === "enrolled" && !state.subscription) {
    await authorizeCard(state, actor, deps);
    state = await read(enrollmentId, actor, deps);
  }

  // Crash case 3: setup exists but IDV session creation was interrupted.
  if (state.view.status === "enrolled" && state.view.idvState === "pending") {
    const transition = nextState(machineState(state), { kind: "idv_start" }, deps.now());
    await executeEffects(transition.effects, { actor, deps, identity: state.identity, state });
    state = await read(enrollmentId, actor, deps);
  }

  // Crash case 5: IDV activated the enrollment but subscription settlement did not finish.
  if (state.view.idvState === "passed" && state.subscription?.status === "authorized") {
    if (!hasCurrentSubscriptionConsents(state)) {
      return { ...state.view, needsOperatorAttention: "consent_withdrawn" };
    }
    await executeEffect({ kind: "start_subscription" }, { actor, deps, identity: state.identity, state });
    state = await read(enrollmentId, actor, deps);
  }

  return state.view;
}
