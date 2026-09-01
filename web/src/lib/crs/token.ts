// web/src/lib/crs/token.ts — everything `GET /api/monitoring/token` does, as plain functions.
//
// The route wrapper is plan 04-08 and it is about fifteen lines: read the URL and the headers off
// the incoming request, call `handleMonitoringTokenRequest`, and turn the returned status and body
// into a response carrying `Cache-Control: no-store`. The behaviour lives here rather than in the
// route file because the test runner cannot resolve the `@/*` alias a route file needs, so a route
// file is not importable by a test — and every status this endpoint can return is asserted in
// `token.test.ts` against the functions below.
//
// NOTHING IN THIS FILE LOGS. Not the member handle, not the caller's id, not the reason a request
// was refused, not a provider failure. Each of those is either a consumer identifier or provider
// content, and CRS-02 says neither reaches a log line. The natural instinct on the 502 path is to
// log context so the failure can be debugged later; the context on that path is a member handle,
// so the answer is a fixed body and nothing written anywhere (threat T-04-24).
//
// Nothing here reads the process environment directly — every env-dependent decision is a pure
// function of an `env` argument, so the whole matrix is drivable from literal objects in a test
// with no global stubbing. Nothing throws on import either.

import { CRS_PREAUTH_TOKEN_TTL_SECONDS } from './constants.ts';
import { resolveCrsDriver } from './driver.ts';
import { isAnalysisEnabled } from './feature-flag.ts';
import { MonitoringInactiveError } from './ports.ts';
import type { Clock, MemberRefResolver } from './ports.ts';
import type { CrsAdapter, CrsDriver, CrsMemberRef, PreauthToken } from './types.ts';

// ---------------------------------------------------------------------------------------------
// The preauth token lifecycle — CRS-03
// ---------------------------------------------------------------------------------------------

/**
 * Build a `PreauthToken` that expires exactly `ttlSeconds` after `now`.
 *
 * The default is `CRS_PREAUTH_TOKEN_TTL_SECONDS`, read from `constants.ts` rather than written as
 * a literal here. That indirection is the point: the verified value carries its source URL and its
 * fetch date next to it, and a handler holding its own copy is a handler that keeps answering with
 * the old number the day CRS publishes a new one. The parameter exists so the sandbox driver can
 * pass back whatever the provider actually says on the wire instead of assuming our default.
 *
 * `expiresAt` is derived from `now` and the TTL and from nothing else, so
 * `Date.parse(expiresAt) - now.getTime()` is exactly `ttlSeconds * 1000` — which is what makes the
 * expiry boundary testable to the millisecond with an injected clock rather than a sleep.
 */
export function buildPreauthToken(
  input: { token: string; ttlSeconds?: number },
  now: Date,
): PreauthToken {
  const ttlSeconds = input.ttlSeconds ?? CRS_PREAUTH_TOKEN_TTL_SECONDS;

  return {
    token: input.token,
    expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
    ttlSeconds,
  };
}

/**
 * The SINGLE expiry predicate in the codebase. Nothing else anywhere compares a timestamp to
 * decide whether a preauth token is still live, because two comparisons written months apart are
 * two chances to get the boundary wrong in opposite directions.
 *
 * The comparison is greater-than-OR-EQUAL and that is deliberate: at the exact expiry instant the
 * token is expired. So it is false at `expiresAt - 1 ms` and true at `expiresAt`, and both
 * boundaries are asserted rather than one of them being left to inference.
 *
 * An unparseable `expiresAt` reads as EXPIRED. `Date.parse` answers `NaN` there, every comparison
 * against `NaN` is false, and a bare `>=` would therefore call a malformed token live forever —
 * the one direction this predicate must never fail in, since the whole reason `handleMonitoringTokenRequest`
 * calls it before answering 200 is to refuse to hand the browser a token that cannot work.
 */
export function isPreauthTokenExpired(token: PreauthToken, now: Date): boolean {
  const expiresAtMs = Date.parse(token.expiresAt);
  if (Number.isNaN(expiresAtMs)) return true;

  return now.getTime() >= expiresAtMs;
}

// ---------------------------------------------------------------------------------------------
// The caller-session port
// ---------------------------------------------------------------------------------------------

/**
 * Who is asking. One method, and it answers `null` for "nobody we can identify" rather than
 * throwing, because an anonymous request to this endpoint is an ordinary event and not an error
 * condition.
 *
 * This is a lane-C-local port standing in for lane A's session helper (INTERFACES §3.1), which is
 * not in this branch: Phase 1 has not merged here, so an import of it would not typecheck. Its
 * module path is deliberately not written anywhere in this directory — the CRS-02 grep gate treats
 * a path in a comment exactly like an import, and it is right to.
 *
 * Phase 5 replaces the implementation immediately after `git rebase main` and nothing above this
 * port changes: `resolveMemberRefForRequest` and `handleMonitoringTokenRequest` never learn which
 * reader they hold.
 */
export interface CallerSessionReader {
  resolveClientId(input: { headers: Headers }): Promise<string | null>;
}

