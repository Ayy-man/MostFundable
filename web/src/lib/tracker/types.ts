export const TRACKER_STAGES = [
  "onboarding",
  "optimization",
  "ready",
  "applying",
  "funded",
  "graduate",
] as const;

export type TrackerStage = (typeof TRACKER_STAGES)[number];

export const TRACKER_STAGE_LABELS: Readonly<Record<TrackerStage, string>> = {
  onboarding: "Onboarding",
  optimization: "Optimization",
  ready: "Ready",
  applying: "Applying",
  funded: "Funded",
  graduate: "Graduate",
};

const STAGE_BY_LABEL = Object.fromEntries(
  TRACKER_STAGES.map((stage) => [TRACKER_STAGE_LABELS[stage], stage]),
) as Record<string, TrackerStage>;

export function trackerStageFromLabel(label: string): TrackerStage | null {
  return STAGE_BY_LABEL[label] ?? null;
}

export type TrackerMonitoringStatus = "active" | "paused" | "pending";
export type TrackerHealth = "green" | "amber" | "red";
export type TrackerClientStatus = "active" | "archived";
export const TRACKER_ASSIGNEE_ORG_ROLES = [
  "owner",
  "admin",
  "prep_specialist",
  "funding_specialist",
  "commando",
  "manager",
  "member",
] as const;
export type TrackerAssigneeOrgRole = (typeof TRACKER_ASSIGNEE_ORG_ROLES)[number];

export function isTrackerAssigneeOrgRole(value: unknown): value is TrackerAssigneeOrgRole {
  return typeof value === "string"
    && TRACKER_ASSIGNEE_ORG_ROLES.includes(value as TrackerAssigneeOrgRole);
}

export interface TrackerHistoryEntry {
  at: string;
  changedBy: string | null;
  from: TrackerStage | null;
  to: TrackerStage;
}

export const TRACKER_CLIENT_KEYS = [
  "id",
  "consumerProfileId",
  "displayName",
  "businessName",
  "assignedToId",
  "assignedToName",
  "assignedToOrgRole",
  "assignedToActive",
  "stage",
  "stageEnteredAt",
  "startedAt",
  "history",
  "analysisAt",
  "analysisPending",
  "readiness",
  "openActionCount",
  "estimatedCompletionAt",
  "monitoring",
  "nextRefreshAt",
  "goalCents",
  "matchesUnlockedOverride",
  "fundingApprovedCents",
  "health",
  "status",
  "lastActivityAt",
  "archivedAt",
  "archivedById",
] as const;

export interface TrackerClient {
  id: string;
  consumerProfileId: string | null;
  displayName: string;
  businessName: string | null;
  assignedToId: string | null;
  assignedToName: string | null;
  /** The assignee's stored workspace role; null means the role cannot be proven. */
  assignedToOrgRole?: TrackerAssigneeOrgRole | null;
  /** True only when the assigned operator profile is not disabled. */
  assignedToActive?: boolean | null;
  stage: TrackerStage;
  stageEnteredAt: string;
  startedAt: string;
  history: TrackerHistoryEntry[];
  analysisAt: string | null;
  /**
   * Live state of the client's undrained analysis work, derived from the
   * non-terminal `analysis_jobs` rows: "queued" until a worker claims the job,
   * "running" while it executes or persists, null when nothing is in flight.
   * A progress hint for waiting surfaces — never a substitute for the
   * persisted truth in `analysisAt`/`readiness`.
   */
  analysisPending: "queued" | "running" | null;
  readiness: number | null;
  openActionCount: number | null;
  estimatedCompletionAt: string | null;
  monitoring: TrackerMonitoringStatus;
  nextRefreshAt: string | null;
  goalCents: number | null;
  matchesUnlockedOverride: boolean;
  /** clients.funded_amount_cents when positive; null means no recorded funding. */
  fundingApprovedCents: number | null;
  health: TrackerHealth;
  status: TrackerClientStatus;
  lastActivityAt: string;
  archivedAt: string | null;
  archivedById: string | null;
}

