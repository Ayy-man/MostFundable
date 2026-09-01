// The assistant's vocabulary, mirroring migration 387 exactly.
//
// Unions rather than TypeScript `enum`s, which this repo bans
// (`verify-source-gates.mjs`). Each union is the same closed set the database
// carries, so a value that cannot be stored also cannot be typed.
//
// There is no consumer scope here and there is not going to be one. A consumer's
// assistant answers through `lib/kb/consumer.ts` under the supervisor gate, and
// a scope in this file would be a second, quieter path to the same person.

export type AssistantScope = 'operator' | 'admin';

/**
 * The standing line rendered under every answer in a scope, or null.
 *
 * It lives here rather than inside a turn's stored body because it is product
 * copy that is constant per scope — the same words on every operator answer
 * forever. Storing it per row would put a literal in the database, and it is
 * also the one thing `decodeAnswerBody` cannot separate back out of a body whose
 * answer had no bullets. A surface reads the conversation's `scope` and calls
 * this.
 */
export function assistantFooterForScope(scope: AssistantScope): string | null {
  return scope === 'operator'
    ? 'Answers come from your workspace data. Not credit, legal, or tax advice.'
    : null;
}

export type AssistantTurnRole = 'user' | 'assistant';

/**
 * The five kinds a cited source can have.
 *
 * The same five labels are hard-coded in `private.assistant_sources_valid`,
 * which is what actually refuses a sixth. Two declarations, and the pgTAP file
 * for migration 387 exercises every one of them so the pair cannot drift
 * silently in either direction.
 */
export const ASSISTANT_SOURCE_KINDS = [
  'client',
  'bank',
  'article',
  'operator',
  'metric',
] as const;

export type AssistantSourceKind = (typeof ASSISTANT_SOURCE_KINDS)[number];

export interface AssistantSource {
  readonly kind: AssistantSourceKind;
  /** Human label. Never an id. */
  readonly label: string;
  /**
   * @opaque
   * Opaque handle the surface passes back to open a peek. Never rendered — not
   * as text, not in a title attribute, not in a `data-` attribute, not in a copy
   * button. The tag is the vocabulary `no-raw-identifiers.test.ts` derives its
   * protected-field set from, so tagging it here is what makes the component
   * sweep bite on the assistant views lane 4b builds.
   */
  readonly ref: string | null;
}

export interface AssistantConversation {
  readonly id: string;
  readonly title: string;
  readonly scope: AssistantScope;
  readonly createdAt: string;
  readonly lastActivityAt: string;
  readonly messageCount: number;
}

export interface AssistantTurn {
  readonly id: string;
  readonly role: AssistantTurnRole;
  /**
   * The stored text.
   *
   * For an assistant turn this is the canonical encoding `lib/kb/answer-body.ts`
   * writes, and `headline` / `bullets` below are that encoding read back — so a
   * surface renders the parts and never splits this string itself. For a user
   * turn it is the question as asked.
   */
  readonly body: string;
  /**
   * F-09. The answer's opening sentence, decoded from `body`.
   *
   * `assistant_turns` has one text column and adding another is a migration this
   * lane does not own, so the structure travels inside `body` in a format the
   * server writes and this repository reads. That is decoding, not the prose
   * parsing the finding is about: nothing but `encodeAnswerBody` ever produces
   * the input.
   *
   * On a user turn this is the question, and `bullets` is empty.
   */
  readonly headline: string;
  /** The answer's supporting points, decoded from `body`. Empty on a user turn. */
  readonly bullets: readonly string[];
  readonly createdAt: string;
  readonly sources: readonly AssistantSource[];
}

/**
 * The stages the server reports while a turn is being answered.
 *
 * Each one is emitted when real work has finished and the next piece has
 * started, never on a timer:
 *
 *   searching   the request arrived and the permitted record read has begun
 *   reading     the grounding set has returned, with its display titles
 *   composing   the candidate call is out
 *   reviewing   the candidate came back, passed the compliance and citation
 *               scans, and the supervisor call is out
 *
 * A candidate the local scans reject produces no `reviewing` stage at all, and
 * the stream ends with an error — which is the truthful shape, because the
 * supervisor was never asked.
 */
export const ASSISTANT_STAGES = ['searching', 'reading', 'composing', 'reviewing'] as const;

export type AssistantStage = (typeof ASSISTANT_STAGES)[number];

export type AssistantProgressEvent =
  | { readonly stage: Exclude<AssistantStage, 'reading'> }
  | { readonly stage: 'reading'; readonly titles: readonly string[] };

/**
 * The closed set of outcomes an assistant operation can have.
 *
 * `ASSISTANT_REQUEST_INVALID` is the routes' own: a payload that fails
 * validation before any database call. The five after it are raised by
 * migration 387. The four specific answer outcomes separate an empty read, a
 * scope boundary, a provider outage and a policy refusal, because only the
 * provider outage is worth retrying unchanged. `ASSISTANT_ANSWER_UNAVAILABLE`
 * remains in the vocabulary for responses produced before that split; new
 * answer paths must use the specific outcome they observed.
 */
