/**
 * The conversation timeline contract — the one shape both the read path (`web/src/lib/timeline/`)
 * and the thread renderer (`web/src/components/chat/`) agree on.
 *
 * Approved 2026-08-25 from `docs/plans/2026-08-24-conversation-timeline-design.md` and the
 * mockup beside it. The mockup's `CATALOG` is the reference for every field below: a kind's
 * payload is exactly what its copy, facts, status and actions need, and nothing else. Anything
 * bureau-derived (`analysis_runs.derived`, monitoring payloads, `derived_features`) has no field
 * here on purpose — the deny-list test in `deny-list.test.ts` asserts that no reader can populate one.
 *
 * Rules that are not negotiable:
 * - An event is never a message: no author, no bubble side. `actor` is a fact on the card, not a sender.
 * - `at` is where the row sits in the thread and never moves. State changes are carried by the
 *   status fields (`fulfilledAt`, `verifiedAt`, `completedAt`, `reportedAt`) and rendered as their
 *   own transition rows at the real instant; the origin row keeps its opening title.
 * - Instants (`at`, `*At`) are ISO-8601 UTC. Calendar facts (`*On`) are `YYYY-MM-DD` date-only and
 *   must be formatted in UTC so a charge date never shifts a day across zones (G-BILL-01's class).
 * - The consumer projection is decided by the reader, not the renderer: an operator-only kind, an
 *   unreleased outcome, or an internal fact never leaves the server for a consumer session.
 */

export type TimelineAudience = "consumer" | "operator";

export type TimelineKind =
  | "thread_opened"
  | "thread_status"
  | "stage_changed"
  | "enrollment_milestone"
  | "subscription"
  | "consent_revoked"
  | "assignment"
  | "analysis_completed"
  | "action"
  | "document_filed"
  | "document_requested"
  | "refresh"
  | "refresh_blocked"
  | "fee_payment"
  | "application_outcome";

/** Every kind carries these; the per-kind members add what its card renders. */
interface TimelineBase {
  /** @opaque React identity, stable across reads. Never rendered. */
  readonly ref: string;
  readonly kind: TimelineKind;
  /** ISO instant the row sits at in the thread. */
  readonly at: string;
  /** The client's first name as the operator sees it; the consumer projection omits it. */
  readonly client?: string;
  /** A person, when a person caused it. Never a guessed name; never sent to the consumer for `thread_status`. */
  readonly actor?: string;
  /** Rendered on the utility-rail gray with a lock; the consumer reader never emits one. */
  readonly operatorOnly?: boolean;
}

export interface ThreadOpenedEvent extends TimelineBase {
  readonly kind: "thread_opened";
}

export interface ThreadStatusEvent extends TimelineBase {
  readonly kind: "thread_status";
  readonly to: "resolved" | "open";
}

export interface StageChangedEvent extends TimelineBase {
  readonly kind: "stage_changed";
  readonly from?: string;
  /** Display label from the one stage taxonomy (Onboarding → Optimization → Ready → Applying → Funded → Graduate). */
  readonly to: string;
}

export interface EnrollmentMilestoneEvent extends TimelineBase {
  readonly kind: "enrollment_milestone";
  readonly milestone: "consents" | "esign" | "idv" | "active";
  /** Date-only; present on `active`. The card says "first charge dated", never a charged amount. */
  readonly firstChargeOn?: string;
}

export interface SubscriptionEvent extends TimelineBase {
  readonly kind: "subscription";
  readonly state: "active" | "cancelled";
  /** Date-only; present on `cancelled`. */
  readonly endsOn?: string;
}

export interface ConsentRevokedEvent extends TimelineBase {
  readonly kind: "consent_revoked";
  readonly which: "monitoring" | "analysis";
}

/** Operator-only. Needs `client_assignment_history` (change order, approved 2026-08-25). */
export interface AssignmentEvent extends TimelineBase {
  readonly kind: "assignment";
  readonly operatorOnly: true;
  readonly to: string;
  readonly from?: string;
}

export interface AnalysisCompletedEvent extends TimelineBase {
  readonly kind: "analysis_completed";
  /** The recorded readiness (0–100). A dated observation, never a movement the reader caused. */
  readonly readiness: number;
  readonly prev?: number;
  readonly prevAt?: string;
  /** Present only when the count was captured with this analysis run. */
  readonly open?: number;
  readonly trigger: "scheduled" | "refresh" | "manual";
  /** A newer run exists; the card drops its actions and speaks in the past tense. */
  readonly superseded?: boolean;
}