export interface TrackerAssignableMember {
  /** Only active operator-member profiles from the caller's organization appear here. */
  active: true;
  fullName: string;
  id: string;
  isCurrentUser: boolean;
  orgRole: TrackerAssigneeOrgRole;
}

export type TrackerReadResponse =
  | { enabled: false; clients: [] }
  | {
      assignableMembers?: TrackerAssignableMember[];
      enabled: true;
      consoleOpsEnabled?: boolean;
      currentProfileId?: string;
      clients: TrackerClient[];
    };

export interface TrackerClientCreateInput {
  consumerProfileId?: string | null;
  displayName: string;
  businessName?: string | null;
  affiliateId?: string | null;
  goalCents?: number | null;
}

export type TrackerCreateResult =
  | { outcome: "created"; client: TrackerClient; assignmentRequired: boolean }
  | { outcome: "existing"; client: TrackerClient; assignmentRequired: boolean }
  | { outcome: "conflict" | "invalid_profile" };

export interface TrackerStagePatch {
  stage: TrackerStage;
  expectedStage: TrackerStage;
}

export interface TrackerMetadataPatch {
  assignedToId?: string | null;
  businessName?: string | null;
  displayName?: string;
  goalCents?: number | null;
  matchesUnlockedOverride?: boolean;
}

export interface TrackerClientStatusPatch {
  status: TrackerClientStatus;
}

export type TrackerPatchInput = TrackerStagePatch | TrackerMetadataPatch | TrackerClientStatusPatch;

export const OVERVIEW_TOP_KEYS = [
  "stage",
  "monitoring",
  "nextRefresh",
] as const;

export const OVERVIEW_BOTTOM_KEYS = [
  "readiness",
  "openActions",
  "estimatedCompletion",
  "fundingApproved",
] as const;

export type TrackerTransitionOutcome =
  | "transitioned"
  | "duplicate"
  | "unchanged"
  | "stale"
  | "not_found"
  | "disabled";

export interface TrackerTransitionResult {
  outcome: TrackerTransitionOutcome;
  currentStage: TrackerStage | null;
  stageEnteredAt: string | null;
}

export interface TrackerManualTransitionInput {
  clientId: string;
  expectedStage: TrackerStage;
  stage: TrackerStage;
}

export interface EnrollmentActivatedInput {
  clientId: string;
  enrollmentId: string;
}

export interface AnalysisCompletedInput {
  analysisRunId: string;
  clientId: string;
}

export interface TrackerReadFilters {
  scope: "mine" | "all";
  stage?: TrackerStage;
  member?: string;
  affiliate?: string;
  /** Omitted means the existing active-only book. */
  status?: TrackerClientStatus | "all";
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: "invalid_request"; message: string };

// Postgres accepts UUID values without requiring an RFC version/variant nibble;
// the stable seed identities use that wider canonical representation.
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isTrackerUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isTrackerStage(value: unknown): value is TrackerStage {
  return typeof value === "string" && TRACKER_STAGES.includes(value as TrackerStage);
}

export function isTrackerClientStatus(value: unknown): value is TrackerClientStatus {
  return value === "active" || value === "archived";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function validOptionalText(value: unknown, max: number): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim().length > 0 && value.trim().length <= max);
}

function validCents(value: unknown): value is number | null | undefined {
  return value === undefined || value === null || (Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 100_000_000_000);
}

