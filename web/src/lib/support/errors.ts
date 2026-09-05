// Database refusals become stable client-facing codes here, and nowhere else.
//
// Migration 101 raises with `errcode = 'P0001'` and a fixed message, so every
// refusal arrives from PostgREST as an object whose `message` is one of a known
// dozen identifiers. That is the whole reason the mapping can be a lookup: the
// phase never has to parse a Postgres sentence, and an identifier it does not
// recognize is discarded rather than forwarded.
//
// A `SupportError`'s `message` IS its code. There is no second, human-readable
// string that could carry a table name, a constraint name, or a row value to a
// client, because there is no second string at all.

import { recordRouteFailure } from '@/lib/diagnostics/route-failure';
import { SUPPORT_DRAFT_DRIVER_UNAVAILABLE } from './driver.ts';

/**
 * The closed set of outcomes a support operation can have.
 *
 * `SUPPORT_REQUEST_INVALID` is the routes' own: a payload that fails validation
 * before any database call. The fourteen after it are raised by migrations 100,
 * 101, 385 and 386, three more by this lane's TypeScript
 * (`SUPPORT_MESSAGE_LANGUAGE` among them: a person's own message body tripped
 * the compliance language battery, pre-launch defect C5), and
 * `SUPPORT_UNAVAILABLE` is the catch-all that anything unrecognized collapses
 * into. One union rather than a
 * separate route vocabulary, so a client parses one shape and plan 13-06's
 * scanner has one list to check.
 */
export type SupportErrorCode =
  | 'SUPPORT_REQUEST_INVALID'
  | 'SUPPORT_ACTOR_REQUIRED'
  | 'SUPPORT_ACTOR_UNKNOWN'
  | 'SUPPORT_FORBIDDEN'
  | 'SUPPORT_DRAFT_NOT_FOUND'
  | 'SUPPORT_THREAD_CLOSED'
  | 'SUPPORT_DRAFT_EXISTS'
  | 'SUPPORT_DRAFT_NOT_OPEN'
  | 'SUPPORT_DRAFT_NOT_APPROVED'
  | 'SUPPORT_DRAFT_BODY_MISMATCH'
  | 'SUPPORT_NOTE_NOT_PERMITTED'
  | 'SUPPORT_NOTE_DRAFT_CONFLICT'
  | 'SUPPORT_THREAD_SCOPE_INVALID'
  | 'SUPPORT_AUTHOR_ROLE_MISMATCH'
  | 'SUPPORT_DRAFT_PAIRING_INVALID'
  | 'SUPPORT_MESSAGE_LANGUAGE'
  | 'SUPPORT_DRAFT_DRIVER_UNAVAILABLE'
  | 'SUPPORT_CONFIG_INVALID'
  | 'SUPPORT_UNAVAILABLE';

/**
 * The status each code answers with.
 *
 * `SUPPORT_AUTHOR_ROLE_MISMATCH` and `SUPPORT_DRAFT_PAIRING_INVALID` are 500s
 * rather than 4xxs on purpose. Both come from migration 100's triggers, and
 * both mean the caller and the schema disagree about something the route
 * derives itself — the author kind comes from the session role, and the pairing
 * is written by the RPC. Reaching either is our bug, not the client's, and
 * telling a client to retry differently would be wrong advice.
 */
const STATUS_BY_CODE: Readonly<Record<SupportErrorCode, number>> = {
  SUPPORT_REQUEST_INVALID: 400,
  SUPPORT_ACTOR_REQUIRED: 401,
  SUPPORT_ACTOR_UNKNOWN: 401,
  SUPPORT_FORBIDDEN: 403,
  SUPPORT_DRAFT_NOT_FOUND: 404,
  SUPPORT_THREAD_CLOSED: 409,
  SUPPORT_DRAFT_EXISTS: 409,
  SUPPORT_DRAFT_NOT_OPEN: 409,
  SUPPORT_DRAFT_NOT_APPROVED: 422,
  SUPPORT_DRAFT_BODY_MISMATCH: 422,
  // A consumer asking for an internal note is asking for something their role
  // does not have, which is a 403 in the same sense SUPPORT_FORBIDDEN is. The
  // draft conflict is a 422 because the request is well-formed and the pairing
  // is what cannot exist — the same reading SUPPORT_DRAFT_BODY_MISMATCH gets.
  SUPPORT_NOTE_NOT_PERMITTED: 403,
  SUPPORT_NOTE_DRAFT_CONFLICT: 422,
  SUPPORT_THREAD_SCOPE_INVALID: 422,
  SUPPORT_AUTHOR_ROLE_MISMATCH: 500,
  SUPPORT_DRAFT_PAIRING_INVALID: 500,
  // A well-formed message whose wording the platform may not put in front of a
  // client. The same reading SUPPORT_DRAFT_BODY_MISMATCH gets: the request is
  // valid, the content is what cannot be sent.
  SUPPORT_MESSAGE_LANGUAGE: 422,
  SUPPORT_DRAFT_DRIVER_UNAVAILABLE: 503,
  SUPPORT_CONFIG_INVALID: 500,
  SUPPORT_UNAVAILABLE: 500,
};

