// web/src/lib/crs/token.test.ts — CRS-03 at both expiry boundaries, and the "Token endpoint
// safety" row of 04-VALIDATION.md in full.
//
// Time is injected everywhere. Every instant in this file comes from `createFixedClock` or from a
// `new Date` built out of one, so the expiry boundary is pinned to the millisecond, and the whole
// file finishes in single-digit milliseconds and nothing here can go flaky on a loaded machine.
// There is no timer and no wall-clock read: a test that waited for real time to pass would be
// asserting that the machine is not busy, which is a different claim from the one CRS-03 makes.
//
// Nothing imports a route handler and nothing starts a server. The behaviour under test is a set
// of plain functions over injected dependencies precisely so that it can be asserted without
// either — plan 04-08's route file wraps these functions and is not importable here, because the
// runner cannot resolve the `@/*` alias a route file needs.
//
// Every literal that stands in for a credential or a consumer handle is transparently synthetic
// and says so in its own value. `example.invalid` is RFC 2606's reserved TLD, so no URL here can
// name a real host.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CRS_PREAUTH_TOKEN_TTL_SECONDS } from './constants.ts';
import { CrsDriverError } from './errors.ts';
import { createFixedClock, createInMemoryMemberRefResolver } from './ports.ts';
import { MonitoringInactiveError } from './ports.ts';
import type { Clock, MemberRefResolver } from './ports.ts';
import {
  buildPreauthToken,
  createUnauthenticatedSessionReader,
  handleMonitoringTokenRequest,
  isPreauthTokenExpired,
  resolveMemberRefForRequest,
} from './token.ts';
import type { CallerSessionReader, MonitoringTokenResult } from './token.ts';
import type { CrsAdapter, CrsMemberRef, PreauthToken } from './types.ts';

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

const FIXTURE_INSTANT = '2026-08-16T12:00:00.000Z';

/**
 * The published preauth TTL, written here as a bare literal ON PURPOSE.
 *
 * `token.ts` reads the constant and never a literal, so if this file did the same, both sides
 * would move together and CRS-03 would assert nothing more than "the module agrees with itself".
 * The number below is the one verified against CRS's "Token Validity Times" page on 2026-08-16,
 * and the first assertion in this file is that the constant still equals it.
 */
const PUBLISHED_PREAUTH_TTL_SECONDS = 30;
const PUBLISHED_PREAUTH_TTL_MS = 30_000;

/** Obviously synthetic: the wrong shape and length for any real token, and it says so. */
const SYNTHETIC_TOKEN = 'not-a-real-preauth-token';

/** The shape every handle the mock driver mints carries (plan 04-04). */
const MOCK_MEMBER_REF = 'mock_clean_1' as CrsMemberRef;

/** A second mock-shaped handle, so "the caller's own" and "the one supplied" are distinguishable. */
const ENROLLED_MEMBER_REF = 'mock_clean_2' as CrsMemberRef;

/**
 * A handle in the shape a real CRS member handle might take, without the `mock_` prefix. The
 * digits are all zero, a value the provider has never issued, so this cannot name a real member
 * even though it is plausible enough to make the point: the prefix, and not the shape, is what
 * refuses it.
 */
const UNPREFIXED_MEMBER_REF = 'crs_member_00000000';

const ENROLLED_CLIENT_ID = 'client-fixture-enrolled';
const UNENROLLED_CLIENT_ID = 'client-fixture-not-yet-enrolled';

const TOKEN_URL = 'https://example.invalid/api/monitoring/token';

/**
 * Next augments `NodeJS.ProcessEnv` with a REQUIRED readonly `NODE_ENV`, so a bare literal is a
 * type error against it even where the function under test reads only its own argument. Same
 * helper as `driver.test.ts`, copied rather than shared per that plan's note.
 */
function testEnv(values: Readonly<Record<string, string | undefined>>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

function fixtureClock(): Clock {
  return createFixedClock(FIXTURE_INSTANT);
}

function urlWith(query?: Readonly<Record<string, string>>): URL {
  const url = new URL(TOKEN_URL);
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }
  return url;
}