export function validateTrackerCreateInput(input: unknown): ValidationResult<TrackerClientCreateInput> {
  const allowed = ["consumerProfileId", "displayName", "businessName", "affiliateId", "goalCents"];
  if (!isRecord(input) || !hasOnlyKeys(input, allowed)) return invalid("Create input contains unsupported fields");
  if (typeof input.displayName !== "string" || input.displayName.trim().length < 1 || input.displayName.trim().length > 160) return invalid("displayName is required and must be at most 160 characters");
  if (input.consumerProfileId !== undefined && input.consumerProfileId !== null && !isTrackerUuid(input.consumerProfileId)) return invalid("consumerProfileId must be a UUID");
  if (input.affiliateId !== undefined && input.affiliateId !== null && !isTrackerUuid(input.affiliateId)) return invalid("affiliateId must be a UUID");
  if (!validOptionalText(input.businessName, 160)) return invalid("businessName must be non-empty and at most 160 characters");
  if (!validCents(input.goalCents)) return invalid("goalCents is outside the permitted range");
  return {
    ok: true,
    value: {
      displayName: input.displayName.trim(),
      ...(input.consumerProfileId !== undefined ? { consumerProfileId: input.consumerProfileId as string | null } : {}),
      ...(input.businessName !== undefined ? { businessName: input.businessName === null ? null : (input.businessName as string).trim() } : {}),
      ...(input.affiliateId !== undefined ? { affiliateId: input.affiliateId as string | null } : {}),
      ...(input.goalCents !== undefined ? { goalCents: input.goalCents as number | null } : {}),
    },
  };
}

export function validateTrackerPatchInput(input: unknown): ValidationResult<TrackerPatchInput> {
  if (!isRecord(input)) return invalid("PATCH body must be an object");
  const keys = Object.keys(input);
  const hasStage = "stage" in input || "expectedStage" in input;
  if (hasStage) {
    if (keys.length !== 2 || !hasOnlyKeys(input, ["stage", "expectedStage"])) return invalid("Stage changes accept only stage and expectedStage");
    if (!isTrackerStage(input.stage) || !isTrackerStage(input.expectedStage)) return invalid("stage and expectedStage must be valid tracker stages");
    return { ok: true, value: { stage: input.stage, expectedStage: input.expectedStage } };
  }
  if ("status" in input) {
    if (keys.length !== 1 || !isTrackerClientStatus(input.status)) return invalid("Status changes accept only active or archived status");
    return { ok: true, value: { status: input.status } };
  }
  if (keys.length === 0 || !hasOnlyKeys(input, ["assignedToId", "businessName", "displayName", "goalCents", "matchesUnlockedOverride"])) {
    return invalid("Metadata changes contain unsupported fields");
  }
  if (
    input.assignedToId !== undefined
    && input.assignedToId !== null
    && !isTrackerUuid(input.assignedToId)
  ) return invalid("assignedToId must be a UUID or null");
  if (!validOptionalText(input.businessName, 160)) return invalid("businessName must be null or non-empty and at most 160 characters");
  if (
    input.displayName !== undefined
    && (typeof input.displayName !== "string"
      || input.displayName.trim().length === 0
      || input.displayName.trim().length > 160)
  ) return invalid("displayName must be non-empty and at most 160 characters");
  if (!validCents(input.goalCents)) return invalid("goalCents is outside the permitted range");
  if (input.matchesUnlockedOverride !== undefined && typeof input.matchesUnlockedOverride !== "boolean") return invalid("matchesUnlockedOverride must be boolean");
  return {
    ok: true,
    value: {
      ...(input.assignedToId !== undefined ? { assignedToId: input.assignedToId as string | null } : {}),
      ...(input.businessName !== undefined
        ? { businessName: input.businessName === null ? null : (input.businessName as string).trim() }
        : {}),
      ...(input.displayName !== undefined ? { displayName: (input.displayName as string).trim() } : {}),
      ...(input.goalCents !== undefined ? { goalCents: input.goalCents as number | null } : {}),
      ...(input.matchesUnlockedOverride !== undefined ? { matchesUnlockedOverride: input.matchesUnlockedOverride } : {}),
    },
  };
}

function invalid(message: string): ValidationResult<never> {
  return { ok: false, code: "invalid_request", message };
}
