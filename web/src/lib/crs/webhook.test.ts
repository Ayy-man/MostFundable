// web/src/lib/crs/webhook.test.ts — CRS-05 (a) in full, and the timestamp half of CRS-05 (b).
//
// Every fixture here is a `Headers` object and a plain string. Nothing imports a route handler,
// nothing starts a server and nothing reaches the network, because the module under test is the
// half of the receiver that has no business doing any of those things — which is the reason plan
// 04-03 exists as its own module rather than as logic inside `route.ts`.
//
// Every credential in this file is an obviously-fake literal that says so in its own value. A
// fifteen-character string that could pass for a real endpoint password would be a repo-credential
// defect in a test exactly as much as in source, and the 15-character cap CRS publishes makes a
// realistic-looking fake unusually easy to write by accident.
//
// The addresses are RFC 5737 documentation ranges (TEST-NET-2 and TEST-NET-3), which are reserved
// precisely so that an example cannot name somebody's real host.

import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CRS_WEBHOOK_EVENT_TYPES } from './constants.ts';
import { CRS_SPEC_WEBHOOK_BASIC_CREDENTIAL_MAX_LENGTH } from './spec-catalog.ts';
import {
  epochMillisecondsToIso,
  parseWebhookBatch,
  parseWebhookBatchEntries,
  readWebhookConfigFromEnv,
  verifyAndParseWebhookImpl,
  verifyWebhookRequest,
} from './webhook.ts';
import type {
  CrsWebhookConfig,
  CrsWebhookRequest,
  CrsWebhookVerification,
} from './webhook.ts';
import type { CrsWebhookEvent, CrsWebhookParse } from './types.ts';

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

const FAKE_BASIC_USER = 'not-a-real-user';
const FAKE_BASIC_PASS = 'not-a-real-pass';
const FAKE_HMAC_SECRET = 'not-a-real-secret';

/** RFC 5737 TEST-NET-3 — reserved for documentation, so it can never be a real host. */
const ALLOWED_ADDRESS = '203.0.113.10';
/** RFC 5737 TEST-NET-2, likewise reserved. */
const BLOCKED_ADDRESS = '198.51.100.7';

/**
 * Sits in every alert-content field of every fixture event. It is long and obviously synthetic, so
 * a field that survives the parse shows up as this exact string inside a failure rather than as a
 * vague shape mismatch.
 */
const ALERT_CONTENT_CANARY = 'ALERT-CONTENT-CANARY-4c81';
const ALERT_ID = '550e8400-e29b-41d4-a716-446655440003';

const VALID_EPOCH_MILLISECONDS = 1755302400000;
const VALID_ISO = '2025-08-16T00:00:00.000Z';