/**
 * A reader that identifies nobody — the correct behaviour on the Phase-4 branch, where no session
 * helper existed, and still the right default for unit suites. Production wiring switched to
 * `createSessionCallerReader` (session-reader.ts) on 2026-08-17; until then every caller of
 * `GET /api/monitoring/token` got 401 (GAPS G-3B-09).
 *
 * An endpoint that mints monitoring tokens for a caller it cannot identify hands one consumer's
 * bureau view to whoever asked, so while there is no session to read, 401 is the right answer and
 * it is asserted (threat T-04-22). The alternative — resolving some default caller so the happy
 * path can be demonstrated before auth lands — is the failure mode this exists to rule out.
 */
export function createUnauthenticatedSessionReader(): CallerSessionReader {
  return {
    resolveClientId(): Promise<string | null> {
      return Promise.resolve(null);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Member-ref safety — threat T-04-21
// ---------------------------------------------------------------------------------------------

/** The query parameter the development affordance reads, named once so nothing greps for a string. */
const DEVELOPMENT_MEMBER_REF_PARAM = 'memberRef';

/**
 * The prefix every member handle the mock driver mints carries (plan 04-04 documents the shape as
 * load-bearing for exactly this check). A real CRS handle does not look like this, so the prefix
 * is what stops the affordance from ever addressing a real member even if the first two conditions
 * were somehow both satisfied.
 */
const MOCK_MEMBER_REF_PREFIX = 'mock_';

/** Why a request gets no member handle. Each maps to one status and to no response body. */
export type MemberRefRefusal = 'unauthenticated' | 'not_enrolled' | 'monitoring_inactive' | 'forbidden_member_ref';

export type MemberRefResolution =
  | { ok: true; memberRef: CrsMemberRef }
  | { ok: false; reason: MemberRefRefusal };

/**
 * Resolve which CRS member this request is allowed to ask about.
 *
 * `CrsMemberRef` is a GLOBAL opaque handle with no organisation scoping (pre-flight scope check),
 * so accepting one from a request is a cross-consumer read: whoever guesses or is handed another
 * consumer's handle gets a token that renders that consumer's bureau data in a widget. The handle
 * is therefore resolved from the caller's own enrollment, and it is never read from a header, a
 * cookie or a body. The one exception is the development affordance below.
 *
 * The affordance is gated on THREE conditions, written out as three separate named booleans so a
 * reviewer sees all three at once and a later edit cannot quietly collapse them into one:
 * a non-production `NODE_ENV`, the mock driver, and the `mock_` prefix. All eight combinations are
 * asserted in `token.test.ts`, so removing any single condition fails the suite rather than
 * passing review.
 *
 * A supplied parameter that fails any condition is refused with `forbidden_member_ref` rather than
 * being ignored and falling through to the caller's own handle. Silently ignoring it would answer
 * 200 with somebody's legitimate token and hide the event; a `?memberRef=` arriving on `main` is a
 * signal worth surfacing, not a typo worth tolerating.
 *
 * This function reads no environment variable except through its `env` argument, and it never
 * reaches for the process environment directly.
 */
export async function resolveMemberRefForRequest(input: {
  url: URL;
  headers: Headers;
  env: NodeJS.ProcessEnv;
  session: CallerSessionReader;
  resolver: MemberRefResolver;
}): Promise<MemberRefResolution> {
  const suppliedMemberRef = input.url.searchParams.get(DEVELOPMENT_MEMBER_REF_PARAM);

  if (suppliedMemberRef !== null) {
    // `resolveCrsDriver` throws a `CrsConfigError` when `CRS_DRIVER` names a driver we do not
    // implement. An environment we cannot classify must never satisfy the affordance, so that
    // throw reads as "not the mock driver" and this gate stays closed; an unhandled throw here
    // would turn a typo in one environment row into a 500 on a request whose correct answer is
    // 403, and it would leave the loud failure in the wrong place — the boot-time credential
    // assertion at adapter construction is where a misconfigured driver is supposed to be loud.
    let resolvedDriver: CrsDriver | null;
    try {
      resolvedDriver = resolveCrsDriver(input.env);
    } catch {
      resolvedDriver = null;
    }

    // The three conditions, as three named booleans on three consecutive lines. All eight
    // combinations of them are asserted in `token.test.ts`, so an edit that drops one — or that
    // collapses them into a single expression somebody later "simplifies" — fails the suite.
    const environmentIsNotProduction = input.env.NODE_ENV !== 'production';
    const driverIsMock = resolvedDriver === 'mock';
    const refCarriesMockPrefix = suppliedMemberRef.startsWith(MOCK_MEMBER_REF_PREFIX);

    if (environmentIsNotProduction && driverIsMock && refCarriesMockPrefix) {
      return { ok: true, memberRef: suppliedMemberRef as CrsMemberRef };
    }

    return { ok: false, reason: 'forbidden_member_ref' };
  }

  const clientId = await input.session.resolveClientId({ headers: input.headers });
  if (clientId === null) {
    return { ok: false, reason: 'unauthenticated' };
  }

  // Null here is "this caller has not enrolled yet", which is an ordinary state on the way through
  // onboarding and not a failure: nothing throws, nothing is written and nothing is logged. The
  // natural way to record a failed lookup is to log the context object, and the context object on
  // this line is a consumer identifier.
  let memberRef;
  try {
    memberRef = await input.resolver.resolveForClient(clientId);
  } catch (error) {
    if (error instanceof MonitoringInactiveError) return { ok: false, reason: 'monitoring_inactive' };
    throw error;
  }
  if (memberRef === null) {
    return { ok: false, reason: 'not_enrolled' };
  }

  return { ok: true, memberRef };
}

// ---------------------------------------------------------------------------------------------
// The endpoint itself
// ---------------------------------------------------------------------------------------------

const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_BAD_GATEWAY = 502;

/**
 * Keyed by the refusal union, so adding a reason without deciding its status is a type error
 * rather than an `undefined` status reaching a response.
 */
const STATUS_BY_REFUSAL: Readonly<Record<MemberRefRefusal, number>> = {
  unauthenticated: HTTP_UNAUTHORIZED,
  forbidden_member_ref: HTTP_FORBIDDEN,
  not_enrolled: HTTP_NOT_FOUND,
  monitoring_inactive: HTTP_FORBIDDEN,
};

/**
 * The only thing a caller learns from a failed request. CRS publishes no error catalogue
 * (pre-flight A-new-2), so there is nothing meaningful to map even if echoing a provider body were
 * acceptable — and it is not, because a provider body is exactly the exit CRS-02 closes.
 */
const CRS_UNAVAILABLE_ERROR = 'crs_unavailable';

/** The 200 body. Exactly three fields, and nothing may be added to it — see the note below. */
export interface MonitoringTokenBody {
  token: string;
  expiresAt: string;
  ttlSeconds: number;
}

export interface MonitoringTokenResult {
  status: number;
  body: unknown;
}

/** A fresh object each time, so no caller can mutate a shared one out from under the next. */
function crsUnavailable(): MonitoringTokenResult {
  return { status: HTTP_BAD_GATEWAY, body: { error: CRS_UNAVAILABLE_ERROR } };
}

/**
 * The whole endpoint, as one function over injected dependencies.
 *
 * Statuses, in the order they are decided:
 *
 * - **404, null body** when `FEATURE_ANALYSIS` is off. A disabled route does not exist; it does not
 *   answer 403 advertising that it would work once enabled, and it certainly does not answer 200
 *   with a stub token. The flag is checked FIRST, before anything constructs or calls an adapter,
 *   because plan 04-07's sandbox adapter throws at construction when credentials are absent and a
 *   404 path that could trip that throw would take the route down on `main` (threat T-04-26). Plan
 *   04-08's route repeats the check before it builds an adapter at all; this one is the backstop.
 * - **401** for a caller we cannot identify, **403** for a refused `?memberRef=`, **404** for a
 *   caller who has not enrolled yet. All three have a null body: a body explaining which condition
 *   failed would hand an attacker the gate's shape.
 * - **200** with exactly `token`, `expiresAt` and `ttlSeconds`. The body is rebuilt field by field
 *   rather than spread from the adapter's result, so a driver returning an over-wide object cannot
 *   leak a field through this response. No member handle, no client id and no driver name — the
 *   handle and the id are consumer identifiers, and the driver name tells a caller which rail is
 *   running, which no consumer of the adapter is allowed to branch on anyway (INTERFACES §10,
 *   threat T-04-23).
 * - **502** with a fixed body when the adapter throws, whatever it throws.
 *
 * Before answering 200 the token is checked against the clock rather than trusted. A driver that
 * returns an already-dead token would otherwise produce a widget that fails in the browser for
 * reasons nothing on our side recorded; one comparison turns that into a visible 502.
 *
 * Every path here is silent. See the file header.
 */
export async function handleMonitoringTokenRequest(input: {
  url: URL;
  headers: Headers;
  env: NodeJS.ProcessEnv;
  adapter: CrsAdapter;
  session: CallerSessionReader;
  resolver: MemberRefResolver;
  clock: Clock;
}): Promise<MonitoringTokenResult> {
  if (!isAnalysisEnabled(input.env)) {
    return { status: HTTP_NOT_FOUND, body: null };
  }

  const resolution = await resolveMemberRefForRequest({
    url: input.url,
    headers: input.headers,
    env: input.env,
    session: input.session,
    resolver: input.resolver,
  });

  if (!resolution.ok) {
    return { status: STATUS_BY_REFUSAL[resolution.reason], body: null };
  }

  let token: PreauthToken;
  try {
    token = await input.adapter.getPreauthToken(resolution.memberRef);
  } catch {
    // The caught value is deliberately not bound. There is no name in scope here that could be
    // interpolated into a message, attached to the response or passed to a logger by a later edit.
    return crsUnavailable();
  }

  if (isPreauthTokenExpired(token, input.clock.now())) {
    return crsUnavailable();
  }

  const body: MonitoringTokenBody = {
    token: token.token,
    expiresAt: token.expiresAt,
    ttlSeconds: token.ttlSeconds,
  };

  return { status: HTTP_OK, body };
}