export const ASSISTANT_ERROR_CODES = [
  'ASSISTANT_REQUEST_INVALID',
  'ASSISTANT_ACTOR_REQUIRED',
  'ASSISTANT_ACTOR_UNKNOWN',
  'ASSISTANT_FORBIDDEN',
  'ASSISTANT_NOT_FOUND',
  'ASSISTANT_SCOPE_INVALID',
  'ASSISTANT_SCOPE_UNAVAILABLE',
  'ASSISTANT_NO_MATCHING_RECORDS',
  'ASSISTANT_OUT_OF_SCOPE',
  'ASSISTANT_PROVIDER_UNAVAILABLE',
  'ASSISTANT_DATA_UNAVAILABLE',
  'ASSISTANT_ANSWER_MALFORMED',
  'ASSISTANT_RESULT_TOO_LARGE',
  'ASSISTANT_POLICY_REFUSED',
  // Compatibility only: older deployed streams may still emit this code.
  'ASSISTANT_ANSWER_UNAVAILABLE',
  'ASSISTANT_UNAVAILABLE',
] as const;

export type AssistantErrorCode = (typeof ASSISTANT_ERROR_CODES)[number];

const STATUS_BY_CODE: Readonly<Record<AssistantErrorCode, number>> = {
  ASSISTANT_REQUEST_INVALID: 400,
  ASSISTANT_ACTOR_REQUIRED: 401,
  ASSISTANT_ACTOR_UNKNOWN: 401,
  ASSISTANT_FORBIDDEN: 403,
  ASSISTANT_NOT_FOUND: 404,
  ASSISTANT_SCOPE_INVALID: 422,
  // 501, not 503. A scope with no implementation is not a temporary outage and
  // telling a caller to retry would be wrong advice.
  ASSISTANT_SCOPE_UNAVAILABLE: 501,
  ASSISTANT_NO_MATCHING_RECORDS: 404,
  ASSISTANT_OUT_OF_SCOPE: 403,
  ASSISTANT_PROVIDER_UNAVAILABLE: 503,
  ASSISTANT_DATA_UNAVAILABLE: 503,
  // 502, not 503. The provider answered; what came back could not be used. A
  // caller that reads 503 as "the upstream is down" would be told about an
  // outage that did not happen, which is the whole reason this code exists.
  ASSISTANT_ANSWER_MALFORMED: 502,
  // 422, not 503. The read succeeded and held more records than one grounded
  // answer can carry in full, so repeating the question unchanged cannot help;
  // a narrower question can.
  ASSISTANT_RESULT_TOO_LARGE: 422,
  ASSISTANT_POLICY_REFUSED: 403,
  ASSISTANT_ANSWER_UNAVAILABLE: 503,
  ASSISTANT_UNAVAILABLE: 500,
};

const KNOWN_CODES: ReadonlySet<string> = new Set(ASSISTANT_ERROR_CODES);

/**
 * An `AssistantError`'s `message` IS its code.
 *
 * There is no second human-readable string, so no table name, constraint name,
 * or row value has a way to reach a client. Same arrangement as
 * `lib/support/errors.ts`, and for the same reason.
 */
export class AssistantError extends Error {
  readonly code: AssistantErrorCode;
  readonly status: number;

  constructor(code: AssistantErrorCode) {
    super(code);
    this.name = 'AssistantError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
  }
}

export function assistantErrorStatus(code: AssistantErrorCode): number {
  return STATUS_BY_CODE[code];
}

function readStringField(value: unknown, field: string): string | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const candidate = (value as Record<string, unknown>)[field];
  return typeof candidate === 'string' ? candidate.trim() : undefined;
}

/**
 * Normalize anything thrown into an `AssistantError`.
 *
 * Migration 387 raises with `errcode = 'P0001'` and a fixed message, so a
 * refusal arrives from PostgREST as an object whose `message` is one of a known
 * five. Everything else — a network failure, a constraint nobody anticipated —
 * becomes `ASSISTANT_UNAVAILABLE`, and the original text is dropped here so no
 * later layer has the option of forwarding it.
 */
export function toAssistantError(value: unknown): AssistantError {
  if (value instanceof AssistantError) return value;

  const fromCode = readStringField(value, 'code');
  if (fromCode !== undefined && KNOWN_CODES.has(fromCode)) {
    return new AssistantError(fromCode as AssistantErrorCode);
  }

  const fromMessage =
    value instanceof Error ? value.message.trim() : readStringField(value, 'message');
  if (fromMessage !== undefined && KNOWN_CODES.has(fromMessage)) {
    return new AssistantError(fromMessage as AssistantErrorCode);
  }

  return new AssistantError('ASSISTANT_UNAVAILABLE');
}