function basicAuthHeader(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`;
}

const VALID_AUTH_HEADER = basicAuthHeader(FAKE_BASIC_USER, FAKE_BASIC_PASS);

/** The suite computes its own digest rather than reading one out of the module under test. */
function signatureFor(rawBody: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

/** Basic auth configured and both optional controls off — the account we actually have today. */
function config(overrides: Partial<CrsWebhookConfig> = {}): CrsWebhookConfig {
  return {
    basicUser: FAKE_BASIC_USER,
    basicPass: FAKE_BASIC_PASS,
    hmacSecret: null,
    hmacHeader: 'x-crs-signature',
    sourceIps: [],
    ...overrides,
  };
}

/** One element of the array CRS posts, alert fields included so their absence can be proven. */
function crsEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'not-a-real-hook-id-1',
    type: 'ACCALERT',
    user_id: 'not-a-real-member-1',
    host_id: 'not-a-real-host',
    time: VALID_EPOCH_MILLISECONDS,
    error_code: null,
    error_msg: ALERT_CONTENT_CANARY,
    alert_id: ALERT_ID,
    alert_date: VALID_EPOCH_MILLISECONDS - 60_000,
    alert_source: ALERT_CONTENT_CANARY,
    ...overrides,
  };
}

function request(overrides: Partial<CrsWebhookRequest> = {}): CrsWebhookRequest {
  return {
    headers: new Headers({ authorization: VALID_AUTH_HEADER }),
    rawBody: JSON.stringify([crsEvent()]),
    config: config(),
    ...overrides,
  };
}

/**
 * Next augments `NodeJS.ProcessEnv` with a REQUIRED `readonly NODE_ENV`, so a bare literal env is
 * `error TS2741` even though nothing under test reads it. Same helper as `driver.test.ts`, and for
 * the same reason: it types the literal without adding a key, so the empty case is really empty.
 */
function testEnv(values: Readonly<Record<string, string | undefined>>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

/** Asserts the verification failed and hands back its reason for an exact-string comparison. */
function verificationReason(result: CrsWebhookVerification): string {
  assert.ok(!result.ok, 'expected the request to be rejected');
  return result.reason;
}

/**
 * Asserts the parse failed, asserts it carries NO `event` property, and hands back the reason.
 *
 * The `'event' in parse` half is the load-bearing one: a caller that destructures the result must
 * not be able to reach a half-built envelope on a request that was refused.
 */
function rejectionReason(parse: CrsWebhookParse): string {
  assert.ok(!parse.ok, 'expected the parse to be a rejection');
  assert.ok(!('event' in parse), 'a rejection must not carry an event');
  return parse.reason;
}

function acceptedEvent(parse: CrsWebhookParse): CrsWebhookEvent {
  assert.ok(parse.ok, 'expected the parse to succeed');
  return parse.event;
}

/** Parse one request and return the single entry it must have produced. */
function onlyEntry(input: CrsWebhookRequest) {
  const entries = parseWebhookBatchEntries(input);
  assert.equal(entries.length, 1, 'expected exactly one entry');
  return entries[0];
}

// ---------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------

describe('readWebhookConfigFromEnv', () => {
  it('reads an empty environment as three unconfigured controls and the default header', () => {
    const resolved = readWebhookConfigFromEnv(testEnv({}));

    assert.equal(resolved.basicUser, null);
    assert.equal(resolved.basicPass, null);
    assert.equal(resolved.hmacSecret, null);
    assert.deepEqual(resolved.sourceIps, []);
    assert.equal(resolved.hmacHeader, 'x-crs-signature');
  });

  it('reads every key it is given', () => {
    const resolved = readWebhookConfigFromEnv(
      testEnv({
        CRS_WEBHOOK_BASIC_USER: FAKE_BASIC_USER,
        CRS_WEBHOOK_BASIC_PASS: FAKE_BASIC_PASS,
        CRS_WEBHOOK_HMAC_SECRET: FAKE_HMAC_SECRET,
        CRS_WEBHOOK_HMAC_HEADER: 'x-not-a-real-header',
        CRS_WEBHOOK_SOURCE_IPS: ALLOWED_ADDRESS,
      }),
    );

    assert.deepEqual(resolved, {
      basicUser: FAKE_BASIC_USER,
      basicPass: FAKE_BASIC_PASS,
      hmacSecret: FAKE_HMAC_SECRET,
      hmacHeader: 'x-not-a-real-header',
      sourceIps: [ALLOWED_ADDRESS],
    });
  });

  it('splits the source-IP list on commas, trims each entry and drops the blanks', () => {
    const resolved = readWebhookConfigFromEnv(
      testEnv({ CRS_WEBHOOK_SOURCE_IPS: ` ${ALLOWED_ADDRESS} , ,${BLOCKED_ADDRESS}, ` }),
    );

    assert.deepEqual(resolved.sourceIps, [ALLOWED_ADDRESS, BLOCKED_ADDRESS]);
  });

  it('treats a blank value as an unconfigured control, not as an empty credential', () => {
    const resolved = readWebhookConfigFromEnv(
      testEnv({
        CRS_WEBHOOK_BASIC_USER: '   ',
        CRS_WEBHOOK_BASIC_PASS: '',
        CRS_WEBHOOK_HMAC_SECRET: '\t',
        CRS_WEBHOOK_HMAC_HEADER: '  ',
      }),
    );

    assert.equal(resolved.basicUser, null);
    assert.equal(resolved.basicPass, null);
    assert.equal(resolved.hmacSecret, null);
    assert.equal(resolved.hmacHeader, 'x-crs-signature');
  });

  it('accepts the catalogued Basic credential boundary and fails closed above it', () => {
    const atBoundary = 'x'.repeat(CRS_SPEC_WEBHOOK_BASIC_CREDENTIAL_MAX_LENGTH);
    const aboveBoundary = `${atBoundary}x`;
    const accepted = readWebhookConfigFromEnv(testEnv({
      CRS_WEBHOOK_BASIC_USER: atBoundary,
      CRS_WEBHOOK_BASIC_PASS: atBoundary,
    }));

    assert.equal(accepted.basicUser, atBoundary);
    assert.equal(accepted.basicPass, atBoundary);
    const rejected = readWebhookConfigFromEnv(testEnv({
      CRS_WEBHOOK_BASIC_USER: aboveBoundary,
      CRS_WEBHOOK_BASIC_PASS: aboveBoundary,
    }));
    assert.equal(rejected.basicUser, null);
    assert.equal(rejected.basicPass, null);
  });

  it('fails closed on a username the Basic wire format cannot represent', () => {
    assert.equal(
      readWebhookConfigFromEnv(testEnv({ CRS_WEBHOOK_BASIC_USER: 'user:name' })).basicUser,
      null,
    );
  });

  it('throws on nothing, whatever it is handed', () => {
    assert.doesNotThrow(() => readWebhookConfigFromEnv(testEnv({})));
    assert.doesNotThrow(() => readWebhookConfigFromEnv(testEnv({ CRS_WEBHOOK_SOURCE_IPS: ',,,' })));
    assert.doesNotThrow(() =>
      readWebhookConfigFromEnv(testEnv({ CRS_WEBHOOK_BASIC_USER: FAKE_BASIC_USER })),
    );
  });
});

// ---------------------------------------------------------------------------------------------
// bad_auth
// ---------------------------------------------------------------------------------------------

describe('verifyWebhookRequest — bad_auth', () => {
  it('rejects an absent authorization header', () => {
    const result = verifyWebhookRequest(request({ headers: new Headers() }));
    assert.equal(verificationReason(result), 'bad_auth');
  });

  it('rejects a non-Basic scheme', () => {
    const headers = new Headers({ authorization: 'Bearer not-a-real-token' });
    assert.equal(verificationReason(verifyWebhookRequest(request({ headers }))), 'bad_auth');
  });

  it('rejects a Basic header whose credential does not decode to a user:pass pair', () => {
    const headers = new Headers({
      authorization: `Basic ${Buffer.from('no-colon-here', 'utf8').toString('base64')}`,
    });
    assert.equal(verificationReason(verifyWebhookRequest(request({ headers }))), 'bad_auth');
  });

  it('rejects a Basic header with no credential at all', () => {
    const headers = new Headers({ authorization: 'Basic' });
    assert.equal(verificationReason(verifyWebhookRequest(request({ headers }))), 'bad_auth');
  });

  it('rejects the wrong password', () => {
    const headers = new Headers({
      authorization: basicAuthHeader(FAKE_BASIC_USER, 'not-a-real-wrong-pass'),
    });
    assert.equal(verificationReason(verifyWebhookRequest(request({ headers }))), 'bad_auth');
  });

  it('rejects the wrong user', () => {
    const headers = new Headers({
      authorization: basicAuthHeader('not-a-real-other-user', FAKE_BASIC_PASS),
    });
    assert.equal(verificationReason(verifyWebhookRequest(request({ headers }))), 'bad_auth');
  });

  it('FAILS CLOSED when no basic user is configured, however good the header looks', () => {
    const result = verifyWebhookRequest(request({ config: config({ basicUser: null }) }));
    assert.equal(verificationReason(result), 'bad_auth');
  });

  it('FAILS CLOSED when no basic password is configured', () => {
    const result = verifyWebhookRequest(request({ config: config({ basicPass: null }) }));
    assert.equal(verificationReason(result), 'bad_auth');
  });

  it('FAILS CLOSED on a wholly unconfigured endpoint rather than admitting everyone', () => {
    const unconfigured = config({ basicUser: null, basicPass: null });
    assert.equal(
      verificationReason(verifyWebhookRequest(request({ config: unconfigured }))),
      'bad_auth',
    );
    assert.equal(
      verificationReason(
        verifyWebhookRequest(request({ headers: new Headers(), config: unconfigured })),
      ),
      'bad_auth',
    );
  });

  it('accepts a lowercase scheme, because RFC 7235 says the scheme is case-insensitive', () => {
    const headers = new Headers({ authorization: VALID_AUTH_HEADER.replace('Basic', 'basic') });
    assert.deepEqual(verifyWebhookRequest(request({ headers })), { ok: true });
  });

  it('splits on the first colon only, so a colon inside the password still matches', () => {
    const passWithColon = 'not-a-real:pass';
    const headers = new Headers({ authorization: basicAuthHeader(FAKE_BASIC_USER, passWithColon) });
    const result = verifyWebhookRequest(
      request({ headers, config: config({ basicPass: passWithColon }) }),
    );

    assert.deepEqual(result, { ok: true });
  });
});

// ---------------------------------------------------------------------------------------------
// bad_signature
// ---------------------------------------------------------------------------------------------

describe('verifyWebhookRequest — bad_signature', () => {
  const rawBody = JSON.stringify([crsEvent()]);
  const signed = config({ hmacSecret: FAKE_HMAC_SECRET });

  it('rejects a configured HMAC with no signature header', () => {
    const result = verifyWebhookRequest(request({ rawBody, config: signed }));
    assert.equal(verificationReason(result), 'bad_signature');
  });

  it('rejects a signature that does not match the body', () => {
    const headers = new Headers({
      authorization: VALID_AUTH_HEADER,
      'x-crs-signature': signatureFor('[]', FAKE_HMAC_SECRET),
    });
    const result = verifyWebhookRequest(request({ headers, rawBody, config: signed }));

    assert.equal(verificationReason(result), 'bad_signature');
  });

  it('rejects a signature computed with a different secret', () => {
    const headers = new Headers({
      authorization: VALID_AUTH_HEADER,
      'x-crs-signature': signatureFor(rawBody, 'not-a-real-other-secret'),
    });
    const result = verifyWebhookRequest(request({ headers, rawBody, config: signed }));

    assert.equal(verificationReason(result), 'bad_signature');
  });

  it('accepts the digest of the exact raw body', () => {
    const headers = new Headers({
      authorization: VALID_AUTH_HEADER,
      'x-crs-signature': signatureFor(rawBody, FAKE_HMAC_SECRET),
    });

    assert.deepEqual(verifyWebhookRequest(request({ headers, rawBody, config: signed })), {
      ok: true,
    });
  });

  it('accepts an optional sha256= prefix and an uppercase digest', () => {
    const digest = signatureFor(rawBody, FAKE_HMAC_SECRET);

    for (const presented of [`sha256=${digest}`, digest.toUpperCase()]) {
      const headers = new Headers({
        authorization: VALID_AUTH_HEADER,
        'x-crs-signature': presented,
      });
      assert.deepEqual(verifyWebhookRequest(request({ headers, rawBody, config: signed })), {
        ok: true,
      });
    }
  });

  it('reads the digest from whichever header name is configured', () => {
    const named = config({ hmacSecret: FAKE_HMAC_SECRET, hmacHeader: 'x-not-a-real-header' });
    const headers = new Headers({
      authorization: VALID_AUTH_HEADER,
      'x-not-a-real-header': signatureFor(rawBody, FAKE_HMAC_SECRET),
    });

    assert.deepEqual(verifyWebhookRequest(request({ headers, rawBody, config: named })), {
      ok: true,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// source_ip
// ---------------------------------------------------------------------------------------------

describe('verifyWebhookRequest — source_ip', () => {
  const allowlisted = config({ sourceIps: [ALLOWED_ADDRESS] });

  it('rejects a forwarded address outside the allowlist', () => {
    const headers = new Headers({
      authorization: VALID_AUTH_HEADER,
      'x-forwarded-for': `${BLOCKED_ADDRESS}, ${ALLOWED_ADDRESS}`,
    });
    const result = verifyWebhookRequest(request({ headers, config: allowlisted }));

    assert.equal(verificationReason(result), 'source_ip');
  });

  it('accepts the first forwarded entry when it is on the allowlist', () => {
    const headers = new Headers({
      authorization: VALID_AUTH_HEADER,
      'x-forwarded-for': `${ALLOWED_ADDRESS}, ${BLOCKED_ADDRESS}`,
    });

    assert.deepEqual(verifyWebhookRequest(request({ headers, config: allowlisted })), { ok: true });
  });

  it('prefers a runtime-supplied address over the forwarded header', () => {
    const headers = new Headers({
      authorization: VALID_AUTH_HEADER,
      'x-forwarded-for': ALLOWED_ADDRESS,
    });
    const result = verifyWebhookRequest(
      request({ headers, remoteAddress: BLOCKED_ADDRESS, config: allowlisted }),
    );

    assert.equal(verificationReason(result), 'source_ip');
  });

  it('accepts a runtime-supplied address on the allowlist with no forwarded header at all', () => {
    const result = verifyWebhookRequest(
      request({ remoteAddress: ALLOWED_ADDRESS, config: allowlisted }),
    );

    assert.deepEqual(result, { ok: true });
  });

  it('rejects when no address can be resolved, rather than skipping the check', () => {
    const result = verifyWebhookRequest(request({ remoteAddress: null, config: allowlisted }));
    assert.equal(verificationReason(result), 'source_ip');
  });

  it('skips the check entirely when no allowlist is configured', () => {
    const result = verifyWebhookRequest(request({ remoteAddress: BLOCKED_ADDRESS }));
    assert.deepEqual(result, { ok: true });
  });
});

// ---------------------------------------------------------------------------------------------
// Check order, and the optional controls being genuinely optional
// ---------------------------------------------------------------------------------------------

describe('verifyWebhookRequest — check order', () => {
  it('reports source_ip for a request that is both off-allowlist and badly credentialed', () => {
    const headers = new Headers({
      authorization: basicAuthHeader('not-a-real-other-user', 'not-a-real-wrong-pass'),
      'x-forwarded-for': BLOCKED_ADDRESS,
    });
    const result = verifyWebhookRequest(
      request({ headers, config: config({ sourceIps: [ALLOWED_ADDRESS] }) }),
    );

    assert.equal(verificationReason(result), 'source_ip');
  });

  it('reports bad_signature for good credentials with a bad signature', () => {
    const rawBody = JSON.stringify([crsEvent()]);
    const headers = new Headers({
      authorization: VALID_AUTH_HEADER,
      'x-crs-signature': signatureFor('[]', FAKE_HMAC_SECRET),
    });
    const result = verifyWebhookRequest(
      request({ headers, rawBody, config: config({ hmacSecret: FAKE_HMAC_SECRET }) }),
    );

    assert.equal(verificationReason(result), 'bad_signature');
  });

  it('reports bad_auth when the credentials and the signature are both wrong', () => {
    const rawBody = JSON.stringify([crsEvent()]);
    const headers = new Headers({
      authorization: basicAuthHeader(FAKE_BASIC_USER, 'not-a-real-wrong-pass'),
      'x-crs-signature': signatureFor('[]', FAKE_HMAC_SECRET),
    });
    const result = verifyWebhookRequest(
      request({ headers, rawBody, config: config({ hmacSecret: FAKE_HMAC_SECRET }) }),
    );

    assert.equal(verificationReason(result), 'bad_auth');
  });

  it('accepts correct credentials alone when neither optional control is configured', () => {
    // The account we have today: Basic auth is all CRS publishes, so a request carrying no
    // signature header and arriving from an unknown address is a NORMAL request, not a forged one.
    assert.deepEqual(verifyWebhookRequest(request()), { ok: true });
  });
});

// ---------------------------------------------------------------------------------------------
// No rejection path yields an event
// ---------------------------------------------------------------------------------------------

describe('CRS-05 (a) — every rejection reason, and none of them carrying an event', () => {
  const rejections: ReadonlyArray<{ reason: string; input: CrsWebhookRequest }> = [
    { reason: 'bad_auth', input: request({ headers: new Headers() }) },
    {
      reason: 'bad_signature',
      input: request({ config: config({ hmacSecret: FAKE_HMAC_SECRET }) }),
    },
    {
      reason: 'source_ip',
      input: request({
        remoteAddress: BLOCKED_ADDRESS,
        config: config({ sourceIps: [ALLOWED_ADDRESS] }),
      }),
    },
    { reason: 'bad_shape', input: request({ rawBody: 'this is not JSON at all' }) },
  ];

  for (const { reason, input } of rejections) {
    it(`produces ${reason} and no event`, () => {
      const entry = onlyEntry(input);

      assert.equal(rejectionReason(entry.parse), reason);
      assert.equal(entry.hookId, null);
      assert.equal(rejectionReason(verifyAndParseWebhookImpl(input)), reason);
      assert.equal(parseWebhookBatch(input).length, 1);
    });
  }
});

// ---------------------------------------------------------------------------------------------
// Epoch milliseconds
// ---------------------------------------------------------------------------------------------

describe('epochMillisecondsToIso — CRS-05 (b), the conversion that must refuse', () => {
  it('converts a valid epoch-milliseconds integer to an ISO instant', () => {
    const converted = epochMillisecondsToIso(VALID_EPOCH_MILLISECONDS);

    assert.equal(converted, VALID_ISO);
    assert.ok(converted !== null && converted.endsWith('Z'));
  });

  const rejected: ReadonlyArray<{ name: string; value: unknown }> = [
    { name: 'NaN', value: Number.NaN },
    { name: 'Infinity', value: Number.POSITIVE_INFINITY },
    { name: '-Infinity', value: Number.NEGATIVE_INFINITY },
    { name: 'a numeric string', value: '1755302400000' },
    { name: 'a small fraction', value: 1.5 },
    { name: 'an in-range fraction', value: 1755302400000.5 },
    { name: 'zero', value: 0 },
    { name: 'a negative instant', value: -1 },
    { name: 'a seconds value', value: 1755302400 },
    { name: 'a year-3000-plus value', value: 32503680000000 },
    { name: 'null', value: null },
    { name: 'undefined', value: undefined },
    { name: 'an object', value: {} },
  ];

  for (const { name, value } of rejected) {
    it(`returns null for ${name} rather than an Invalid Date`, () => {
      const converted = epochMillisecondsToIso(value);

      assert.equal(converted, null);
      // Belt and braces: whatever it returns, it is never the string an unguarded
      // `new Date(...).toISOString()` path would have thrown or produced.
      assert.notEqual(converted, 'Invalid Date');
    });
  }

  it('accepts both range boundaries and refuses the values just outside them', () => {
    assert.equal(epochMillisecondsToIso(946684800000), '2000-01-01T00:00:00.000Z');
    assert.equal(epochMillisecondsToIso(4102444800000), '2100-01-01T00:00:00.000Z');
    assert.equal(epochMillisecondsToIso(946684799999), null);
    assert.equal(epochMillisecondsToIso(4102444800001), null);
  });
});

// ---------------------------------------------------------------------------------------------
// bad_shape
// ---------------------------------------------------------------------------------------------

describe('parseWebhookBatchEntries — bad_shape', () => {
  const malformedBodies: ReadonlyArray<{ name: string; rawBody: string }> = [
    { name: 'a body that is not JSON', rawBody: 'this is not JSON at all' },
    { name: 'an empty body', rawBody: '' },
    { name: 'a JSON object instead of an array', rawBody: JSON.stringify(crsEvent()) },
    { name: 'a JSON string instead of an array', rawBody: '"ACCALERT"' },
    { name: 'an empty array', rawBody: '[]' },
  ];

  for (const { name, rawBody } of malformedBodies) {
    it(`rejects ${name} as a single bad_shape entry with no hook id`, () => {
      const entry = onlyEntry(request({ rawBody }));

      assert.equal(rejectionReason(entry.parse), 'bad_shape');
      assert.equal(entry.hookId, null);
    });
  }

  const malformedEvents: ReadonlyArray<{ name: string; element: unknown }> = [
    { name: 'an element that is a string', element: 'ACCALERT' },
    { name: 'an element that is null', element: null },
    { name: 'an element that is an array', element: [] },
    { name: 'a missing type', element: crsEvent({ type: undefined }) },
    { name: 'a blank type', element: crsEvent({ type: '   ' }) },
    { name: 'a non-string type', element: crsEvent({ type: 7 }) },
    { name: 'a type longer than 64 characters', element: crsEvent({ type: 'A'.repeat(65) }) },
    { name: 'a missing user_id', element: crsEvent({ user_id: undefined }) },
    { name: 'a blank user_id', element: crsEvent({ user_id: '' }) },
    { name: 'a missing time', element: crsEvent({ time: undefined }) },
    { name: 'a stringified time', element: crsEvent({ time: '1755302400000' }) },
    { name: 'an out-of-range time', element: crsEvent({ time: 4102444800001 }) },
  ];

  for (const { name, element } of malformedEvents) {
    it(`rejects ${name}`, () => {
      const entry = onlyEntry(request({ rawBody: JSON.stringify([element]) }));
      assert.equal(rejectionReason(entry.parse), 'bad_shape');
    });
  }

  it('accepts a type of exactly 64 characters, the boundary the bound allows', () => {
    const entry = onlyEntry(request({ rawBody: JSON.stringify([crsEvent({ type: 'A'.repeat(64) })]) }));
    assert.equal(acceptedEvent(entry.parse).eventType.length, 64);
  });

  it('rejects an event with no id because the required acknowledgement cannot name it', () => {
    const entry = onlyEntry(request({ rawBody: JSON.stringify([crsEvent({ id: undefined })]) }));

    assert.equal(entry.hookId, null);
    assert.equal(rejectionReason(entry.parse), 'bad_shape');
  });

  it('accepts an explicit null user_id for a host-level event', () => {
    const entry = onlyEntry(request({ rawBody: JSON.stringify([crsEvent({ user_id: null })]) }));
    assert.equal(acceptedEvent(entry.parse).memberRef, null);
  });

  it('keeps the hook id on a rejected element, so the ACK can name the event that failed', () => {
    const element = crsEvent({ id: 'not-a-real-hook-id-9', time: 'not-a-number' });
    const entry = onlyEntry(request({ rawBody: JSON.stringify([element]) }));

    assert.equal(rejectionReason(entry.parse), 'bad_shape');
    assert.equal(entry.hookId, 'not-a-real-hook-id-9');
  });
});

// ---------------------------------------------------------------------------------------------
// Batch behaviour
// ---------------------------------------------------------------------------------------------

describe('parseWebhookBatchEntries — the array CRS actually posts', () => {
  it('yields one entry per element, in the order they arrived', () => {
    const rawBody = JSON.stringify([
      crsEvent({ id: 'not-a-real-hook-id-1', type: 'ACCNEW' }),
      crsEvent({ id: 'not-a-real-hook-id-2', type: 'ACCALERT' }),
      crsEvent({ id: 'not-a-real-hook-id-3', type: 'SCOREREF' }),
    ]);
    const entries = parseWebhookBatchEntries(request({ rawBody }));

    assert.equal(entries.length, 3);
    assert.deepEqual(
      entries.map((entry) => acceptedEvent(entry.parse).eventType),
      ['ACCNEW', 'ACCALERT', 'SCOREREF'],
    );
    assert.deepEqual(entries.map((entry) => entry.hookId), [
      'not-a-real-hook-id-1',
      'not-a-real-hook-id-2',
      'not-a-real-hook-id-3',
    ]);
  });

  it('lets one malformed event fail alone, without suppressing the ones around it', () => {
    const rawBody = JSON.stringify([
      crsEvent({ id: 'not-a-real-hook-id-1' }),
      crsEvent({ id: 'not-a-real-hook-id-2', time: 'not-a-number' }),
      crsEvent({ id: 'not-a-real-hook-id-3' }),
    ]);
    const entries = parseWebhookBatchEntries(request({ rawBody }));

    assert.deepEqual(entries.map((entry) => entry.parse.ok), [true, false, true]);
    assert.equal(rejectionReason(entries[1].parse), 'bad_shape');
    assert.deepEqual(entries.map((entry) => entry.hookId), [
      'not-a-real-hook-id-1',
      'not-a-real-hook-id-2',
      'not-a-real-hook-id-3',
    ]);
  });

  it('collapses a batch-level rejection to one entry, not to zero events', () => {
    const entries = parseWebhookBatchEntries(
      request({ headers: new Headers(), rawBody: JSON.stringify([crsEvent(), crsEvent()]) }),
    );

    // Zero entries would read to a caller as "an authentic batch that happened to be empty",
    // which has the opposite consequence from "a request nobody authenticated".
    assert.equal(entries.length, 1);
    assert.equal(rejectionReason(entries[0].parse), 'bad_auth');
    assert.equal(entries[0].hookId, null);
  });
});

// ---------------------------------------------------------------------------------------------
// The frozen envelope
// ---------------------------------------------------------------------------------------------

describe('the parsed event and pointer boundary', () => {
  it('carries eventType, occurredAt and memberRef and nothing else', () => {
    const entry = onlyEntry(request());
    const event = acceptedEvent(entry.parse);

    // Key-set EQUALITY, not a subset check: a subset assertion passes on an envelope that also
    // carries alert content, which is the exact failure this test exists to catch.
    assert.deepEqual(Object.keys(event).sort(), ['eventType', 'memberRef', 'occurredAt']);
    assert.equal(event.eventType, 'ACCALERT');
    assert.equal(event.occurredAt, VALID_ISO);
    assert.equal(event.memberRef, 'not-a-real-member-1');
  });

  it('retains the approved fetch pointer and discards every other alert-content field', () => {
    const rawBody = JSON.stringify([crsEvent(), crsEvent({ id: 'not-a-real-hook-id-2' })]);
    const entries = parseWebhookBatchEntries(request({ rawBody }));

    assert.equal(JSON.stringify(entries).includes(ALERT_CONTENT_CANARY), false);
    assert.equal(JSON.stringify(parseWebhookBatch(request({ rawBody }))).includes(ALERT_CONTENT_CANARY), false);
    assert.deepEqual(entries[0].alertPointer, {
      alertId: ALERT_ID,
      alertReportedAt: new Date(VALID_EPOCH_MILLISECONDS - 60_000).toISOString(),
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------------------------

describe('event types', () => {
  for (const eventType of CRS_WEBHOOK_EVENT_TYPES) {
    it(`parses the published type ${eventType}`, () => {
      const entry = onlyEntry(request({ rawBody: JSON.stringify([crsEvent({ type: eventType })]) }));
      assert.equal(acceptedEvent(entry.parse).eventType, eventType);
    });
  }

  it('parses the complete spec-derived event catalog and no fewer', () => {
    assert.equal(new Set(CRS_WEBHOOK_EVENT_TYPES).size, CRS_WEBHOOK_EVENT_TYPES.length);
  });

  it('parses an unpublished event type rather than refusing it', () => {
    // Retry is driven by our RESPONSE BODY, not by the HTTP status: CRS resends any event we do
    // not mark `status: true`. So refusing an unrecognised type would put it in a resend loop that
    // never ends and never improves, while storing it costs one row of a type nobody reads.
    const entry = onlyEntry(
      request({ rawBody: JSON.stringify([crsEvent({ type: 'ACCNOTAREALTYPE' })]) }),
    );

    assert.equal(acceptedEvent(entry.parse).eventType, 'ACCNOTAREALTYPE');
  });
});

// ---------------------------------------------------------------------------------------------
// The two functions built on top of the entry parser
// ---------------------------------------------------------------------------------------------

describe('parseWebhookBatch and verifyAndParseWebhookImpl', () => {
  const rawBody = JSON.stringify([
    crsEvent({ id: 'not-a-real-hook-id-1', type: 'ACCALERT' }),
    crsEvent({ id: 'not-a-real-hook-id-2', type: 'SCOREREF' }),
  ]);

  it('parseWebhookBatch is exactly the entries without their hook ids', () => {
    assert.deepEqual(
      parseWebhookBatch(request({ rawBody })),
      parseWebhookBatchEntries(request({ rawBody })).map((entry) => entry.parse),
    );
  });

  it('verifyAndParseWebhookImpl returns the first event of a good batch', () => {
    const parse = verifyAndParseWebhookImpl(request({ rawBody }));
    assert.equal(acceptedEvent(parse).eventType, 'ACCALERT');
  });

  it('verifyAndParseWebhookImpl returns bad_shape for an empty array', () => {
    assert.equal(rejectionReason(verifyAndParseWebhookImpl(request({ rawBody: '[]' }))), 'bad_shape');
  });

  it('verifyAndParseWebhookImpl rejects a forged request with the verification reason', () => {
    const parse = verifyAndParseWebhookImpl(request({ headers: new Headers(), rawBody }));
    assert.equal(rejectionReason(parse), 'bad_auth');
  });
});
