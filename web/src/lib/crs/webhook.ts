// web/src/lib/crs/webhook.ts — verification and per-event parsing for the CRS webhook rail.
//
// One module, shared by both drivers and by the route handler, so a forged request is rejected
// identically wherever it arrives and no caller ever holds the raw body beyond this call.
//
// What CRS publishes in the client spec updated 2026-08-27:
//
//   - Auth is HTTP Basic over SSL, and both portal credential fields are capped at 15 characters.
//     The dated limit lives in `spec-catalog.ts`; a longer value can never match what CRS sends.
//   - HMAC signing and a source-IP allowlist are NOT published anywhere (pre-flight A5b). The
//     frozen `CrsWebhookParse` carries `bad_signature` and `source_ip` reasons regardless, so both
//     are implemented as OPTIONAL controls that engage only when their configuration is present.
//     An unconfigured optional control is skipped entirely and is never reported as a control we
//     ran: advertising a signature check this account may not have been granted is worse than
//     openly not having one.
//   - Basic auth is the opposite case. It is published, it is the only control CRS confirms, and
//     an unconfigured credential therefore FAILS CLOSED. "Not configured" must never resolve to
//     "allow anyone", which is exactly what an optional-by-default Basic check would mean.
//
// Nothing in this file logs, and nothing it returns carries any part of the request. Every
// rejection is a bare reason string from the frozen union — that is threat T-04-12, because a
// rejection message is the most natural place for a credential or a body fragment to land, and an
// error message is the one string that reliably reaches a log.
//
// Nothing here reads `process.env` (the env arrives as an argument), nothing throws at import
// time, and the only import is the `node:crypto` builtin.

import crypto from 'node:crypto';

import {
  CRS_SPEC_WEBHOOK_ALERT_TYPE,
  CRS_SPEC_WEBHOOK_BASIC_CREDENTIAL_MAX_LENGTH,
} from './spec-catalog.ts';
import type { CrsMemberRef, CrsWebhookParse } from './types.ts';

// ---------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------

/**
 * UNVERIFIED-FOR-ACCOUNT (no public source; pre-flight A5b) — CRS names no signature header, so
 * this default is ours. `CRS_WEBHOOK_HMAC_HEADER` overrides it the day CRS names one; nothing
 * else in the codebase assumes this spelling.
 */
const DEFAULT_HMAC_HEADER = 'x-crs-signature';

/** The `sha256=` prefix many providers put on a hex digest. Accepted, never required. */
const SIGNATURE_PREFIX = 'sha256=';

/**
 * The three webhook controls, resolved from configuration rather than read at a call site.
 *
 * `null` and `[]` are load-bearing: they mean "this control is not configured", and each control
 * reads its own absence differently — Basic auth fails closed on it, the other two skip.
 */
export interface CrsWebhookConfig {
  /** Basic-auth user. `null` is unconfigured, which FAILS CLOSED. */
  basicUser: string | null;
  /** Basic-auth password. `null` is unconfigured, which FAILS CLOSED. */
  basicPass: string | null;
  /** `null` disables the HMAC check entirely — it is not a published CRS control. */
  hmacSecret: string | null;
  /** Header the hex digest is read from; defaults to `x-crs-signature`. */
  hmacHeader: string;
  /** Empty disables the source-IP check entirely. Exact string matching only, no CIDR ranges —
   *  CRS publishes no egress range, so there is nothing to model a subnet against. */
  sourceIps: string[];
}

/**
 * Read a configured value, treating an absent variable and a blank one identically — a blank env
 * row in a deployment console is a missing key, not a configured empty credential.
 *
 * The value itself is NOT trimmed, only tested. A credential with a deliberate leading or
 * trailing space is still that credential, and silently reshaping one produces an authentication
 * failure with no visible cause.
 */
function readConfiguredValue(value: string | undefined): string | null {
  if (value === undefined) return null;
  return value.trim() === '' ? null : value;
}

function readPortalCredential(value: string | undefined, username: boolean): string | null {
  const configured = readConfiguredValue(value);
  if (configured === null || configured.length > CRS_SPEC_WEBHOOK_BASIC_CREDENTIAL_MAX_LENGTH) {
    return null;
  }
  if (username && configured.includes(':')) return null;
  return configured;
}

/** Comma-separated, each entry trimmed, blank entries dropped, so a trailing comma is harmless. */
function readAddressList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

/**
 * Build the webhook configuration from an environment.
 *
 * Reads only its argument and never `process.env`, so the whole matrix is testable from literal
 * objects, and throws on nothing at all: a missing key means the corresponding control is not
 * configured, which each control below then interprets for itself. An import-time throw on a
 * missing key would brick a deployment that has no CRS credentials yet, which is every
 * deployment today.
 */