export const SUPPORT_ERROR_CODES = Object.freeze(
  Object.keys(STATUS_BY_CODE) as SupportErrorCode[],
);

const KNOWN_CODES: ReadonlySet<string> = new Set(SUPPORT_ERROR_CODES);

export class SupportError extends Error {
  readonly code: SupportErrorCode;
  readonly status: number;

  constructor(code: SupportErrorCode) {
    super(code);
    this.name = 'SupportError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
  }
}

/**
 * A human-typed message body refused by the compliance language battery.
 *
 * The one `SupportError` that carries something beyond its code: the rule ids
 * that fired, so the surface can say which phrase to remove. The ids are the
 * battery's own `LANGUAGE_Cnn` labels — never the matched text, which would
 * echo the prohibited phrase back through the response.
 */
export class SupportMessageLanguageError extends SupportError {
  readonly codes: readonly string[];

  constructor(codes: readonly string[]) {
    super('SUPPORT_MESSAGE_LANGUAGE');
    this.name = 'SupportMessageLanguageError';
    this.codes = Object.freeze([...codes]);
  }
}

export function supportErrorStatus(code: SupportErrorCode): number {
  return STATUS_BY_CODE[code];
}

function readStringField(value: unknown, field: string): string | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const candidate = (value as Record<string, unknown>)[field];
  return typeof candidate === 'string' ? candidate.trim() : undefined;
}

/**
 * Normalize anything thrown or returned as an error into a `SupportError`.
 *
 * Three shapes reach this function. A `SupportError` passes through. A
 * PostgREST error object carries the raise text on `message`. This lane's own
 * failures (`SupportDraftDriverUnavailableError`, `SupportConfigError`) carry
 * the identifier on `code` instead. Everything else — a network failure, a
 * constraint violation nobody anticipated, a string — becomes
 * `SUPPORT_UNAVAILABLE`, and the original text is dropped on the floor here so
 * that no later layer has the option of forwarding it.
 */
export function toSupportError(value: unknown): SupportError {
  if (value instanceof SupportError) return value;

  const fromCode = readStringField(value, 'code');
  if (fromCode !== undefined && KNOWN_CODES.has(fromCode)) {
    return new SupportError(fromCode as SupportErrorCode);
  }

  const fromMessage =
    value instanceof Error ? value.message.trim() : readStringField(value, 'message');
  if (fromMessage !== undefined && KNOWN_CODES.has(fromMessage)) {
    return new SupportError(fromMessage as SupportErrorCode);
  }

  if (typeof value === 'string' && KNOWN_CODES.has(value.trim())) {
    return new SupportError(value.trim() as SupportErrorCode);
  }

  return new SupportError('SUPPORT_UNAVAILABLE');
}

export interface SupportHttpResponse {
  readonly status: number;
  readonly body: {
    readonly error: SupportErrorCode;
    readonly correlationId?: string;
    readonly codes?: readonly string[];
  };
}

/**
 * True when `toSupportError` reached `SUPPORT_UNAVAILABLE` because it did not recognise the value,
 * rather than because something deliberately raised that code. The distinction matters: a thrown
 * `SupportError('SUPPORT_UNAVAILABLE')` is a decision the lane made and needs no diagnostic, and
 * recording it would bury the outages this exists to surface. R5B-04.
 */
function isUnrecognized(value: unknown, code: SupportErrorCode): boolean {
  return code === 'SUPPORT_UNAVAILABLE' && !(value instanceof SupportError);
}

/**
 * The response shape every support route answers a failure with: one status and
 * one key. No message, no hint, no detail, no field list — a client learns what
 * class of thing went wrong and nothing about the schema behind it.
 *
 * The one addition is `codes` on a language refusal: rule ids, not text, so
 * the surface can point at the rule without the response repeating the phrase.
 */
export function toHttpResponse(value: unknown): SupportHttpResponse {
  const error = toSupportError(value);
  if (error instanceof SupportMessageLanguageError) {
    return { status: error.status, body: { error: error.code, codes: error.codes } };
  }
  if (isUnrecognized(value, error.code)) {
    const correlationId = recordRouteFailure({
      cause: value,
      code: error.code,
      status: error.status,
      surface: 'support.to_http_response',
    });
    return { status: error.status, body: { correlationId, error: error.code } };
  }
  return { status: error.status, body: { error: error.code } };
}

// Re-exported so a caller mapping a driver failure does not have to import from
// two modules to name the same string.
export { SUPPORT_DRAFT_DRIVER_UNAVAILABLE };