export interface ActionEvent extends TimelineBase {
  readonly kind: "action";
  /** The shipped Optimization item title. */
  readonly title: string;
  readonly state: "todo" | "reported" | "verified";
  readonly blocking: boolean;
  readonly reportedAt?: string;
  readonly verifiedAt?: string;
}

export interface DocumentFiledEvent extends TimelineBase {
  readonly kind: "document_filed";
  /** Document type label, e.g. "Bank statement". */
  readonly name: string;
  /** The same with its article for prose, e.g. "a bank statement". */
  readonly named: string;
  readonly section: string;
  /** `document_uploads.id` — the subject of "Mark reviewed" (`POST /api/uploads/[uploadId]/review`) and "Open document". */
  readonly uploadId: string;
  /** Needs `document_reviews` (change order, approved 2026-08-25). */
  readonly reviewedBy?: string;
}

/** Needs `document_requests` (change order, approved 2026-08-25). */
export interface DocumentRequestedEvent extends TimelineBase {
  readonly kind: "document_requested";
  readonly name: string;
  readonly named: string;
  readonly why: string;
  /** `document_requests.id`. */
  readonly requestId: string;
  readonly fulfilledAt?: string;
  /** The upload that fulfilled it, once one has; the subject of "Mark reviewed" and "Open document". */
  readonly uploadId?: string;
  readonly reviewedBy?: string;
}

export interface RefreshEvent extends TimelineBase {
  readonly kind: "refresh";
  readonly amountCents: number;
  readonly completedAt?: string;
  readonly readiness?: number;
}

/** Operator-only. */
export interface RefreshBlockedEvent extends TimelineBase {
  readonly kind: "refresh_blocked";
  readonly operatorOnly: true;
  /** Date-only. */
  readonly resetsOn: string;
  readonly lastReadiness: number;
  readonly lastRunAt: string;
}

export interface FeePaymentEvent extends TimelineBase {
  readonly kind: "fee_payment";
  readonly amountCents: number;
  /** Operator-only fact; the consumer projection omits it. */
  readonly balanceCents?: number;
  readonly method: string;
  /** Date-only. */
  readonly receivedOn: string;
}

/** The consumer projection omits the event entirely until `releasedOn` is set. */
export interface ApplicationOutcomeEvent extends TimelineBase {
  readonly kind: "application_outcome";
  readonly kindWord: "funded" | "declined" | "withdrawn";
  readonly bank: string;
  /** Present only when `kindWord === "funded"`. */
  readonly amountCents?: number;
  /** Date-only. */
  readonly decidedOn: string;
  /** Date-only. */
  readonly releasedOn?: string;
}

export type TimelineEvent =
  | ThreadOpenedEvent
  | ThreadStatusEvent
  | StageChangedEvent
  | EnrollmentMilestoneEvent
  | SubscriptionEvent
  | ConsentRevokedEvent
  | AssignmentEvent
  | AnalysisCompletedEvent
  | ActionEvent
  | DocumentFiledEvent
  | DocumentRequestedEvent
  | RefreshEvent
  | RefreshBlockedEvent
  | FeePaymentEvent
  | ApplicationOutcomeEvent;

/** What a thread read returns beside its messages. A failed event read never fails the messages. */
export interface TimelineRead {
  readonly events: readonly TimelineEvent[];
  /** Set when the event read failed; the renderer shows the "Updates couldn't load" line with Retry. */
  readonly readFailed?: boolean;
}

/**
 * Column and key names that may never appear on a timeline event, in any nesting. The deny-list
 * test walks every event a reader can produce against the seed and fails on any of these.
 */
export const TIMELINE_DENIED_KEYS = [
  "derived",
  "derived_features",
  "utilization",
  "balance",
  "limit",
  "inquiries",
  "inquiry_count",
  "account_count",
  "bureau",
  "bureaus",
  "score",
  "fico",
  "vantage",
  "tradeline",
  "tradelines",
  "ip",
  "ip_address",
  "user_agent",
  "signature_text",
  "typed_signature",
  "idv_attempts",
  "lock_until",
  "payload",
  "raw",
] as const;