export function readWebhookConfigFromEnv(env: NodeJS.ProcessEnv): CrsWebhookConfig {
  const configuredHeader = (env.CRS_WEBHOOK_HMAC_HEADER ?? '').trim();

  return {
    basicUser: readPortalCredential(env.CRS_WEBHOOK_BASIC_USER, true),
    basicPass: readPortalCredential(env.CRS_WEBHOOK_BASIC_PASS, false),
    hmacSecret: readConfiguredValue(env.CRS_WEBHOOK_HMAC_SECRET),
    hmacHeader: configuredHeader === '' ? DEFAULT_HMAC_HEADER : configuredHeader,
    sourceIps: readAddressList(env.CRS_WEBHOOK_SOURCE_IPS),
  };
}

// ---------------------------------------------------------------------------------------------
// Batch-level verification
// ---------------------------------------------------------------------------------------------

/** The three rejection reasons a whole request can earn, before any event is looked at. */
export type CrsWebhookVerification =
  | { ok: true }
  | { ok: false; reason: 'bad_auth' | 'bad_signature' | 'source_ip' };

/** Everything the verifier and the parser need about one inbound request. */
export interface CrsWebhookRequest {
  headers: Headers;
  /**
   * The exact string `await request.text()` returned. The digest is computed over THIS string and
   * the same string is what gets parsed, so a signature and the content it signs cannot diverge;
   * signing a re-serialized object instead is threat T-04-11.
   */
  rawBody: string;
  /** The connecting address when the runtime exposes one; `x-forwarded-for` is the fallback. */
  remoteAddress?: string | null;
  config: CrsWebhookConfig;
}

/**
 * Compare two strings without leaking their contents or their lengths through timing.
 *
 * `crypto.timingSafeEqual` throws on a length mismatch, which would turn a wrong-length credential
 * into a different observable outcome from a wrong-content one. Digesting both sides first makes
 * them 32 bytes each unconditionally, so length stops being a signal (threat T-04-13).
 */
