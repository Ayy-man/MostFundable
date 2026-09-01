import "server-only";

import { recordRouteFailure, withCorrelationId } from "@/lib/diagnostics/route-failure";
import { administerPrivacyRequest, listPrivacyRequests, submitPrivacyRequest } from "./service.ts";
import {
  PRIVACY_REQUEST_KINDS,
  PrivacyWorkflowError,
  type PrivacyAction,
  type PrivacyRequest,
  type PrivacyRequestKind,
} from "./types.ts";

type PrivacySession = Readonly<{ id: string; role: "consumer" | "platform_admin" }>;

export type PrivacyHttpDependencies = Readonly<{
  administer(actorId: string, requestId: string, action: PrivacyAction): Promise<PrivacyRequest>;
  list(actorId: string): Promise<readonly PrivacyRequest[]>;
  requireAdmin(): Promise<PrivacySession>;
  requireConsumer(): Promise<PrivacySession>;
  submit(actorId: string, kind: PrivacyRequestKind): Promise<PrivacyRequest>;
}>;

const defaults: PrivacyHttpDependencies = {
  administer: administerPrivacyRequest,
  list: listPrivacyRequests,
  async requireAdmin() {
    const { requireRole } = await import("@/lib/auth/session");
    return await requireRole("platform_admin") as PrivacySession;
  },
  async requireConsumer() {
    const { requireRole } = await import("@/lib/auth/session");
    return await requireRole("consumer") as PrivacySession;
  },
  submit: submitPrivacyRequest,
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    headers: { "Cache-Control": "private, no-store" },
    status,
  });
}

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function response(request: PrivacyRequest) {
  return {
    completedAt: request.completedAt,
    completionNote: request.completionNote,
    consumerEmail: request.consumerEmail,
    consumerName: request.consumerName,
    denialReason: request.denialReason,
    deniedAt: request.deniedAt,
    id: request.id,
    kind: request.kind,
    organizationName: request.organizationName,
    reviewedAt: request.reviewedAt,
    status: request.status,
    submittedAt: request.submittedAt,
    updatedAt: request.updatedAt,
  };
}

function failure(error: unknown): Response {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (status === 401) return json({ error: { code: "unauthenticated" } }, 401);
    if (status === 403) return json({ error: { code: "forbidden" } }, 403);
  }
  if (error instanceof PrivacyWorkflowError) {
    if (error.code === "invalid_request") return json({ error: { code: "invalid_request" } }, 400);
    if (error.code === "not_found") return json({ error: { code: "privacy_request_not_found" } }, 404);
    if (error.code === "invalid_state") return json({ error: { code: "privacy_request_state_conflict" } }, 409);
    if (error.code === "erasure_blocked") {
      return json({ error: { blockers: error.blockers, code: "privacy_erasure_blocked" } }, 409);
    }
    const code = error.code === "auth_disable_failed"
      ? "privacy_auth_disable_unverified"
      : error.code === "storage_cleanup_failed"
        ? "privacy_storage_cleanup_unverified"
        : "privacy_request_unavailable";
    return json({ error: { code } }, 503);
  }
  const id = recordRouteFailure({
    cause: error,
    code: "privacy_request_failed",
    status: 500,
    surface: "privacy.request",
  });
  return json(withCorrelationId({ error: { code: "privacy_request_failed" } }, id), 500);
}

async function body(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { return null; }
}

function submitInput(value: unknown): PrivacyRequestKind | null {
  if (!exact(value, ["kind"]) || !PRIVACY_REQUEST_KINDS.includes(value.kind as PrivacyRequestKind)) return null;
  return value.kind as PrivacyRequestKind;
}

function actionInput(value: unknown): PrivacyAction | null {
  if (exact(value, ["action"]) && value.action === "review") return Object.freeze({ action: "review" });
  if (exact(value, ["action", "reason"]) && value.action === "deny" && typeof value.reason === "string") {
    const reason = value.reason.trim();
    return reason && reason.length <= 500 ? Object.freeze({ action: "deny", reason }) : null;
  }
  if (exact(value, ["action", "completionNote"]) && value.action === "complete"
      && (value.completionNote === null || typeof value.completionNote === "string")) {
    const completionNote = typeof value.completionNote === "string" ? value.completionNote.trim() : null;
    if (completionNote !== null && (!completionNote || completionNote.length > 1000)) return null;
    return Object.freeze({ action: "complete", completionNote });
  }
  return null;
}

export async function handleConsumerPrivacyRequests(
  request: Request,
  overrides: Partial<PrivacyHttpDependencies> = {},
): Promise<Response> {
  const dependencies = { ...defaults, ...overrides };
  let session: PrivacySession;
  try { session = await dependencies.requireConsumer(); } catch (error) { return failure(error); }
  if (request.method === "GET") {
    try {
      const requests = await dependencies.list(session.id);
      return json({ requests: requests.map(response) });
    } catch (error) { return failure(error); }
  }
  const kind = submitInput(await body(request));
  if (!kind) return json({ error: { code: "invalid_request" } }, 400);
  try {
    return json({ request: response(await dependencies.submit(session.id, kind)) }, 201);
  } catch (error) { return failure(error); }
}

export async function handleAdminPrivacyRequests(
  overrides: Partial<PrivacyHttpDependencies> = {},
): Promise<Response> {
  const dependencies = { ...defaults, ...overrides };
  try {
    const session = await dependencies.requireAdmin();
    const requests = await dependencies.list(session.id);
    return json({ requests: requests.map(response) });
  } catch (error) { return failure(error); }
}

export async function handleAdminPrivacyRequestAction(
  request: Request,
  requestId: string,
  overrides: Partial<PrivacyHttpDependencies> = {},
): Promise<Response> {
  const dependencies = { ...defaults, ...overrides };
  let session: PrivacySession;
  try { session = await dependencies.requireAdmin(); } catch (error) { return failure(error); }
  const action = actionInput(await body(request));
  if (!action) return json({ error: { code: "invalid_request" } }, 400);
  try {
    const result = await dependencies.administer(session.id, requestId, action);
    return json({ request: response(result) });
  } catch (error) { return failure(error); }
}