// ---------------------------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------------------------

interface CountingSessionReader {
  readonly reader: CallerSessionReader;
  callCount(): number;
}

/** A reader that resolves the given client id, counting how many times it was consulted. */
function countingSessionReader(clientId: string | null): CountingSessionReader {
  let calls = 0;
  return {
    reader: {
      resolveClientId(): Promise<string | null> {
        calls += 1;
        return Promise.resolve(clientId);
      },
    },
    callCount: () => calls,
  };
}

interface StubAdapter {
  readonly adapter: CrsAdapter;
  callCount(): number;
  lastMemberRef(): CrsMemberRef | null;
}

/**
 * A complete `CrsAdapter` whose six other methods throw if anything reaches them.
 *
 * The handler is only ever allowed to call `getPreauthToken`, and a stub that merely omitted the
 * rest would let a future edit call `softPull` from the token path without a single test noticing
 * — which is the one call on this interface that produces a bureau body. Making them loud turns
 * that into a failure with the method's name in it.
 *
 * `getPreauthToken` deliberately does NOT put the handle it was given into the token string, so
 * the "the 200 body names no consumer identifier" assertion below is testing the handler rather
 * than the stub's choice of literal.
 */
function stubAdapter(getPreauthToken: (memberRef: CrsMemberRef) => Promise<PreauthToken>): StubAdapter {
  let calls = 0;
  let lastRef: CrsMemberRef | null = null;

  const unreachable = (operation: string): never => {
    throw new Error(`the monitoring-token handler must never call ${operation}`);
  };

  const adapter: CrsAdapter = {
    driver: 'mock',
    createMember: () => unreachable('createMember'),
    submitIdvStep: () => unreachable('submitIdvStep'),
    getPreauthToken(memberRef: CrsMemberRef): Promise<PreauthToken> {
      calls += 1;
      lastRef = memberRef;
      return getPreauthToken(memberRef);
    },
    getLatestScores: () => unreachable('getLatestScores'),
    closeMember: () => unreachable('closeMember'),
    pauseMember: () => unreachable('pauseMember'),
    resumeMember: () => unreachable('resumeMember'),
    softPull: () => unreachable('softPull'),
    verifyAndParseWebhook: () => unreachable('verifyAndParseWebhook'),
  };

  return { adapter, callCount: () => calls, lastMemberRef: () => lastRef };
}

/** An adapter that issues a live token against the fixture clock. */
function liveTokenAdapter(clock: Clock): StubAdapter {
  return stubAdapter(() => Promise.resolve(buildPreauthToken({ token: SYNTHETIC_TOKEN }, clock.now())));
}

function enrolledResolver(): MemberRefResolver {
  return createInMemoryMemberRefResolver([
    { clientId: ENROLLED_CLIENT_ID, memberRef: ENROLLED_MEMBER_REF },
  ]);
}

function bodyKeys(body: unknown): readonly string[] {
  return Object.keys(body as Record<string, unknown>).sort();
}

// ---------------------------------------------------------------------------------------------
// CRS-03 — the thirty-second lifecycle
// ---------------------------------------------------------------------------------------------

