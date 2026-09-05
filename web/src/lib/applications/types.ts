/**
 * The typed shape of Phase 11's applications and outcomes.
 *
 * Every union here mirrors an enum that exists in
 * `supabase/migrations/080_applications_outcomes.sql` (and, for the refresh
 * queue status, `081_outcome_stats_writeback.sql`). The migrations are the
 * authority and these copy them, never the other way round: a union that drifts
 * turns a `23514` the database would have caught into a runtime surprise a
 * caller has to debug.
 *
 * Each union comes with a `*_VALUES` companion so runtime validation and the
 * compile-time type come from one list. The TypeScript `enum` keyword appears
 * nowhere — `web/scripts/verify-source-gates.mjs` bans it, and a
 * string-literal union plus a frozen array does the same job without emitting a
 * runtime object.
 */

/**
 * The largest page a bounded list call may ask for.
 *
 * It is deliberately one more than the thirty records the assistant will ground
 * an answer on. A reader that can only ever see its own ceiling cannot tell "the
 * client has exactly thirty applications" from "the client has more than thirty
 * and you are looking at part of them", and that is the difference between a
 * complete answer and a partial one presented as complete. Asking for the extra
 * row is what makes the overflow detectable at all.
 */
export const APPLICATION_LIST_CEILING = 31;

// --- The eight enums migration 080 declares -------------------------------

export const APPLICATION_OPERATOR_STATUS_VALUES = ["wait", "todo"] as const;
export type ApplicationOperatorStatus =
  (typeof APPLICATION_OPERATOR_STATUS_VALUES)[number];

export const APPLICATION_CONSUMER_STATUS_VALUES = [
  "approved",
  "pending",
  "denied",
] as const;
export type ApplicationConsumerStatus =
  (typeof APPLICATION_CONSUMER_STATUS_VALUES)[number];

export const APPLICATION_VISIBILITY_VALUES = [
  "inherit",
  "details",
  "status_only",
] as const;
export type ApplicationVisibility =
  (typeof APPLICATION_VISIBILITY_VALUES)[number];

export const APPLICATION_NOTE_AUTHOR_KIND_VALUES = [
  "consumer",
  "operator",
] as const;
export type ApplicationNoteAuthorKind =
  (typeof APPLICATION_NOTE_AUTHOR_KIND_VALUES)[number];

export const OUTCOME_KIND_VALUES = ["approved", "denied", "withdrawn"] as const;
export type OutcomeKind = (typeof OUTCOME_KIND_VALUES)[number];

export const OUTCOME_STATE_VALUES = ["counted", "removed"] as const;
export type OutcomeState = (typeof OUTCOME_STATE_VALUES)[number];

export const OUTCOME_REVIEW_STATE_VALUES = [
  "pending",
  "approved",
  "removed",
] as const;
export type OutcomeReviewState = (typeof OUTCOME_REVIEW_STATE_VALUES)[number];

export const OUTCOME_NOTIFICATION_KIND_VALUES = [
  "outcome_review_approved",
  "outcome_review_removed",
] as const;
export type OutcomeNotificationKind =
  (typeof OUTCOME_NOTIFICATION_KIND_VALUES)[number];

// --- The enum and the two text domains migration 081 adds ------------------

export const OUTCOME_JOB_STATUS_VALUES = [
  "queued",
  "running",
  "succeeded",
  "failed",
] as const;
export type OutcomeJobStatus = (typeof OUTCOME_JOB_STATUS_VALUES)[number];

/**
 * `recorded` is the only state a run without VAULT credentials can produce, and
 * the write-back arm that produces the other two is key-arrival work (KA-11-1).
 */
export const VAULT_WRITEBACK_STATE_VALUES = [
  "recorded",
  "delivered",
  "failed",
] as const;
export type VaultWritebackState =
  (typeof VAULT_WRITEBACK_STATE_VALUES)[number];

