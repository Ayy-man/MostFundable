"use client";

import {
  PRIVACY_ERASURE_BLOCKERS,
  PRIVACY_REQUEST_KINDS,
  PRIVACY_REQUEST_STATUSES,
  type PrivacyAction,
  type PrivacyErasureBlocker,
  type PrivacyRequest,
  type PrivacyRequestKind,
} from "./types.ts";

export type PrivacyRequestRead = readonly PrivacyRequest[] | null | "failed";
export type PrivacyMutationResult =
  | Readonly<{ ok: true; request: PrivacyRequest }>
  | Readonly<{ blockers: readonly PrivacyErasureBlocker[]; code: string; ok: false }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FAILURE_CODES = new Set([
  "forbidden",
  "invalid_request",
  "privacy_auth_disable_unverified",
  "privacy_erasure_blocked",
  "privacy_request_failed",
  "privacy_request_not_found",
  "privacy_request_state_conflict",
  "privacy_request_unavailable",
  "privacy_storage_cleanup_unverified",
  "same_origin_required",
  "unauthenticated",
]);

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
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

export function parsePrivacyRequest(value: unknown): PrivacyRequest | null {
  const keys = [
    "completedAt", "completionNote", "consumerEmail", "consumerName", "denialReason",
    "deniedAt", "id", "kind", "organizationName", "reviewedAt", "status",
    "submittedAt", "updatedAt",
  ];
  if (!exact(value, keys) || !UUID.test(String(value.id))
      || !PRIVACY_REQUEST_KINDS.includes(value.kind as PrivacyRequestKind)
      || !PRIVACY_REQUEST_STATUSES.includes(value.status as PrivacyRequest["status"])
      || typeof value.consumerEmail !== "string" || !value.consumerEmail.trim()
      || typeof value.consumerName !== "string" || !value.consumerName.trim()
      || typeof value.organizationName !== "string" || !value.organizationName.trim()
      || !nullableInstant(value.completedAt) || !boundedNullableText(value.completionNote, 1000)
      || !boundedNullableText(value.denialReason, 500) || !nullableInstant(value.deniedAt)
      || !nullableInstant(value.reviewedAt) || !instant(value.submittedAt)
      || !instant(value.updatedAt)) return null;
  if (value.status === "submitted" && (value.reviewedAt !== null || value.completedAt !== null
      || value.completionNote !== null || value.deniedAt !== null || value.denialReason !== null)) return null;
  if (value.status === "in_review" && (value.reviewedAt === null || value.completedAt !== null
      || value.completionNote !== null || value.deniedAt !== null || value.denialReason !== null)) return null;
  if (value.status === "denied" && (value.reviewedAt === null || value.deniedAt === null
      || value.denialReason === null || value.completedAt !== null || value.completionNote !== null)) return null;
  if (value.status === "completed" && (value.reviewedAt === null || value.completedAt === null
      || value.completionNote === null || value.deniedAt !== null || value.denialReason !== null)) return null;
  return Object.freeze(value as unknown as PrivacyRequest);
}

function parseList(value: unknown): readonly PrivacyRequest[] | null {
  if (!exact(value, ["requests"]) || !Array.isArray(value.requests) || value.requests.length > 200) return null;
  const requests = value.requests.map(parsePrivacyRequest);
  return requests.some((request) => request === null)
    ? null
    : Object.freeze(requests as PrivacyRequest[]);
}

function parseMutation(value: unknown): PrivacyRequest | null {
  return exact(value, ["request"]) ? parsePrivacyRequest(value.request) : null;
}

function parseFailure(value: unknown): { blockers: readonly PrivacyErasureBlocker[]; code: string } {
  if (!exact(value, ["error"]) || !exact(value.error, ["code"]) && !exact(value.error, ["blockers", "code"])) {
    return { blockers: [], code: "privacy_request_unavailable" };
  }
  const code = typeof value.error.code === "string" && FAILURE_CODES.has(value.error.code)
    ? value.error.code
    : "privacy_request_unavailable";
  if (!("blockers" in value.error) || !Array.isArray(value.error.blockers)) return { blockers: [], code };
  const blockers: PrivacyErasureBlocker[] = [];
  for (const blocker of value.error.blockers) {
    if (!PRIVACY_ERASURE_BLOCKERS.includes(blocker as PrivacyErasureBlocker)
        || blockers.includes(blocker as PrivacyErasureBlocker)) return { blockers: [], code };
    blockers.push(blocker as PrivacyErasureBlocker);
  }
  return { blockers: Object.freeze(blockers), code };
}

async function readJson(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

async function load(url: string, fetcher: typeof fetch): Promise<PrivacyRequestRead> {
  let response: Response;
  try {
    response = await fetcher(url, { cache: "no-store", credentials: "same-origin" });
  } catch { return "failed"; }
  if (response.status === 404) return null;
  if (!response.ok) return "failed";
  return parseList(await readJson(response)) ?? "failed";
}

async function mutate(
  url: string,
  method: "PATCH" | "POST",
  body: unknown,
  fetcher: typeof fetch,
): Promise<PrivacyMutationResult> {
  let response: Response;
  try {
    response = await fetcher(url, {
      body: JSON.stringify(body),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method,
    });
  } catch { return { blockers: [], code: "privacy_request_unavailable", ok: false }; }
  const payload = await readJson(response);
  if (!response.ok) return { ...parseFailure(payload), ok: false };
  const request = parseMutation(payload);
  return request
    ? { ok: true, request }
    : { blockers: [], code: "privacy_request_unavailable", ok: false };
}

export function loadConsumerPrivacyRequests(fetcher: typeof fetch = fetch): Promise<PrivacyRequestRead> {
  return load("/api/consumer/privacy-requests", fetcher);
}

export function loadAdminPrivacyRequests(fetcher: typeof fetch = fetch): Promise<PrivacyRequestRead> {
  return load("/api/admin/privacy-requests", fetcher);
}

export function submitConsumerPrivacyRequest(
  kind: PrivacyRequestKind,
  fetcher: typeof fetch = fetch,
): Promise<PrivacyMutationResult> {
  return mutate("/api/consumer/privacy-requests", "POST", { kind }, fetcher);
}

export function updateAdminPrivacyRequest(
  requestId: string,
  action: PrivacyAction,
  fetcher: typeof fetch = fetch,
): Promise<PrivacyMutationResult> {
  return mutate(`/api/admin/privacy-requests/${encodeURIComponent(requestId)}`, "PATCH", action, fetcher);
}