describe('buildPreauthToken — CRS-03', () => {
  it('the verified constant is still the published thirty seconds', () => {
    assert.equal(CRS_PREAUTH_TOKEN_TTL_SECONDS, PUBLISHED_PREAUTH_TTL_SECONDS);
  });

  it('returns the published TTL when the caller names none', () => {
    const token = buildPreauthToken({ token: SYNTHETIC_TOKEN }, new Date(FIXTURE_INSTANT));
    assert.equal(token.ttlSeconds, PUBLISHED_PREAUTH_TTL_SECONDS);
  });

  it('expires exactly thirty thousand milliseconds after it was issued', () => {
    const issuedAt = new Date(FIXTURE_INSTANT);
    const token = buildPreauthToken({ token: SYNTHETIC_TOKEN }, issuedAt);
    assert.equal(Date.parse(token.expiresAt) - issuedAt.getTime(), PUBLISHED_PREAUTH_TTL_MS);
  });

  it('carries the token string through untouched and stamps expiresAt as ISO 8601', () => {
    const token = buildPreauthToken({ token: SYNTHETIC_TOKEN }, new Date(FIXTURE_INSTANT));
    assert.equal(token.token, SYNTHETIC_TOKEN);
    assert.equal(token.expiresAt, '2026-08-16T12:00:30.000Z');
  });

  it('honours an explicit ttlSeconds and keeps expiresAt consistent with it', () => {
    const issuedAt = new Date(FIXTURE_INSTANT);
    const token = buildPreauthToken({ token: SYNTHETIC_TOKEN, ttlSeconds: 45 }, issuedAt);
    assert.equal(token.ttlSeconds, 45);
    assert.equal(Date.parse(token.expiresAt) - issuedAt.getTime(), 45_000);
  });

  it('a zero TTL expires at the instant it was issued', () => {
    const issuedAt = new Date(FIXTURE_INSTANT);
    const token = buildPreauthToken({ token: SYNTHETIC_TOKEN, ttlSeconds: 0 }, issuedAt);
    assert.equal(Date.parse(token.expiresAt), issuedAt.getTime());
    assert.equal(isPreauthTokenExpired(token, issuedAt), true);
  });
});

describe('isPreauthTokenExpired — both boundaries, injected clock', () => {
  const issuedAt = new Date(FIXTURE_INSTANT);
  const token = buildPreauthToken({ token: SYNTHETIC_TOKEN }, issuedAt);
  const expiryMs = Date.parse(token.expiresAt);

  it('is false one millisecond before expiresAt and true at expiresAt', () => {
    // Both boundaries in one case, because the pair is the assertion: either one alone is
    // satisfied by a predicate that is wrong in the other direction.
    assert.equal(isPreauthTokenExpired(token, new Date(expiryMs - 1)), false);
    assert.equal(isPreauthTokenExpired(token, new Date(expiryMs)), true);
  });

  it('is false at the issuing instant and true a millisecond past expiry', () => {
    assert.equal(isPreauthTokenExpired(token, issuedAt), false);
    assert.equal(isPreauthTokenExpired(token, new Date(expiryMs + 1)), true);
  });

  it('reads an unparseable expiresAt as expired rather than as live forever', () => {
    const malformed: PreauthToken = {
      token: SYNTHETIC_TOKEN,
      expiresAt: 'not-a-timestamp',
      ttlSeconds: PUBLISHED_PREAUTH_TTL_SECONDS,
    };
    assert.equal(isPreauthTokenExpired(malformed, issuedAt), true);
  });
});

// ---------------------------------------------------------------------------------------------
// The caller-session port
// ---------------------------------------------------------------------------------------------

describe('createUnauthenticatedSessionReader', () => {
  it('identifies nobody, which is why this branch answers 401 instead of minting a token', async () => {
    const reader = createUnauthenticatedSessionReader();
    assert.equal(await reader.resolveClientId({ headers: new Headers() }), null);
  });
});

// ---------------------------------------------------------------------------------------------
// resolveMemberRefForRequest — the reasons, directly
// ---------------------------------------------------------------------------------------------

