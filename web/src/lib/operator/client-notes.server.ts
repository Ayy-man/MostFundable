import "server-only";

import {
  CLIENT_NOTE_LIVE_MAX,
  ClientNoteError,
  isClientNoteInstant,
  isClientNoteUuid,
  normalizeClientNoteBody,
  parseClientNote,
  type ClientNote,
  type ClientNotesSnapshot,
  type ClientNotesWriteBlockedReason,
} from "./client-notes.ts";

type RpcError = { readonly code?: string | null; readonly message?: string | null };
type RpcResult = { readonly data: unknown; readonly error: RpcError | null };
type Database = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
};

export interface ClientNotesService {
  create(input: {
    actorId: string;
    body: string;
    clientId: string;
    orgId: string;
    requestId: string;
  }): Promise<ClientNote>;
  list(input: {
    actorId: string;
    clientId: string;
    orgId: string;
  }): Promise<ClientNotesSnapshot>;
  remove(input: {
    actorId: string;
    clientId: string;
    expectedUpdatedAt: string;
    noteId: string;
    orgId: string;
  }): Promise<void>;
  update(input: {
    actorId: string;
    body: string;
    clientId: string;
    expectedUpdatedAt: string;
    noteId: string;
    orgId: string;
  }): Promise<ClientNote>;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  const source = record(value);
  return source && Object.keys(source).sort().join(",") === [...keys].sort().join(",")
    ? source
    : null;
}

function mapRow(value: unknown): ClientNote | null {
  const row = exact(value, [
    "body",
    "client_id",
    "created_at",
    "created_by_id",
    "created_by_name",
    "id",
    "updated_at",
    "updated_by_id",
    "updated_by_name",
  ]);
  if (!row) return null;
  return parseClientNote({
    body: row.body,
    clientId: row.client_id,
    createdAt: row.created_at,
    createdById: row.created_by_id,
    createdByName: row.created_by_name,
    id: row.id,
    updatedAt: row.updated_at,
    updatedById: row.updated_by_id,
    updatedByName: row.updated_by_name,
  });
}

function failure(error: RpcError | null): ClientNoteError {
  const message = error?.message ?? "";
  if (error?.code === "40001" || message.includes("CLIENT_NOTE_STALE")) {
    return new ClientNoteError("stale");
  }
  if (error?.code === "P0002" || message.includes("CLIENT_NOTE_NOT_FOUND")
    || message.includes("CLIENT_NOTES_NOT_FOUND")) {
    return new ClientNoteError("not_found");
  }
  if (error?.code === "42501" || message.includes("CLIENT_NOTES_FORBIDDEN")) {
    return new ClientNoteError("forbidden");
  }
  if (error?.code === "54000" || message.includes("CLIENT_NOTE_LIMIT_REACHED")) {
    return new ClientNoteError("limit_reached");
  }
  if (message.includes("CLIENT_NOTES_WRITE_BLOCKED")
    || message.includes("CLIENT_NOTE_REQUEST_RETIRED")) {
    return new ClientNoteError("write_blocked");
  }
  if (error?.code === "23505" || message.includes("CLIENT_NOTE_REQUEST_CONFLICT")) {
    return new ClientNoteError("request_conflict");
  }
  if (error?.code === "22023" || message.includes("CLIENT_NOTE_")
    || message.includes("CLIENT_NOTES_LIMIT_INVALID")) {
    return new ClientNoteError("invalid_request");
  }
  return new ClientNoteError("unavailable");
}

function validateIds(...values: string[]): void {
  if (values.some((value) => !isClientNoteUuid(value))) {
    throw new ClientNoteError("invalid_request");
  }
}

