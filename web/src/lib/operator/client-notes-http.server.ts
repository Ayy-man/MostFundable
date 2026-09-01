import "server-only";

import type { SessionProfile } from "@/lib/auth/session";
import { recordRouteFailure, withCorrelationId } from "@/lib/diagnostics/route-failure";
import { sameOrigin } from "@/lib/pricing/http";
import {
  ClientNoteError,
  isClientNoteUuid,
  parseCreateClientNoteInput,
  parseDeleteClientNoteInput,
  parseUpdateClientNoteInput,
} from "./client-notes.ts";
import type { ClientNotesService } from "./client-notes.server.ts";

type OrgSession = SessionProfile & { orgId: string };

export interface ClientNotesHttpDependencies {
  assertRead(session: OrgSession): Promise<void>;
  assertWrite(session: OrgSession): Promise<void>;
  isSameOrigin(request: Request): boolean;
  requireOperator(): Promise<OrgSession>;
  readonly service: ClientNotesService;
}

const headers = { "Cache-Control": "private, no-store" };

function json(body: unknown, status = 200): Response {
  return Response.json(body, { headers, status });
}

function authStatus(error: unknown): 401 | 402 | 403 | null {
  if (typeof error !== "object" || error === null || !("status" in error)) return null;
  const status = (error as { status?: unknown }).status;
  return status === 401 || status === 402 || status === 403 ? status : null;
}

function failure(error: unknown, surface: string): Response {
  const access = authStatus(error);
  if (access !== null) {
    return json({
      error: {
        code: access === 401
          ? "session_required"
          : access === 402
            ? "org_deactivated"
            : "role_forbidden",
        message: access === 401
          ? "Sign in to use private client notes."
          : access === 402
            ? "This workspace is deactivated."
            : "This account cannot access private client notes.",
      },
    }, access);
  }
  if (error instanceof ClientNoteError) {
    if (error.code === "invalid_request") {
      return json({ error: { code: "invalid_request", message: "The client note request is invalid." } }, 400);
    }
    if (error.code === "forbidden") {
      return json({ error: { code: "role_forbidden", message: "This account cannot access private client notes." } }, 403);
    }
    if (error.code === "not_found") {
      return json({ error: { code: "client_note_not_found", message: "The client note was not found." } }, 404);
    }
    if (error.code === "stale") {
      return json({ error: { code: "client_note_stale", message: "The client note changed before this request." } }, 409);
    }
    if (error.code === "limit_reached") {
      return json({ error: { code: "client_note_limit_reached", message: "This client already has the maximum number of private notes." } }, 409);
    }
    if (error.code === "request_conflict") {
      return json({ error: { code: "client_note_request_conflict", message: "This note request conflicts with an earlier request." } }, 409);
    }
    if (error.code === "write_blocked") {
      return json({ error: { code: "client_notes_write_blocked", message: "Private notes cannot be changed on this client." } }, 409);
    }
  }
  const correlationId = recordRouteFailure({
    cause: error,
    code: "client_notes_unavailable",
    status: 500,
    surface,
  });
  return json(withCorrelationId({
    error: {
      code: "client_notes_unavailable",
      message: "Client notes are temporarily unavailable.",
    },
  }, correlationId), 500);
}

async function requestBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function defaults(): Promise<ClientNotesHttpDependencies> {
  const [{ requireOrgMember }, tenancy, { createClientNotesService }] = await Promise.all([
    import("@/lib/auth/session"),
    import("@/lib/tenancy/wall"),
    import("./client-notes.server.ts"),
  ]);
  return {
    async assertRead(session) {
      await tenancy.assertTenantAccessAllowed(session, "own-book-read");
    },
    assertWrite: tenancy.assertTenantWriteAllowed,
    isSameOrigin: sameOrigin,
    requireOperator: requireOrgMember,
    service: createClientNotesService(),
  };
}

export async function handleClientNotesCollection(
  request: Request,
  clientId: string,
  supplied?: ClientNotesHttpDependencies,
): Promise<Response> {
  const dependencies = supplied ?? await defaults();
  try {
    const session = await dependencies.requireOperator();
    if (request.method === "GET") {
      await dependencies.assertRead(session);
      if (!isClientNoteUuid(clientId)
        || [...new URL(request.url).searchParams.keys()].length > 0) {
        return json({ error: { code: "invalid_request", message: "The client notes request is invalid." } }, 400);
      }
      const snapshot = await dependencies.service.list({
        actorId: session.id,
        clientId,
        orgId: session.orgId,
      });
      return json(snapshot);
    }
    if (request.method !== "POST") {
      return json({ error: { code: "method_not_allowed", message: "The client notes method is not supported." } }, 405);
    }

    await dependencies.assertWrite(session);
    if ([...new URL(request.url).searchParams.keys()].length > 0) {
      return json({ error: { code: "invalid_request", message: "The client notes request is invalid." } }, 400);
    }
    if (!dependencies.isSameOrigin(request)) {
      return json({ error: { code: "same_origin_required", message: "A same-origin request is required." } }, 403);
    }
    if (!isClientNoteUuid(clientId)) {
      return json({ error: { code: "invalid_request", message: "The client notes request is invalid." } }, 400);
    }
    const input = parseCreateClientNoteInput(await requestBody(request));
    if (!input) return json({ error: { code: "invalid_request", message: "The client note must contain 1 to 4,000 characters." } }, 400);
    const note = await dependencies.service.create({
      actorId: session.id,
      body: input.body,
      clientId,
      orgId: session.orgId,
      requestId: input.requestId,
    });
    return json({ note }, 201);
  } catch (error) {
    return failure(error, "api.clients.notes.collection");
  }
}

export async function handleClientNoteItem(
  request: Request,
  clientId: string,
  noteId: string,
  supplied?: ClientNotesHttpDependencies,
): Promise<Response> {
  const dependencies = supplied ?? await defaults();
  try {
    const session = await dependencies.requireOperator();
    await dependencies.assertWrite(session);
    if (!dependencies.isSameOrigin(request)) {
      return json({ error: { code: "same_origin_required", message: "A same-origin request is required." } }, 403);
    }
    if (!isClientNoteUuid(clientId) || !isClientNoteUuid(noteId)) {
      return json({ error: { code: "invalid_request", message: "The client note identifier is invalid." } }, 400);
    }
    if ([...new URL(request.url).searchParams.keys()].length > 0) {
      return json({ error: { code: "invalid_request", message: "The client note request is invalid." } }, 400);
    }

    if (request.method === "PATCH") {
      const input = parseUpdateClientNoteInput(await requestBody(request));
      if (!input) return json({ error: { code: "invalid_request", message: "The client note update is invalid." } }, 400);
      const note = await dependencies.service.update({
        actorId: session.id,
        body: input.body,
        clientId,
        expectedUpdatedAt: input.expectedUpdatedAt,
        noteId,
        orgId: session.orgId,
      });
      return json({ note });
    }
    if (request.method === "DELETE") {
      const input = parseDeleteClientNoteInput(await requestBody(request));
      if (!input) return json({ error: { code: "invalid_request", message: "The client note version is invalid." } }, 400);
      await dependencies.service.remove({
        actorId: session.id,
        clientId,
        expectedUpdatedAt: input.expectedUpdatedAt,
        noteId,
        orgId: session.orgId,
      });
      return new Response(null, { headers, status: 204 });
    }
    return json({ error: { code: "method_not_allowed", message: "The client note method is not supported." } }, 405);
  } catch (error) {
    return failure(error, "api.clients.notes.item");
  }
}