describe('resolveMemberRefForRequest', () => {
  const devEnv = testEnv({ NODE_ENV: 'development', CRS_DRIVER: 'mock' });

  it("resolves the caller's own handle when no parameter is supplied", async () => {
    const resolution = await resolveMemberRefForRequest({
      url: urlWith(),
      headers: new Headers(),
      env: devEnv,
      session: countingSessionReader(ENROLLED_CLIENT_ID).reader,
      resolver: enrolledResolver(),
    });
    assert.deepEqual(resolution, { ok: true, memberRef: ENROLLED_MEMBER_REF });
  });

  it('refuses a caller it cannot identify with unauthenticated', async () => {
    const resolution = await resolveMemberRefForRequest({
      url: urlWith(),
      headers: new Headers(),
      env: devEnv,
      session: createUnauthenticatedSessionReader(),
      resolver: enrolledResolver(),
    });
    assert.deepEqual(resolution, { ok: false, reason: 'unauthenticated' });
  });

  it('refuses a caller with no enrollment yet with not_enrolled', async () => {
    const resolution = await resolveMemberRefForRequest({
      url: urlWith(),
      headers: new Headers(),
      env: devEnv,
      session: countingSessionReader(UNENROLLED_CLIENT_ID).reader,
      resolver: enrolledResolver(),
    });
    assert.deepEqual(resolution, { ok: false, reason: 'not_enrolled' });
  });

  it('refuses a supplied parameter in production with forbidden_member_ref', async () => {
    const resolution = await resolveMemberRefForRequest({
      url: urlWith({ memberRef: MOCK_MEMBER_REF }),
      headers: new Headers(),
      env: testEnv({ NODE_ENV: 'production', CRS_DRIVER: 'mock' }),
      session: countingSessionReader(ENROLLED_CLIENT_ID).reader,
      resolver: enrolledResolver(),
    });
    assert.deepEqual(resolution, { ok: false, reason: 'forbidden_member_ref' });
  });

  it('never consults the session when a parameter is supplied and refused', async () => {
    const session = countingSessionReader(ENROLLED_CLIENT_ID);
    await resolveMemberRefForRequest({
      url: urlWith({ memberRef: UNPREFIXED_MEMBER_REF }),
      headers: new Headers(),
      env: devEnv,
      session: session.reader,
      resolver: enrolledResolver(),
    });
    assert.equal(session.callCount(), 0);
  });
});

// ---------------------------------------------------------------------------------------------
// handleMonitoringTokenRequest — every status
// ---------------------------------------------------------------------------------------------

interface HandlerCallOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly url?: URL;
  readonly clientId?: string | null;
  readonly adapter?: StubAdapter;
  readonly clock?: Clock;
  readonly resolver?: MemberRefResolver;
}

interface HandlerCallOutcome {
  readonly result: MonitoringTokenResult;
  readonly adapter: StubAdapter;
  readonly session: CountingSessionReader;
}

async function callHandler(options: HandlerCallOptions): Promise<HandlerCallOutcome> {
  const clock = options.clock ?? fixtureClock();
  const adapter = options.adapter ?? liveTokenAdapter(clock);
  const session = countingSessionReader(
    options.clientId === undefined ? ENROLLED_CLIENT_ID : options.clientId,
  );

  const result = await handleMonitoringTokenRequest({
    url: options.url ?? urlWith(),
    headers: new Headers(),
    env: options.env,
    adapter: adapter.adapter,
    session: session.reader,
    resolver: options.resolver ?? enrolledResolver(),
    clock,
  });

  return { result, adapter, session };
}

const FLAG_ON = { NODE_ENV: 'development', CRS_DRIVER: 'mock', FEATURE_ANALYSIS: 'true' } as const;

describe('handleMonitoringTokenRequest — the flag gate', () => {
  it('answers 404 with a null body when the flag is absent, and never touches the adapter', async () => {
    const { result, adapter, session } = await callHandler({
      env: testEnv({ NODE_ENV: 'development', CRS_DRIVER: 'mock' }),
    });
    assert.equal(result.status, 404);
    assert.equal(result.body, null);
    assert.equal(adapter.callCount(), 0);
    // The flag is decided before anything else runs, so a disabled route cannot reach an adapter
    // that throws at construction when credentials are absent (threat T-04-26).
    assert.equal(session.callCount(), 0);
  });

  it('keeps values outside the canonical truthy set off', async () => {
    for (const value of ['0', 'no', 'disabled', '', 'false']) {
      const { result, adapter } = await callHandler({
        env: testEnv({ NODE_ENV: 'development', CRS_DRIVER: 'mock', FEATURE_ANALYSIS: value }),
      });
      assert.equal(result.status, 404, `FEATURE_ANALYSIS=${JSON.stringify(value)} should be off`);
      assert.equal(adapter.callCount(), 0);
    }
  });
});

