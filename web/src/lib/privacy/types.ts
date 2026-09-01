export const PRIVACY_REQUEST_KINDS = ["access", "deletion"] as const;
export const PRIVACY_REQUEST_STATUSES = ["submitted", "in_review", "denied", "completed"] as const;

export type PrivacyRequestKind = (typeof PRIVACY_REQUEST_KINDS)[number];
export type PrivacyRequestStatus = (typeof PRIVACY_REQUEST_STATUSES)[number];

export type PrivacyRequest = Readonly<{
  completedAt: string | null;
  completionNote: string | null;
  consumerEmail: string;
  consumerName: string;
  denialReason: string | null;
  deniedAt: string | null;
  id: string;
  kind: PrivacyRequestKind;
  organizationName: string;
  reviewedAt: string | null;
  status: PrivacyRequestStatus;
  submittedAt: string;
  updatedAt: string;
}>;

export const PRIVACY_ERASURE_BLOCKERS = [
  "active_subscription",
  "billing_cancellation_required",
  "enrollment_cancellation_required",
  "monitoring_provider_cleanup_pending",
  "provider_cancellation_pending",
] as const;

export type PrivacyErasureBlocker = (typeof PRIVACY_ERASURE_BLOCKERS)[number];

export type PrivacyStorageTarget = Readonly<{
  bucket: "client-documents" | "credit-reports";
  objectPath: string;
}>;

export type PrivacyErasurePlan = Readonly<{
  blockers: readonly PrivacyErasureBlocker[];
  profileId: string;
  pseudonymEmail: string;
  targets: readonly PrivacyStorageTarget[];
}>;

export type PrivacyAction =
  | Readonly<{ action: "review" }>
  | Readonly<{ action: "deny"; reason: string }>
  | Readonly<{ action: "complete"; completionNote: string | null }>;

export class PrivacyWorkflowError extends Error {
  readonly blockers: readonly PrivacyErasureBlocker[];
  readonly code:
    | "auth_disable_failed"
    | "erasure_blocked"
    | "invalid_request"
    | "invalid_state"
    | "not_found"
    | "read_failed"
    | "storage_cleanup_failed"
    | "write_failed";

  constructor(
    code: PrivacyWorkflowError["code"],
    blockers: readonly PrivacyErasureBlocker[] = [],
  ) {
    super(code);
    this.name = "PrivacyWorkflowError";
    this.code = code;
    this.blockers = Object.freeze([...blockers]);
  }
}
