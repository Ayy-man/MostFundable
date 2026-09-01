"use client";

import {
  isClientNoteUuid,
  parseClientNote,
  parseClientNotesSnapshot,
  parseCreateClientNoteInput,
  parseDeleteClientNoteInput,
  parseUpdateClientNoteInput,
  type ClientNote,
  type ClientNotesSnapshot,
  type CreateClientNoteInput,
  type DeleteClientNoteInput,
  type UpdateClientNoteInput,
} from "./client-notes.ts";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class ClientNoteClientError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.name = "ClientNoteClientError";
    this.status = status;
  }
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

async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function knownFailure(value: unknown, status: number): ClientNoteClientError {
  const payload = exact(value, ["error"]);
  const error = payload ? exact(payload.error, ["code", "message"]) : null;
  const code = error && typeof error.code === "string" ? error.code : "client_notes_unavailable";
  if (status === 409 || code === "client_note_stale") {
    if (code === "client_note_limit_reached") {
      return new ClientNoteClientError(
        code,
        "This client already has 100 active private notes. Delete an old note before adding another.",
        409,
      );
    }
    if (code === "client_notes_write_blocked") {
      return new ClientNoteClientError(
        code,
        "Private notes cannot be changed after a client is archived or privacy-erased.",
        409,
      );
    }
    if (code === "client_note_request_conflict") {
      return new ClientNoteClientError(
        code,
        "This note request could not be safely replayed. Reload the notes before trying again.",
        409,
      );
    }
    return new ClientNoteClientError(
      "client_note_stale",
      "This note changed after you opened it. Reload the notes before trying again.",
      409,
    );
  }
  if (status === 404) {
    return new ClientNoteClientError("client_note_not_found", "The note is no longer available.", 404);
  }
  if (status === 400) {
    return new ClientNoteClientError("invalid_request", "The note is empty, too long, or invalid.", 400);
  }
  if (status === 401 || status === 403) {
    return new ClientNoteClientError("client_notes_forbidden", "This account cannot access private client notes.", status);
  }
  if (status === 402) {
    return new ClientNoteClientError("org_deactivated", "This workspace is deactivated.", 402);
  }
  return new ClientNoteClientError("client_notes_unavailable", "Client notes are temporarily unavailable.", status);
}

async function request(
  path: string,
  init: RequestInit | undefined,
  fetcher: Fetcher,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetcher(path, {
      cache: "no-store",
      credentials: "same-origin",
      ...init,
    });
  } catch {
    throw new ClientNoteClientError("client_notes_unavailable", "Client notes are temporarily unavailable.", 0);
  }
  if (response.ok) return response;
  throw knownFailure(await readBody(response), response.status);
}

function notePayload(value: unknown, clientId: string): ClientNote {
  const payload = exact(value, ["note"]);
  const note = payload ? parseClientNote(payload.note) : null;
  if (!note || note.clientId !== clientId) {
    throw new ClientNoteClientError("client_notes_invalid", "The client notes response was invalid.", 502);
  }
  return note;
}

function collectionPath(clientId: string): string {
  if (!isClientNoteUuid(clientId)) {
    throw new ClientNoteClientError("invalid_request", "The client identifier is invalid.", 400);
  }
  return `/api/clients/${encodeURIComponent(clientId)}/notes`;
}

function itemPath(clientId: string, noteId: string): string {
  if (!isClientNoteUuid(noteId)) {
    throw new ClientNoteClientError("invalid_request", "The note identifier is invalid.", 400);
  }
  return `${collectionPath(clientId)}/${encodeURIComponent(noteId)}`;
}

export async function loadClientNotes(
  clientId: string,
  fetcher: Fetcher = fetch,
): Promise<ClientNotesSnapshot> {
  const response = await request(collectionPath(clientId), undefined, fetcher);
  const snapshot = parseClientNotesSnapshot(await readBody(response));
  if (!snapshot || snapshot.notes.some((note) => note.clientId !== clientId)) {
    throw new ClientNoteClientError("client_notes_invalid", "The client notes response was invalid.", 502);
  }
  return snapshot;
}

export async function createClientNote(
  clientId: string,
  input: CreateClientNoteInput,
  fetcher: Fetcher = fetch,
): Promise<ClientNote> {
  const parsed = parseCreateClientNoteInput(input);
  if (!parsed) throw new ClientNoteClientError("invalid_request", "The note is empty, too long, or invalid.", 400);
  const response = await request(collectionPath(clientId), {
    body: JSON.stringify(parsed),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  }, fetcher);
  return notePayload(await readBody(response), clientId);
}

export async function updateClientNote(
  clientId: string,
  noteId: string,
  input: UpdateClientNoteInput,
  fetcher: Fetcher = fetch,
): Promise<ClientNote> {
  const parsed = parseUpdateClientNoteInput(input);
  if (!parsed) throw new ClientNoteClientError("invalid_request", "The note is empty, too long, or invalid.", 400);
  const response = await request(itemPath(clientId, noteId), {
    body: JSON.stringify(parsed),
    headers: { "Content-Type": "application/json" },
    method: "PATCH",
  }, fetcher);
  const note = notePayload(await readBody(response), clientId);
  if (note.id !== noteId) {
    throw new ClientNoteClientError("client_notes_invalid", "The client notes response was invalid.", 502);
  }
  return note;
}

export async function deleteClientNote(
  clientId: string,
  noteId: string,
  input: DeleteClientNoteInput,
  fetcher: Fetcher = fetch,
): Promise<void> {
  const parsed = parseDeleteClientNoteInput(input);
  if (!parsed) throw new ClientNoteClientError("invalid_request", "The note version is invalid.", 400);
  const response = await request(itemPath(clientId, noteId), {
    body: JSON.stringify(parsed),
    headers: { "Content-Type": "application/json" },
    method: "DELETE",
  }, fetcher);
  if (response.status !== 204) {
    throw new ClientNoteClientError("client_notes_invalid", "The client notes response was invalid.", 502);
  }
}