describe('handleMonitoringTokenRequest — who is asking', () => {
  it('answers 401 for a caller it cannot identify, and never touches the adapter', async () => {
    const { result, adapter } = await callHandler({ env: testEnv(FLAG_ON), clientId: null });
    assert.equal(result.status, 401);
    assert.equal(result.body, null);
    assert.equal(adapter.callCount(), 0);
  });

  it('answers 404 for a caller with no enrollment yet, and never touches the adapter', async () => {
    const { result, adapter } = await callHandler({
      env: testEnv(FLAG_ON),
      clientId: UNENROLLED_CLIENT_ID,
    });
    assert.equal(result.status, 404);
    assert.equal(result.body, null);
    assert.equal(adapter.callCount(), 0);
  });

  it('answers 403 after monitoring withdrawal and never touches the adapter', async () => {
    const resolver: MemberRefResolver = {
      async resolveForClient() { throw new MonitoringInactiveError(); },
      async resolveClientForMember() { return null; },
    };
    const { result, adapter } = await callHandler({ env: testEnv(FLAG_ON), resolver });
    assert.equal(result.status, 403);
    assert.equal(result.body, null);
    assert.equal(adapter.callCount(), 0);
  });
});

describe('handleMonitoringTokenRequest — the 200', () => {
  it("answers 200 with exactly token, expiresAt and ttlSeconds, off the caller's own handle", async () => {
    const clock = fixtureClock();
    const { result, adapter } = await callHandler({ env: testEnv(FLAG_ON), clock });

    assert.equal(result.status, 200);
    assert.deepEqual(bodyKeys(result.body), ['expiresAt', 'token', 'ttlSeconds']);
    assert.deepEqual(result.body, {
      token: SYNTHETIC_TOKEN,
      expiresAt: '2026-08-16T12:00:30.000Z',
      ttlSeconds: PUBLISHED_PREAUTH_TTL_SECONDS,
    });
    assert.equal(adapter.lastMemberRef(), ENROLLED_MEMBER_REF);
  });

  it('names no consumer identifier and no driver in the body', async () => {
    const { result } = await callHandler({ env: testEnv(FLAG_ON) });
    const serialized = JSON.stringify(result.body);

    for (const secret of [ENROLLED_MEMBER_REF, ENROLLED_CLIENT_ID, 'mock', 'sandbox', 'memberRef', 'clientId']) {
      assert.ok(!serialized.includes(secret), `the 200 body must not contain ${secret}`);
    }
  });

  it('answers 200 for a token that is still live by one millisecond', async () => {
    const clock = fixtureClock();
    const oneMillisecondLeft = new Date(clock.now().getTime() + 1).toISOString();
    const adapter = stubAdapter(() =>
      Promise.resolve({ token: SYNTHETIC_TOKEN, expiresAt: oneMillisecondLeft, ttlSeconds: 1 }),
    );

    const { result } = await callHandler({ env: testEnv(FLAG_ON), adapter, clock });
    assert.equal(result.status, 200);
  });
});

// ---------------------------------------------------------------------------------------------
// The development affordance — all eight combinations of the three conditions
// ---------------------------------------------------------------------------------------------

interface AffordanceCase {
  readonly nodeEnvIsProduction: boolean;
  readonly driverIsMock: boolean;
  readonly refCarriesMockPrefix: boolean;
  readonly expectedStatus: number;
}

/**
 * The full truth table, written out rather than generated, so every expectation is a decision
 * somebody made instead of the same condition the implementation uses evaluated twice.
 *
 * Exactly one row is a 200 and it is the row where all three conditions hold. The production row
 * with the mock driver and a correctly prefixed handle is written explicitly, because it is the
 * one somebody would reach for when the affordance "should obviously be fine here".
 */