function mapSnapshot(value: unknown, clientId: string): ClientNotesSnapshot | null {
  const result = exact(value, ["live_limit", "notes", "write_blocked_reason"]);
  if (!result
    || result.live_limit !== CLIENT_NOTE_LIVE_MAX
    || !Array.isArray(result.notes)
    || result.notes.length > CLIENT_NOTE_LIVE_MAX
    || !(result.write_blocked_reason === null
      || result.write_blocked_reason === "archived"
      || result.write_blocked_reason === "privacy_erased")) return null;
  const notes = result.notes.map(mapRow);
  if (notes.some((note) => note === null || note.clientId !== clientId)) return null;
  return Object.freeze({
    liveLimit: CLIENT_NOTE_LIVE_MAX,
    notes: Object.freeze(notes as ClientNote[]),
    writeBlockedReason: result.write_blocked_reason as ClientNotesWriteBlockedReason | null,
  });
}

function deletedProjection(value: unknown, noteId: string): boolean {
  const result = exact(value, ["deleted", "id"]);
  return result?.deleted === true && result.id === noteId;
}

async function productionDatabase(): Promise<Database> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient() as unknown as Database;
}

export function createClientNotesService(
  createDatabase: () => Database | Promise<Database> = productionDatabase,
): ClientNotesService {
  let databasePromise: Promise<Database> | null = null;
  const database = () => (databasePromise ??= Promise.resolve(createDatabase()));

  async function list(input: {
    actorId: string;
    clientId: string;
    orgId: string;
  }): Promise<ClientNotesSnapshot> {
    validateIds(input.actorId, input.clientId, input.orgId);
    const result = await (await database()).rpc("client_notes_list", {
      p_actor_id: input.actorId,
      p_client_id: input.clientId,
      p_org_id: input.orgId,
    });
    if (result.error) throw failure(result.error);
    const snapshot = mapSnapshot(result.data, input.clientId);
    if (!snapshot) throw new ClientNoteError("unavailable");
    return snapshot;
  }

  async function mutate(
    functionName: "client_note_create" | "client_note_update",
    args: Record<string, unknown>,
    clientId: string,
  ): Promise<ClientNote> {
    const result = await (await database()).rpc(functionName, args);
    if (result.error) throw failure(result.error);
    const note = mapRow(result.data);
    if (!note || note.clientId !== clientId) throw new ClientNoteError("unavailable");
    return note;
  }

  return {
    async create(input) {
      validateIds(input.actorId, input.clientId, input.orgId, input.requestId);
      const body = normalizeClientNoteBody(input.body);
      if (body === null) throw new ClientNoteError("invalid_request");
      return mutate("client_note_create", {
        p_actor_id: input.actorId,
        p_body: body,
        p_client_id: input.clientId,
        p_org_id: input.orgId,
        p_request_id: input.requestId,
      }, input.clientId);
    },
    list,
    async remove(input) {
      validateIds(input.actorId, input.clientId, input.noteId, input.orgId);
      if (!isClientNoteInstant(input.expectedUpdatedAt)) {
        throw new ClientNoteError("invalid_request");
      }
      const result = await (await database()).rpc("client_note_delete", {
        p_actor_id: input.actorId,
        p_client_id: input.clientId,
        p_expected_updated_at: input.expectedUpdatedAt,
        p_note_id: input.noteId,
        p_org_id: input.orgId,
      });
      if (result.error) throw failure(result.error);
      if (!deletedProjection(result.data, input.noteId)) throw new ClientNoteError("unavailable");
    },
    async update(input) {
      validateIds(input.actorId, input.clientId, input.noteId, input.orgId);
      const body = normalizeClientNoteBody(input.body);
      if (body === null || !isClientNoteInstant(input.expectedUpdatedAt)) {
        throw new ClientNoteError("invalid_request");
      }
      return mutate("client_note_update", {
        p_actor_id: input.actorId,
        p_body: body,
        p_client_id: input.clientId,
        p_expected_updated_at: input.expectedUpdatedAt,
        p_note_id: input.noteId,
        p_org_id: input.orgId,
      }, input.clientId);
    },
  };
}
