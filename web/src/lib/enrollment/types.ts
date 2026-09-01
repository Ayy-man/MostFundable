import type { CrsIdentity, IdvState } from '@/lib/idv/types';

export const ENROLLMENT_STATUSES = [
  'enrolled',
  'active',
  'parked',
  'cancelled',
] as const;

export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export type MilestoneKind =
  | 'agreement_signed'
  | 'documents_uploaded'
  | 'monitoring_connected'
  | 'onboarding_call_completed';

export type ConsentKind = 'monitoring' | 'analysis';

export type MachineState = {
  status: EnrollmentStatus;
  idvState: IdvState;
  attemptsUsed: number;
  maxAttempts: number;
  subscriptionSettled: boolean;
};

export type MachineEvent =
  | { kind: 'idv_start' }
  | { kind: 'idv_code_correct' }
  | { kind: 'idv_code_wrong' }
  | { kind: 'idv_answer_correct' }
  | { kind: 'idv_answer_wrong' }
  | { kind: 'cancel' };

export type MachineEffect =
  | { kind: 'start_subscription' }
  | { kind: 'settle_idv'; outcome: 'retry'; nextState: 'quiz' | 'retry' }
  | { kind: 'park'; until: string }
  | { kind: 'activate' }
  | { kind: 'cancel_subscription' }
  | { kind: 'record_milestone'; milestone: MilestoneKind }
  | { kind: 'start_idv' };

export type MachineResult = {
  next: MachineState;
  effects: readonly MachineEffect[];
};

// This deliberately carries identity and consent evidence only. Its narrow
// field list is a security control enforced again by the request validator.
export type EnrollRequest = {
  aff?: string;
  draftId: string;
  name: string;
  email: string;
  phone: string;
  monitoring: boolean;
  analysis: boolean;
  signature: string;
  /** CRS-only transient identity. The enrollment repository has no field for this value. */
  crsIdentity?: Pick<CrsIdentity, 'dateOfBirth' | 'ssn' | 'address'>;
};

export type EnrollResponse = {
  enrollmentId: string;
};

export type EnrollConfig = {
  affiliate?: null | { code: string; valid: boolean };
  enabled: boolean;
  idvDriver: string;
  priceCents: number;
  currency: string;
  currentEnrollment?: EnrollmentView | null;
  /** Demo-only: the signed-in consumer may reset their enrollment through `POST /api/enroll/reset`. */
  demoResetAvailable?: boolean;
  enrollments?: EnrollmentSummary[];
};

export type EnrollmentSummary = {
  clientId: string;
  displayName: string;
  email: string | null;
  enrollmentId: string;
  parkedUntil: string | null;
  status: EnrollmentStatus;
};

export type IdvSubmitBody =
  | { kind: 'sms'; code: string }
  | { kind: 'smfa_status' }
  | {
      kind: 'quiz';
      answers: Array<{ questionId: string; answerId: string }>;
    };

export type RevokeConsentBody = {
  kind: ConsentKind;
};

export type ReauthorizeConsentBody = {
  /** An explicit legal affirmation; omission and false are both rejected. */
  accepted: true;
  /** Stable across retries so one signed action can never create two grants. */
  draftId: string;
  kind: ConsentKind;
  signature: string;
};

/**
 * The consumer-safe projection of `public.consumer_subscriptions`.
 *
 * Account & Billing used to render a $49 plan, a saved Visa and months of paid history out of
 * module fixtures for every consumer, enrolled or not — history dated before any enrollment
 * existed, which contradicts the product's own rule that no charge happens before a successful
 * enrollment. `readEnrollmentState` already read the subscription row for the settlement paths; it
 * simply never projected it, so the surface had nothing durable to render and fell back to the
 * fixture. This block is that projection.
 *
 * It deliberately carries no provider reference. `customer_ref`, `setup_intent_ref`,
 * `payment_method_ref`, `price_ref` and `subscription_ref` stay server-side in `SubscriptionState`;
 * what a consumer's own browser needs is whether a method is on file, not its Stripe id. And there
 * is no card brand or last4 here because migration 022 stores neither — the surface renders that
 * absence rather than inventing "Visa ending 4242".
 */
export type SubscriptionView = {
  activatedAt: string | null;
  authorizedAt: string;
  cancelledAt: string | null;
  currency: string;
  paymentMethodOnFile: boolean;
  priceCents: number;
  status: 'authorized' | 'active' | 'cancelled' | 'review_required';
};

export type EnrollmentView = {
  enrollmentId: string;
  status: EnrollmentStatus;
  idvState: IdvState;
  attemptsRemaining: number;
  parkedUntil: string | null;
  lockedUntil: string | null;
  milestones: ReadonlyArray<{
    kind: MilestoneKind;
    completedAt: string;
    by: string | null;
  }>;
  consents: ReadonlyArray<{
    kind: ConsentKind;
    authorized: boolean;
    signedAt: string | null;
    textVersion: string;
  }>;
  needsOperatorAttention: 'consent_withdrawn' | 'subscription_attempt_stale' | 'subscription_configuration_review' | null;
  /** Null when the enrollment has no subscription row yet — a card was authorized but nothing settled. */
  subscription: SubscriptionView | null;
  /** Development-sandbox only and response-only; never written by the enrollment repository. */
  verificationUrl?: string;
};