/**
 * `bank_datapoints` is the one live VAULT destination compatible with an
 * outcome: its required `bank_slug` and `dp_type` map from the approved
 * payload. `data_points` needs a Vault `bank_id`, which the outbox does not
 * have. The schema was read from the live project on 2026-09-05.
 */
export const VAULT_WRITEBACK_TARGET_VALUES = [
  "bank_datapoints",
] as const;
export type VaultWritebackTarget =
  (typeof VAULT_WRITEBACK_TARGET_VALUES)[number];

export const BANK_HEAT_LEVEL_VALUES = ["hot", "warm", "cold"] as const;
export type BankHeatLevel = (typeof BANK_HEAT_LEVEL_VALUES)[number];

// --- Row shapes ------------------------------------------------------------

export interface Application {
  id: string;
  clientId: string;
  bankRef: string;
  operatorStatus: ApplicationOperatorStatus;
  consumerStatus: ApplicationConsumerStatus;
  /**
   * Null means "no amount recorded on the tab yet", which is legal on an
   * application at any status. `applications_amount_nonnegative` is what stops
   * a negative from ever arriving.
   */
  amountCents: number | null;
  visibility: ApplicationVisibility;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationNote {
  id: string;
  applicationId: string;
  authorProfileId: string;
  authorKind: ApplicationNoteAuthorKind;
  body: string;
  attested: boolean;
  createdAt: string;
}

export interface Outcome {
  id: string;
  applicationId: string;
  bankRef: string;
  clientId: string;
  kind: OutcomeKind;
  /**
   * Null is legal only on a non-approved outcome; an approved one always
   * carries a positive amount. The rule is not this type's to keep —
   * `outcomes_amount_shape` in migration 080 enforces it in both directions,
   * and this field is nullable because that constraint says it may be.
   */
  amountCents: number | null;
  state: OutcomeState;
  recordedByKind: ApplicationNoteAuthorKind;
  decidedOn: string;
  createdAt: string;
}

export interface OutcomeReview {
  id: string;
  outcomeId: string;
  state: OutcomeReviewState;
  reviewedAt: string | null;
  reasonCode: string | null;
  createdAt: string;
}

export interface BankOutcomeStatsWindow {
  approved: number;
  denied: number;
  withdrawn: number;
  approvedAmountCents: number;
}

export interface BankOutcomeStats {
  bankRef: string;
  statsVersion: number;
  heatLevel: BankHeatLevel;
  windows: Record<"d30" | "d60" | "d90" | "d183" | "d365", BankOutcomeStatsWindow>;
  /** Null means no counted outcome for this lender, which reads as cold. */
  lastOutcomeAt: string | null;
  approvedAmountCentsTotal: number;
  outcomeCountTotal: number;
  computedAt: string;
}

export interface BankRetrievalPayload {
  bank_ref: string;
  heat_level: BankHeatLevel;
  windows: Record<"d30" | "d60" | "d90" | "d183" | "d365", BankOutcomeStatsWindow>;
  stats_version?: number;
  last_outcome_at?: string | null;
  approved_amount_cents_total?: number;
  outcome_count_total?: number;
}

export interface BankRetrievalDocument {
  bankRef: string;
  statsVersion: number;
  document: BankRetrievalPayload;
  documentFingerprint: string;
  rebuiltAt: string;
}

export interface OutcomeNotification {
  id: string;
  outcomeId: string;
  kind: OutcomeNotificationKind;
  createdAt: string;
  readAt: string | null;
}

export interface OutcomeRefreshJob {
  id: string;
  bankRef: string;
  changeId: string;
  subject: string;
  window: string;
  idempotencyKey: string;
  status: OutcomeJobStatus;
  attemptCount: number;
  errorCode: string | null;
}

export interface VaultWritebackRow {
  id: string;
  outcomeId: string;
  bankRef: string;
  target: VaultWritebackTarget;
  /** Always `mostfundable`; APPS-03's attribution is a check constraint. */
  source: string;
  payload: Record<string, unknown>;
  state: VaultWritebackState;
  recordedAt: string;
  failureCode: string | null;
}

// --- Inputs ----------------------------------------------------------------

export interface CreateApplicationInput {
  clientId: string;
  bankRef: string;
  amountCents?: number | null;
  /** Both statuses have column defaults; a caller may still open on either. */
  operatorStatus?: ApplicationOperatorStatus;
  consumerStatus?: ApplicationConsumerStatus;
  visibility?: ApplicationVisibility;
  createdBy: string;
}

export interface UpdateApplicationInput {
  applicationId: string;
  operatorStatus?: ApplicationOperatorStatus;
  consumerStatus?: ApplicationConsumerStatus;
  amountCents?: number | null;
  visibility?: ApplicationVisibility;
}

export interface AddNoteInput {
  applicationId: string;
  authorProfileId: string;
  authorKind: ApplicationNoteAuthorKind;
  body: string;
  attested: boolean;
}

export interface RecordOutcomeInput {
  applicationId: string;
  kind: OutcomeKind;
  amountCents: number | null;
  /** Null lets `record_outcome` fall back to the database's `current_date`. */
  decidedOn: string | null;
  actorProfileId: string;
}

export interface ReviewOutcomeInput {
  outcomeId: string;
  decision: Exclude<OutcomeReviewState, "pending">;
  actorProfileId: string;
}

export interface ReviewOutcomeResult {
  /** `unchanged` means the decision was already in force and nothing was written. */
  result: "decided" | "unchanged";
  reviewState: OutcomeReviewState;
  outboxState: VaultWritebackState | null;
  notified: boolean;
}

export interface FailRefreshJobInput {
  jobId: string;
  workerId: string;
  errorCode: string;
  retry: boolean;
  retryAfterSeconds: number;
}

// --- Approved copy ---------------------------------------------------------
//
// Every string below is one the pre-flight's third pass checked against what
// the schema can actually support. None of them is a forward-looking claim.

/** Historical, per the #21/#206/#209 line that these are outcomes and not offers. */
export const BANK_STATS_LABEL = "Recorded outcomes for this lender.";

/** Both halves are true at the instant the route returns it. */
export const OUTCOME_COUNTED_LABEL =
  "This outcome is counted. A platform admin can correct it.";

/**
 * Deliberately not "Synced". On the fixture driver nothing has been sent
 * anywhere, so `recorded` is the only honest word — a "synced" label with an
 * unsent row behind it is exactly the kind of infrastructure claim with nothing
 * under it that PRE-FLIGHT.md names. The delivered-state string belongs to the
 * `supabase` write-back arm and is unreachable without VAULT credentials.
 */
export const WRITEBACK_RECORDED_LABEL = "Recorded for the funding brain.";

/** Mirrors `api/clients/[id]/route.ts`'s `tracker_disabled` shape. */
export const APPLICATIONS_DISABLED_CODE = "applications_disabled";
export const APPLICATIONS_DISABLED_MESSAGE = "Applications are disabled.";

/** Names the `application_notes_operator_attestation` constraint that exists. */
export const ATTESTATION_REQUIRED_CODE = "attestation_required";

// --- Errors ----------------------------------------------------------------

export const APPLICATIONS_ERROR_CODES = [
  "disabled",
  "forbidden",
  "not_found",
  "conflict",
  "unknown_reference",
  "attestation_required",
  "configuration_error",
  "failed",
] as const;
export type ApplicationsErrorCode = (typeof APPLICATIONS_ERROR_CODES)[number];

/**
 * Carries a code and nothing else. The database message is never attached:
 * it names tables, constraints and sometimes row values, and the route layer
 * answers with the code plus a fixed string instead.
 */
export class ApplicationsError extends Error {
  readonly name = "ApplicationsError";
  readonly code: ApplicationsErrorCode;

  // Written out rather than as a constructor parameter property, because Node's
  // strip-only TypeScript mode rejects parameter properties and this module is
  // reachable from `node --test`.
  constructor(code: ApplicationsErrorCode) {
    super("Applications operation failed");
    this.code = code;
  }
}
