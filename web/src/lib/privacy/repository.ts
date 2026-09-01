import "server-only";

import {
  PRIVACY_ERASURE_BLOCKERS,
  PRIVACY_REQUEST_KINDS,
  PRIVACY_REQUEST_STATUSES,
  PrivacyWorkflowError,
  type PrivacyErasureBlocker,
  type PrivacyErasurePlan,
  type PrivacyRequest,
  type PrivacyRequestKind,
  type PrivacyStorageTarget,
} from "./types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PSEUDONYM_EMAIL = /^deleted\+[0-9a-f]{32}@privacy\.invalid$/;
const OBJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

type DbResult = PromiseLike<{ data: unknown; error: unknown }>;
interface PrivacyDatabase {
  rpc(name: string, args: Record<string, unknown>): DbResult;
}

export interface PrivacyRepository {
  completeAccess(requestId: string, actorId: string, completionNote: string): Promise<PrivacyRequest>;
  completeDeletion(requestId: string, actorId: string): Promise<PrivacyRequest>;
  deny(requestId: string, actorId: string, reason: string): Promise<PrivacyRequest>;
  erasurePlan(requestId: string, actorId: string): Promise<PrivacyErasurePlan>;
  get(actorId: string, requestId: string): Promise<PrivacyRequest | null>;
  list(actorId: string, limit?: number): Promise<readonly PrivacyRequest[]>;
  review(requestId: string, actorId: string): Promise<PrivacyRequest>;
  submit(actorId: string, kind: PrivacyRequestKind): Promise<PrivacyRequest>;
}

async function productionDatabase(): Promise<PrivacyDatabase> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient() as unknown as PrivacyDatabase;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  const row = record(value);
  return row && Object.keys(row).sort().join(",") === [...keys].sort().join(",") ? row : null;
}

function instant(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function nullableInstant(value: unknown): value is string | null {
  return value === null || instant(value);
}

function nullableText(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.trim().length > 0);
}

function boundedNullableText(value: unknown, max: number): value is string | null {
  return nullableText(value) && (value === null || value.length <= max);
}

function validObjectPath(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = value.split("/");
  return parts.length === 4
    && parts.slice(0, 3).every((part) => UUID.test(part))
    && OBJECT_NAME.test(parts[3])
    && parts[3] !== "."
    && parts[3] !== "..";
}

function mapRequest(value: unknown): PrivacyRequest | null {
  const row = exactRecord(value, [
    "completed_at", "completion_note", "consumer_email", "consumer_name",
    "denial_reason", "denied_at", "id", "kind", "organization_name",
    "reviewed_at", "status", "submitted_at", "updated_at",
  ]);
  if (!row || !UUID.test(String(row.id))
      || !PRIVACY_REQUEST_KINDS.includes(row.kind as PrivacyRequestKind)
      || !PRIVACY_REQUEST_STATUSES.includes(row.status as PrivacyRequest["status"])
      || typeof row.consumer_name !== "string" || !row.consumer_name.trim()
      || typeof row.consumer_email !== "string" || !row.consumer_email.trim()
      || typeof row.organization_name !== "string" || !row.organization_name.trim()
      || !instant(row.submitted_at) || !nullableInstant(row.reviewed_at)
      || !nullableInstant(row.denied_at) || !boundedNullableText(row.denial_reason, 500)
      || !nullableInstant(row.completed_at) || !boundedNullableText(row.completion_note, 1000)
      || !instant(row.updated_at)) return null;
  if (row.status === "submitted"
      && (row.reviewed_at !== null || row.denied_at !== null || row.denial_reason !== null
        || row.completed_at !== null || row.completion_note !== null)) return null;
  if (row.status === "in_review"
      && (row.reviewed_at === null || row.denied_at !== null || row.denial_reason !== null
        || row.completed_at !== null || row.completion_note !== null)) return null;
  if (row.status === "denied"
      && (row.reviewed_at === null || row.denied_at === null || row.denial_reason === null
        || row.completed_at !== null || row.completion_note !== null)) return null;
  if (row.status === "completed"
      && (row.reviewed_at === null || row.completed_at === null || row.completion_note === null
        || row.denied_at !== null || row.denial_reason !== null)) return null;
  return Object.freeze({
    completedAt: row.completed_at,
    completionNote: row.completion_note,
    consumerEmail: row.consumer_email,
    consumerName: row.consumer_name,
    denialReason: row.denial_reason,
    deniedAt: row.denied_at,
    id: row.id,
    kind: row.kind,
    organizationName: row.organization_name,
    reviewedAt: row.reviewed_at,
    status: row.status,
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at,
  } as PrivacyRequest);
}

function mutationId(value: unknown): string | null {
  if (!Array.isArray(value) || value.length !== 1) return null;
  const row = record(value[0]);
  return row && UUID.test(String(row.id)) ? String(row.id) : null;
}