const AFFORDANCE_MATRIX: readonly AffordanceCase[] = [
  { nodeEnvIsProduction: false, driverIsMock: true, refCarriesMockPrefix: true, expectedStatus: 200 },
  { nodeEnvIsProduction: false, driverIsMock: true, refCarriesMockPrefix: false, expectedStatus: 403 },
  { nodeEnvIsProduction: false, driverIsMock: false, refCarriesMockPrefix: true, expectedStatus: 403 },
  { nodeEnvIsProduction: false, driverIsMock: false, refCarriesMockPrefix: false, expectedStatus: 403 },
  { nodeEnvIsProduction: true, driverIsMock: true, refCarriesMockPrefix: true, expectedStatus: 403 },
  { nodeEnvIsProduction: true, driverIsMock: true, refCarriesMockPrefix: false, expectedStatus: 403 },
  { nodeEnvIsProduction: true, driverIsMock: false, refCarriesMockPrefix: true, expectedStatus: 403 },
  { nodeEnvIsProduction: true, driverIsMock: false, refCarriesMockPrefix: false, expectedStatus: 403 },
];

function describeCase(entry: AffordanceCase): string {
  const environment = entry.nodeEnvIsProduction ? 'production' : 'development';
  const driver = entry.driverIsMock ? 'the mock driver' : 'the sandbox driver';
  const prefix = entry.refCarriesMockPrefix ? 'a mock_ handle' : 'an unprefixed handle';
  return `${environment} + ${driver} + ${prefix} answers ${entry.expectedStatus}`;
}

describe('the ?memberRef= development affordance needs all three conditions', () => {
  it('covers all eight combinations of the three conditions, each exactly once', () => {
    assert.equal(AFFORDANCE_MATRIX.length, 8);
    const seen = new Set(
      AFFORDANCE_MATRIX.map(
        (entry) =>
          `${entry.nodeEnvIsProduction}|${entry.driverIsMock}|${entry.refCarriesMockPrefix}`,
      ),
    );
    assert.equal(seen.size, 8);
    assert.equal(AFFORDANCE_MATRIX.filter((entry) => entry.expectedStatus === 200).length, 1);
  });

  for (const entry of AFFORDANCE_MATRIX) {
    it(describeCase(entry), async () => {
      const suppliedRef = entry.refCarriesMockPrefix ? MOCK_MEMBER_REF : UNPREFIXED_MEMBER_REF;
      const { result, adapter } = await callHandler({
        env: testEnv({
          NODE_ENV: entry.nodeEnvIsProduction ? 'production' : 'development',
          CRS_DRIVER: entry.driverIsMock ? 'mock' : 'sandbox',
          FEATURE_ANALYSIS: 'true',
        }),
        url: urlWith({ memberRef: suppliedRef }),
      });

      assert.equal(result.status, entry.expectedStatus);

      if (entry.expectedStatus === 200) {
        // The supplied handle is the one used, not the caller's own — otherwise a passing 200 here
        // would prove nothing about the affordance.
        assert.equal(adapter.lastMemberRef(), MOCK_MEMBER_REF);
      } else {
        // The caller IS enrolled in every row, so a refused parameter that silently fell through
        // to their own handle would answer 200 and this assertion is what catches it.
        assert.equal(result.body, null);
        assert.equal(adapter.callCount(), 0);
      }
    });
  }

  it("refuses another consumer's plausible handle in development with the mock driver", async () => {
    const { result, adapter } = await callHandler({
      env: testEnv(FLAG_ON),
      url: urlWith({ memberRef: UNPREFIXED_MEMBER_REF }),
    });
    assert.equal(result.status, 403);
    assert.equal(adapter.callCount(), 0);
  });

  it('refuses an empty parameter rather than ignoring it', async () => {
    const { result } = await callHandler({
      env: testEnv(FLAG_ON),
      url: urlWith({ memberRef: '' }),
    });
    assert.equal(result.status, 403);
  });

  it('refuses when CRS_DRIVER names a driver we do not implement, instead of failing loudly here', async () => {
    const { result, adapter } = await callHandler({
      env: testEnv({
        NODE_ENV: 'development',
        CRS_DRIVER: 'not-a-driver-we-implement',
        FEATURE_ANALYSIS: 'true',
      }),
      url: urlWith({ memberRef: MOCK_MEMBER_REF }),
    });
    assert.equal(result.status, 403);
    assert.equal(adapter.callCount(), 0);
  });
});