function equalsWithoutTiming(left: string, right: string): boolean {
  const leftDigest = crypto.createHash('sha256').update(left, 'utf8').digest();
  const rightDigest = crypto.createHash('sha256').update(right, 'utf8').digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

/** The caller's address: the runtime's own value when it has one, otherwise the first proxy hop. */
function resolveCallerAddress(input: CrsWebhookRequest): string | null {
  const direct = (input.remoteAddress ?? '').trim();
  if (direct !== '') return direct;

  const forwarded = input.headers.get('x-forwarded-for');
  if (forwarded === null) return null;

  const firstHop = forwarded.split(',')[0].trim();
  return firstHop === '' ? null : firstHop;
}

/** Split `Basic <base64>` into its two halves, or `null` for anything malformed. */
function readBasicCredentials(headers: Headers): { user: string; pass: string } | null {
  const header = headers.get('authorization');
  if (header === null) return null;

  // Case-insensitive scheme, per RFC 7235 — a client sending `basic` is not a forgery.
  const match = /^basic\s+(\S+)$/i.exec(header.trim());
  if (match === null) return null;

  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const separatorIndex = decoded.indexOf(':');
  if (separatorIndex < 0) return null;

  // First colon only: a colon is legal inside a password and illegal inside a user name.
  return { user: decoded.slice(0, separatorIndex), pass: decoded.slice(separatorIndex + 1) };
}

/**
 * Verify one inbound webhook request. Returns `{ ok: true }` or a bare reason, and never anything
 * derived from the request.
 *
 * The check order is deliberate and is asserted by the suite, because it decides which reason a
 * request that fails two checks reports:
 *
 *   1. **Source IP** — skipped when no allowlist is configured. Cheapest check, and the one that
 *      does not need the body, so a caller that should not be able to reach us at all is turned
 *      away before its credentials are even looked at.
 *   2. **Basic auth** — the published control, and the one that fails closed when unconfigured.
 *   3. **HMAC** — skipped when no secret is configured. Last because it is the only check that
 *      touches the whole body, and there is no reason to digest a body-sized string for a
 *      caller that already failed authentication.
 */
export function verifyWebhookRequest(input: CrsWebhookRequest): CrsWebhookVerification {
  const { config } = input;

  if (config.sourceIps.length > 0) {
    const callerAddress = resolveCallerAddress(input);
    // No resolvable address is a rejection, not a skip: an allowlist that silently stops applying
    // when the address header is missing is an allowlist an attacker turns off by omitting one.
    if (callerAddress === null || !config.sourceIps.includes(callerAddress)) {
      return { ok: false, reason: 'source_ip' };
    }
  }

  // FAIL CLOSED. An absent credential means the endpoint is not configured to authenticate anyone,
  // and the only safe reading of that is to authenticate nobody (threat T-04-10).
  if (config.basicUser === null || config.basicPass === null) {
    return { ok: false, reason: 'bad_auth' };
  }

  const credentials = readBasicCredentials(input.headers);
  if (credentials === null) return { ok: false, reason: 'bad_auth' };

  // Both comparisons always run — short-circuiting on the user would make a wrong user faster to
  // reject than a wrong password, which is the timing signal the digest comparison exists to deny.
  const userMatches = equalsWithoutTiming(credentials.user, config.basicUser);
  const passMatches = equalsWithoutTiming(credentials.pass, config.basicPass);
  if (!userMatches || !passMatches) return { ok: false, reason: 'bad_auth' };

  if (config.hmacSecret !== null) {
    const presented = (input.headers.get(config.hmacHeader) ?? '').trim().toLowerCase();
    if (presented === '') return { ok: false, reason: 'bad_signature' };

    const offered = presented.startsWith(SIGNATURE_PREFIX)
      ? presented.slice(SIGNATURE_PREFIX.length)
      : presented;

    const expected = crypto
      .createHmac('sha256', config.hmacSecret)
      .update(input.rawBody, 'utf8')
      .digest('hex');

    if (!equalsWithoutTiming(offered, expected)) return { ok: false, reason: 'bad_signature' };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// Per-event parsing into the frozen envelope
//
// CRS posts a JSON ARRAY of events and the frozen `CrsWebhookEvent` models a single one, so the
// array is unwound here rather than in each driver. `time` arrives as epoch MILLISECONDS while
// `occurredAt` is an ISO string, so the conversion lives here too, and rejecting a value it cannot
// convert is the whole point of it — an `Invalid Date` written into a timestamp column does not
// fail where it was produced.
// ---------------------------------------------------------------------------------------------

/** 2000-01-01T00:00:00Z. Below this an epoch-milliseconds field is a seconds value, a sentinel,
 * or otherwise not a real event time for this integration. */
const MIN_EPOCH_MILLISECONDS = 946684800000;

/** 2100-01-01T00:00:00Z. Above this the value is outside the integration's supported window. */
const MAX_EPOCH_MILLISECONDS = 4102444800000;

/** The longest `type` accepted. Generous next to the published names, and bounded so an
 *  arbitrarily long string cannot ride into a database column through a routing key. */
const MAX_EVENT_TYPE_LENGTH = 64;

/**
 * Convert a CRS `time` field to an ISO timestamp, or return `null` when it is not one.
 *
 * A numeric STRING is rejected rather than coerced. CRS documents the field as a number, and a
 * silently coerced string is how a malformed value survives long enough to become `Invalid Date`
 * in a column somebody reads six weeks later. Validation contract CRS-05 (b) requires the
 * rejection, so returning an `Invalid Date` string here is a failure and not a tolerated edge.
 */
export function epochMillisecondsToIso(value: unknown): string | null {
  if (typeof value !== 'number') return null;
  // Rejects NaN and both infinities as well as fractions — `Number.isInteger` is false for all of
  // them, which is exactly the set that produces a nonsense instant rather than an early error.
  if (!Number.isInteger(value)) return null;
  if (value < MIN_EPOCH_MILLISECONDS || value > MAX_EPOCH_MILLISECONDS) return null;

  return new Date(value).toISOString();
}

/**
 * One parsed element of the batch: the frozen envelope, plus the vendor's `id` ALONGSIDE it.
 *
 * The id rides beside the envelope and never inside it. `CrsWebhookEvent` is frozen at three
 * fields, and the ACK array CRS expects is `[{hook_id, status}]` — so the id has to survive the
 * parse for plan 04-06 to answer per event, and widening the frozen type to carry it is not
 * available. This is interface ask-2.
 *
 * `hookId` is carried on a rejected element too, when the element supplied one: reporting
 * `status: false` against the right id is what lets CRS resend exactly the events that failed
 * instead of the whole batch (threat T-04-15).
 */
export interface CrsWebhookBatchEntry {
  hookId: string | null;
  parse: CrsWebhookParse;
  alertPointer?: {
    alertId: string;
    alertReportedAt: string;
  };
}

/** A non-empty string after trimming, or `null` — the shape test every required field shares. */
function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** One entry, built from one element of the array. */
function parseEvent(element: unknown): CrsWebhookBatchEntry {
  if (typeof element !== 'object' || element === null || Array.isArray(element)) {
    return { hookId: null, parse: { ok: false, reason: 'bad_shape' } };
  }

  const fields = element as Record<string, unknown>;
  const hookId = readNonEmptyString(fields.id);

  const eventType = readNonEmptyString(fields.type);
  const hasUserId = Object.hasOwn(fields, 'user_id');
  const memberRef = fields.user_id === null ? null : readNonEmptyString(fields.user_id);
  const occurredAt = epochMillisecondsToIso(fields.time);
  const alertId = readNonEmptyString(fields.alert_id);
  const alertReportedAt = epochMillisecondsToIso(fields.alert_date);
  const alertShapeIsValid = eventType !== CRS_SPEC_WEBHOOK_ALERT_TYPE
    || (alertId !== null && alertReportedAt !== null);

  // An UNPUBLISHED type is accepted rather than rejected, and that is a deliberate reading of the
  // retry rule: CRS resends any event our response body does not mark `true`, so rejecting a
  // unpublished type would put it in a resend loop that never ends and never gets better. Storing
  // it as-is costs a row; refusing it costs the endpoint (threat T-04-14). The length bound is
  // what keeps "accept anything" from meaning "accept anything of any size".
  if (
    hookId === null ||
    eventType === null ||
    eventType.length > MAX_EVENT_TYPE_LENGTH ||
    !hasUserId ||
    (fields.user_id !== null && memberRef === null) ||
    occurredAt === null ||
    !alertShapeIsValid
  ) {
    return { hookId, parse: { ok: false, reason: 'bad_shape' } };
  }

  // The full alert body is discarded. ACCALERT keeps only alert_id and alert_date as the transient
  // fetch pointer approved in Phase 0; alert_source, error fields, host_id, and unknown detail
  // reach no return value or log. The envelope is constructed field by field for that reason.
  const parsed: CrsWebhookBatchEntry = {
    hookId,
    parse: {
      ok: true,
      event: {
        eventType,
        occurredAt,
        memberRef: memberRef as CrsMemberRef | null,
      },
    },
  };
  if (eventType === CRS_SPEC_WEBHOOK_ALERT_TYPE) {
    parsed.alertPointer = {
      alertId: alertId as string,
      alertReportedAt: alertReportedAt as string,
    };
  }
  return parsed;
}

/**
 * Verify a request and parse every event in it, one entry per element, in the order CRS sent them.
 *
 * A batch-level rejection returns a SINGLE entry carrying that reason rather than an empty array,
 * so a caller cannot mistake a forged request for a request that happened to contain no events —
 * those two have opposite consequences and an empty array reads as the harmless one.
 *
 * A malformed element rejects only itself. One unparseable event in a nightly batch suppressing
 * the other forty-nine would be the worst possible reading of a partial failure.
 */
export function parseWebhookBatchEntries(input: CrsWebhookRequest): CrsWebhookBatchEntry[] {
  const verification = verifyWebhookRequest(input);
  if (!verification.ok) {
    return [{ hookId: null, parse: { ok: false, reason: verification.reason } }];
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(input.rawBody);
  } catch {
    // The caught value is discarded without being read. A JSON parse error's message quotes the
    // input it choked on, which is the request body — the one string that must not travel.
    return [{ hookId: null, parse: { ok: false, reason: 'bad_shape' } }];
  }

  if (!Array.isArray(decoded) || decoded.length === 0) {
    return [{ hookId: null, parse: { ok: false, reason: 'bad_shape' } }];
  }

  return decoded.map((element) => parseEvent(element));
}

/**
 * The same parse without the vendor ids — the function 04-CONTEXT names.
 *
 * Defined in terms of the entry form so there is one parser and not two. A caller that does not
 * build the ACK array does not need the ids and should not be handed them.
 */
export function parseWebhookBatch(input: CrsWebhookRequest): CrsWebhookParse[] {
  return parseWebhookBatchEntries(input).map((entry) => entry.parse);
}

/**
 * The single-event function both drivers use to satisfy the frozen
 * `CrsAdapter.verifyAndParseWebhook`.
 *
 * Both drivers delegate here rather than each implementing verification, so a forged request is
 * rejected identically whichever driver happens to be loaded — a mock that accepted what sandbox
 * rejects would make every contract test a lie.
 */
export function verifyAndParseWebhookImpl(input: CrsWebhookRequest): CrsWebhookParse {
  const entries = parseWebhookBatchEntries(input);
  // `parseWebhookBatchEntries` never returns an empty array today; the guard is here so that a
  // later change to it cannot turn "no entries" into a thrown TypeError on a live endpoint.
  if (entries.length === 0) return { ok: false, reason: 'bad_shape' };
  return entries[0].parse;
}