function mapPlan(value: unknown): PrivacyErasurePlan | null {
  const row = exactRecord(value, ["blockers", "profileId", "pseudonymEmail", "targets"]);
  if (!row || !UUID.test(String(row.profileId))
      || typeof row.pseudonymEmail !== "string" || !PSEUDONYM_EMAIL.test(row.pseudonymEmail)
      || !Array.isArray(row.blockers) || !Array.isArray(row.targets)) return null;
  if (row.pseudonymEmail !== `deleted+${String(row.profileId).replaceAll("-", "")}@privacy.invalid`) return null;
  const blockers: PrivacyErasureBlocker[] = [];
  for (const blocker of row.blockers) {
    if (!PRIVACY_ERASURE_BLOCKERS.includes(blocker as PrivacyErasureBlocker)
        || blockers.includes(blocker as PrivacyErasureBlocker)) return null;
    blockers.push(blocker as PrivacyErasureBlocker);
  }
  const targets: PrivacyStorageTarget[] = [];
  for (const item of row.targets) {
    const target = record(item);
    if (!target || Object.keys(target).sort().join(",") !== "bucket,objectPath"
        || (target.bucket !== "client-documents" && target.bucket !== "credit-reports")
        || !validObjectPath(target.objectPath)) return null;
    targets.push(Object.freeze({ bucket: target.bucket, objectPath: target.objectPath }));
  }
  return Object.freeze({
    blockers: Object.freeze(blockers),
    profileId: String(row.profileId),
    pseudonymEmail: row.pseudonymEmail,
    targets: Object.freeze(targets),
  });
}

function databaseError(error: unknown, fallback: "read_failed" | "write_failed"): PrivacyWorkflowError {
  const message = record(error)?.message;
  if (typeof message === "string") {
    if (message.includes("NOT_FOUND")) return new PrivacyWorkflowError("not_found");
    if (message.includes("FORBIDDEN") || message.includes("REQUIRED")
        || message.includes("NOT_IN_REVIEW") || message.includes("CLOSED")) {
      return new PrivacyWorkflowError("invalid_state");
    }
  }
  return new PrivacyWorkflowError(fallback);
}

export function createPrivacyRepository(
  createDatabase: () => PrivacyDatabase | Promise<PrivacyDatabase> = productionDatabase,
): PrivacyRepository {
  let databasePromise: Promise<PrivacyDatabase> | null = null;
  const database = () => (databasePromise ??= Promise.resolve(createDatabase()));

  async function list(actorId: string, limit = 100): Promise<readonly PrivacyRequest[]> {
    const result = await (await database()).rpc("privacy_list_requests", {
      p_actor: actorId,
      p_limit: limit,
    });
    if (result.error || !Array.isArray(result.data)) throw databaseError(result.error, "read_failed");
    const requests = result.data.map(mapRequest);
    if (requests.some((request) => request === null)) throw new PrivacyWorkflowError("read_failed");
    return Object.freeze(requests as PrivacyRequest[]);
  }

  async function readBack(actorId: string, id: string): Promise<PrivacyRequest> {
    const found = (await list(actorId, 200)).find((request) => request.id === id);
    if (!found) throw new PrivacyWorkflowError("write_failed");
    return found;
  }

  async function mutate(
    functionName: string,
    actorId: string,
    args: Record<string, unknown>,
  ): Promise<PrivacyRequest> {
    const result = await (await database()).rpc(functionName, args);
    if (result.error) throw databaseError(result.error, "write_failed");
    const id = mutationId(result.data);
    if (!id) throw new PrivacyWorkflowError("write_failed");
    return readBack(actorId, id);
  }

  return {
    completeAccess(requestId, actorId, completionNote) {
      return mutate("privacy_complete_access_request", actorId, {
        p_actor: actorId,
        p_completion_note: completionNote,
        p_request_id: requestId,
      });
    },
    completeDeletion(requestId, actorId) {
      return mutate("privacy_complete_deletion_request", actorId, {
        p_actor: actorId,
        p_request_id: requestId,
      });
    },
    deny(requestId, actorId, reason) {
      return mutate("privacy_deny_request", actorId, {
        p_actor: actorId,
        p_reason: reason,
        p_request_id: requestId,
      });
    },
    async erasurePlan(requestId, actorId) {
      const result = await (await database()).rpc("privacy_request_erasure_targets", {
        p_actor: actorId,
        p_request_id: requestId,
      });
      if (result.error) throw databaseError(result.error, "read_failed");
      const plan = mapPlan(result.data);
      if (!plan) throw new PrivacyWorkflowError("read_failed");
      return plan;
    },
    async get(actorId, requestId) {
      return (await list(actorId, 200)).find((request) => request.id === requestId) ?? null;
    },
    list,
    review(requestId, actorId) {
      return mutate("privacy_review_request", actorId, {
        p_actor: actorId,
        p_request_id: requestId,
      });
    },
    submit(actorId, kind) {
      return mutate("privacy_submit_request", actorId, {
        p_actor: actorId,
        p_kind: kind,
      });
    },
  };
}