// ---------------------------------------------------------------------------------------------
// The 502 — nothing the provider said reaches the caller
// ---------------------------------------------------------------------------------------------

/**
 * Every word of four characters or more in a thrown message must be absent from the reply. Four is
 * the floor because shorter fragments collide with ordinary JSON punctuation and field names by
 * chance, which would make the assertion noisy rather than strict.
 */
function assertNothingLeaked(body: unknown, thrownMessage: string): void {
  const serialized = JSON.stringify(body);
  for (const word of thrownMessage.split(/\s+/)) {
    if (word.length < 4) continue;
    assert.ok(!serialized.includes(word), `the reply leaked "${word}" from the thrown message`);
  }
}

describe('handleMonitoringTokenRequest — the 502', () => {
  const CANARY_MESSAGE =
    'PROVIDER-DETAIL-CANARY-9f42 upstream refused account 12345 holding handle mock_clean_1';

  it('answers 502 with a fixed body when the adapter throws, and echoes nothing it was told', async () => {
    const adapter = stubAdapter(() => Promise.reject(new Error(CANARY_MESSAGE)));
    const { result } = await callHandler({ env: testEnv(FLAG_ON), adapter });

    assert.equal(result.status, 502);
    assert.deepEqual(result.body, { error: 'crs_unavailable' });
    assertNothingLeaked(result.body, CANARY_MESSAGE);
  });

  it('answers the same 502 for a CrsDriverError, since there is no catalogue to map', async () => {
    const driverError = new CrsDriverError('mock', 'getPreauthToken', 503);
    const adapter = stubAdapter(() => Promise.reject(driverError));
    const { result } = await callHandler({ env: testEnv(FLAG_ON), adapter });

    assert.equal(result.status, 502);
    // Deep equality against the fixed body is the strongest form of "shares nothing with the
    // failure": the reply is one key and one constant string, decided before the call was made.
    assert.deepEqual(result.body, { error: 'crs_unavailable' });
    assert.ok(!JSON.stringify(result.body).includes('503'));
    assert.ok(!JSON.stringify(result.body).includes('getPreauthToken'));
  });

  it('answers 502 for a thrown value that is not an Error at all', async () => {
    const adapter = stubAdapter(() => Promise.reject(CANARY_MESSAGE));
    const { result } = await callHandler({ env: testEnv(FLAG_ON), adapter });

    assert.equal(result.status, 502);
    assertNothingLeaked(result.body, CANARY_MESSAGE);
  });

  it('answers 502 rather than 200 when the adapter hands back an already-expired token', async () => {
    const clock = fixtureClock();
    const expiredAt = new Date(clock.now().getTime() - 1).toISOString();
    const adapter = stubAdapter(() =>
      Promise.resolve({
        token: SYNTHETIC_TOKEN,
        expiresAt: expiredAt,
        ttlSeconds: PUBLISHED_PREAUTH_TTL_SECONDS,
      }),
    );

    const { result } = await callHandler({ env: testEnv(FLAG_ON), adapter, clock });
    assert.equal(result.status, 502);
    assert.deepEqual(result.body, { error: 'crs_unavailable' });
  });

  it('answers 502 for a token that expires at exactly the current instant', async () => {
    const clock = fixtureClock();
    const adapter = stubAdapter(() =>
      Promise.resolve({
        token: SYNTHETIC_TOKEN,
        expiresAt: clock.now().toISOString(),
        ttlSeconds: PUBLISHED_PREAUTH_TTL_SECONDS,
      }),
    );

    const { result } = await callHandler({ env: testEnv(FLAG_ON), adapter, clock });
    assert.equal(result.status, 502);
  });
});
