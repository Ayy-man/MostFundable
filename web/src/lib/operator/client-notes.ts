export const CLIENT_NOTE_BODY_MAX = 4000;
export const CLIENT_NOTE_LIVE_MAX = 100;

export interface ClientNote {
  readonly body: string;
  readonly clientId: string;
  readonly createdAt: string;
  readonly createdById: string;
  readonly createdByName: string;
  readonly id: string;
  readonly updatedAt: string;
  readonly updatedById: string;
  readonly updatedByName: string;
}

export interface CreateClientNoteInput {
  readonly body: string;
  readonly requestId: string;
}

export interface UpdateClientNoteInput {
  readonly body: string;
  readonly expectedUpdatedAt: string;
}

export interface DeleteClientNoteInput {
  readonly expectedUpdatedAt: string;
}

export type ClientNotesWriteBlockedReason = "archived" | "privacy_erased";

export interface ClientNotesSnapshot {
  readonly liveLimit: typeof CLIENT_NOTE_LIVE_MAX;
  readonly notes: readonly ClientNote[];
  readonly writeBlockedReason: ClientNotesWriteBlockedReason | null;
}

export type ClientNoteErrorCode =
  | "forbidden"
  | "invalid_request"
  | "limit_reached"
  | "not_found"
  | "request_conflict"
  | "stale"
  | "unavailable"
  | "write_blocked";

export class ClientNoteError extends Error {
  readonly code: ClientNoteErrorCode;

  constructor(code: ClientNoteErrorCode) {
    super(code);
    this.code = code;
    this.name = "ClientNoteError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

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

export function isClientNoteUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function isClientNoteInstant(value: unknown): value is string {
  return typeof value === "string" && INSTANT.test(value) && Number.isFinite(Date.parse(value));
}

export function normalizeClientNoteBody(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const body = value.trim();
  return body.length >= 1 && body.length <= CLIENT_NOTE_BODY_MAX ? body : null;
}

export function parseCreateClientNoteInput(value: unknown): CreateClientNoteInput | null {
  const source = exact(value, ["body", "requestId"]);
  const body = source ? normalizeClientNoteBody(source.body) : null;
  return body === null || !isClientNoteUuid(source?.requestId)
    ? null
    : Object.freeze({ body, requestId: source.requestId });
}

export function parseUpdateClientNoteInput(value: unknown): UpdateClientNoteInput | null {
  const source = exact(value, ["body", "expectedUpdatedAt"]);
  const body = source ? normalizeClientNoteBody(source.body) : null;
  if (body === null || !isClientNoteInstant(source?.expectedUpdatedAt)) return null;
  return Object.freeze({ body, expectedUpdatedAt: source.expectedUpdatedAt });
}

export function parseDeleteClientNoteInput(value: unknown): DeleteClientNoteInput | null {
  const source = exact(value, ["expectedUpdatedAt"]);
  return source && isClientNoteInstant(source.expectedUpdatedAt)
    ? Object.freeze({ expectedUpdatedAt: source.expectedUpdatedAt })
    : null;
}

export function parseClientNote(value: unknown): ClientNote | null {
  const source = exact(value, [
    "body",
    "clientId",
    "createdAt",
    "createdById",
    "createdByName",
    "id",
    "updatedAt",
    "updatedById",
    "updatedByName",
  ]);
  if (!source
    || !isClientNoteUuid(source.id)
    || !isClientNoteUuid(source.clientId)
    || !isClientNoteUuid(source.createdById)
    || !isClientNoteUuid(source.updatedById)
    || normalizeClientNoteBody(source.body) !== source.body
    || typeof source.createdByName !== "string"
    || source.createdByName.trim().length < 1
    || source.createdByName.length > 200
    || typeof source.updatedByName !== "string"
    || source.updatedByName.trim().length < 1
    || source.updatedByName.length > 200
    || !isClientNoteInstant(source.createdAt)
    || !isClientNoteInstant(source.updatedAt)
    || Date.parse(source.updatedAt) < Date.parse(source.createdAt)) return null;
  return Object.freeze(source as unknown as ClientNote);
}

export function parseClientNotesSnapshot(value: unknown): ClientNotesSnapshot | null {
  const source = exact(value, ["liveLimit", "notes", "writeBlockedReason"]);
  if (!source
    || source.liveLimit !== CLIENT_NOTE_LIVE_MAX
    || !Array.isArray(source.notes)
    || source.notes.length > CLIENT_NOTE_LIVE_MAX
    || !(source.writeBlockedReason === null
      || source.writeBlockedReason === "archived"
      || source.writeBlockedReason === "privacy_erased")) return null;
  const notes = source.notes.map(parseClientNote);
  if (notes.some((note) => note === null)) return null;
  return Object.freeze({
    liveLimit: CLIENT_NOTE_LIVE_MAX,
    notes: Object.freeze(notes as ClientNote[]),
    writeBlockedReason: source.writeBlockedReason,
  });
}
