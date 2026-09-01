// web/src/lib/crs/webhook-handler.test.ts — CRS-05 (a) through (d), proven against the handler
// rather than against the parser.
//
// Plan 04-03's suite proves that a forged request produces a rejection reason. This one proves the
// consequence: that no rejection path writes a row, that a well-formed batch writes one closed
// monitoring row plus an encrypted ACCALERT pointer, that the reply is the array CRS reads, and
// that the fan-out list is returned rather than started.
//
// Every credential here is an obviously-fake literal that says so in its own value, and every
// address is an RFC 5737 documentation range, so no fixture can name a real host or pass for a
// real endpoint password. The alert-content markers are long and synthetic on purpose: a field
// that survives into a stored row shows up as that exact string inside the failure, rather than as
// a shape mismatch somebody has to go and interpret.
//
// The `...overrides` in the three fixture builders is test-local object construction, not a copy
// of anything sensitive — the same call plan 04-03 made, for the same reason.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';

import {
  createFixedClock,
  createInMemoryMemberRefResolver,
  createInMemoryMonitoringEventStore,
} from './ports.ts';
import { createCrsAlertPointerCodec } from './alert-pointer.ts';
import { MonitoringInactiveError } from './ports.ts';
import {
  CRS_ANALYSIS_RELEVANT_EVENT_TYPES,
  handleCrsWebhook,
} from './webhook-handler.ts';

import type {
  InMemoryMonitoringEventStore,
  MemberRefLink,
  MonitoringEventRecord,
  MonitoringEventWriteResult,
  MonitoringProviderEventKey,
} from './ports.ts';
import type { CrsMemberRef } from './types.ts';
import type { CrsWebhookConfig } from './webhook.ts';
import type {
  CrsWebhookHandlerInput,
  CrsWebhookHandlerResult,
  WebhookAckEntry,
} from './webhook-handler.ts';

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

const FAKE_BASIC_USER = 'not-a-real-user';
const FAKE_BASIC_PASS = 'not-a-real-pass';
const FAKE_HMAC_SECRET = 'not-a-real-secret';
const POINTER_CODEC = createCrsAlertPointerCodec('not-a-real-pointer-secret-at-least-32-bytes');

/** RFC 5737 TEST-NET-3 — reserved for documentation, so it can never be a real host. */
const ALLOWED_ADDRESS = '203.0.113.10';
/** RFC 5737 TEST-NET-2, likewise reserved. */
const BLOCKED_ADDRESS = '198.51.100.7';

/**
 * One marker per alert-content field, so a leak names the field it came through instead of leaving
 * somebody to work it out. These are the six fields plan 04-03 discards at the parse; this suite
 * asserts they are still absent one layer further down, which is where a spread of the parsed
 * element into the record argument would put them back.
 */
const ALERT_FIELD_MARKERS = {
  error_code: 'CANARY-ERROR-CODE-7d24',
  error_msg: 'CANARY-ERROR-MSG-7d24',
  alert_id: '550e8400-e29b-41d4-a716-446655440003',
  alert_date: 1755302340000,
  alert_source: 'CANARY-ALERT-SOURCE-7d24',
  host_id: 'CANARY-HOST-ID-7d24',
} as const;

const ALERT_MARKER_VALUES: readonly string[] = Object.values(ALERT_FIELD_MARKERS)
  .filter((value) => typeof value === 'string')
  .map(String);

/** The exact four keys a monitoring row may carry, sorted, for an EQUALITY assertion. */
const PERMITTED_EVENT_KEYS = ['clientId', 'eventType', 'occurredAt', 'receivedAt'];

/** The exact two keys a reply entry may carry, sorted. `hook_id` is the vendor's spelling. */
const PERMITTED_ACK_KEYS = ['hook_id', 'status'];

const EVENT_EPOCH_MILLISECONDS = 1755302400000;
const EVENT_ISO = '2025-08-16T00:00:00.000Z';
/** Where the injected clock stands. Nothing in this suite reads a wall clock or sleeps. */
const RECEIVED_ISO = '2026-08-16T12:00:00.000Z';

const MEMBER_ONE = 'not-a-real-member-1' as CrsMemberRef;
const MEMBER_TWO = 'not-a-real-member-2' as CrsMemberRef;
const MEMBER_THREE = 'not-a-real-member-3' as CrsMemberRef;
const UNKNOWN_MEMBER = 'not-a-real-member-not-enrolled' as CrsMemberRef;

const CLIENT_ONE = 'not-a-real-client-1';
const CLIENT_TWO = 'not-a-real-client-2';
const CLIENT_THREE = 'not-a-real-client-3';

const DEFAULT_LINKS: readonly MemberRefLink[] = [
  { clientId: CLIENT_ONE, memberRef: MEMBER_ONE },
  { clientId: CLIENT_TWO, memberRef: MEMBER_TWO },
  { clientId: CLIENT_THREE, memberRef: MEMBER_THREE },
];

function basicAuthHeader(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`;
}

const VALID_AUTH_HEADER = basicAuthHeader(FAKE_BASIC_USER, FAKE_BASIC_PASS);

/** The suite computes its own digest rather than reading one out of the code under test. */
function signatureFor(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
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

/** One element of the array CRS posts, every alert field carrying its marker. */
function crsEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const hookId = overrides.id ?? 'not-a-real-hook-id-1';
  return {
    id: hookId,
    type: 'ACCALERT',
    user_id: MEMBER_ONE,
    time: EVENT_EPOCH_MILLISECONDS,
    ...ALERT_FIELD_MARKERS,
    alert_id: hookId === 'not-a-real-hook-id-1'
      ? ALERT_FIELD_MARKERS.alert_id
      : `fixture-alert-for-${String(hookId)}`,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------------------------

/** The in-memory store plus a count of how many writes were ATTEMPTED, failures included. */
interface CountingMonitoringEventStore extends InMemoryMonitoringEventStore {
  attempts(): number;
}

/**
 * A store that rejects for one nominated position in the batch and delegates every other write.
 *
 * The rejection carries a marker in its message so the "nothing about the caught value travels"
 * expectation has something concrete to be checked against — the handler discards it without
 * binding it, so the marker must not appear in the reply.
 */
function createStoreFailingAt(failingAttempt: number): CountingMonitoringEventStore {
  const inner = createInMemoryMonitoringEventStore();
  let attempts = 0;

  return {
    record(
      event: MonitoringEventRecord,
      providerKey: MonitoringProviderEventKey,
      alertPointer?: Parameters<InMemoryMonitoringEventStore['record']>[2],
    ): Promise<MonitoringEventWriteResult> {
      attempts += 1;
      if (attempts === failingAttempt) {
        return Promise.reject(new Error('STORE-REJECTION-CANARY-7d24 the write was refused'));
      }
      return inner.record(event, providerKey, alertPointer);
    },
    readAll: () => inner.readAll(),
    readAlertPointers: () => inner.readAlertPointers(),
    attempts: () => attempts,
  };
}

/** The in-memory store plus the ARGUMENTS it was handed, kept exactly as they arrived. */
interface CapturingMonitoringEventStore extends InMemoryMonitoringEventStore {
  captured(): ReadonlyArray<Record<string, unknown>>;
}

/**
 * A store that keeps the record argument untruncated, and the reason it has to exist.
 *
 * `createInMemoryMonitoringEventStore` rebuilds the stored row from four named fields. That is the
 * right thing for a store to do — it truncates an over-wide object at the boundary — and the wrong
 * thing for a key-set assertion to lean on, because it would quietly absorb a spread of the parsed
 * event into the record argument and the assertion would pass on a call that was already
 * over-wide. Phase 5's Supabase-backed store will not truncate on our behalf, so the argument is
 * what has to be closed, and the argument is what this store lets the suite look at.
 */
function createCapturingStore(): CapturingMonitoringEventStore {
  const inner = createInMemoryMonitoringEventStore();
  const seen: Array<Record<string, unknown>> = [];

  return {
    record(
      event: MonitoringEventRecord,
      providerKey: MonitoringProviderEventKey,
      alertPointer?: Parameters<InMemoryMonitoringEventStore['record']>[2],
    ): Promise<MonitoringEventWriteResult> {
      seen.push(event as unknown as Record<string, unknown>);
      return inner.record(event, providerKey, alertPointer);
    },
    readAll: () => inner.readAll(),
    readAlertPointers: () => inner.readAlertPointers(),
    captured: () => seen,
  };
}

// ---------------------------------------------------------------------------------------------
// Scenario builder
// ---------------------------------------------------------------------------------------------

interface ScenarioOptions {
  events?: readonly unknown[];
  /** Set instead of `events` when the body must not be a well-formed array of objects. */
  body?: string;
  headers?: Headers;
  remoteAddress?: string | null;
  config?: CrsWebhookConfig;
  links?: readonly MemberRefLink[];
  store?: InMemoryMonitoringEventStore;
}

/** The ports and the request, wired the way plan 04-08's route will wire them. */
function scenario(options: ScenarioOptions = {}): {
  store: InMemoryMonitoringEventStore;
  input: CrsWebhookHandlerInput;
} {
  const store = options.store ?? createInMemoryMonitoringEventStore();
  const body = options.body ?? JSON.stringify(options.events ?? [crsEvent()]);

  return {
    store,
    input: {
      headers: options.headers ?? new Headers({ authorization: VALID_AUTH_HEADER }),
      rawBody: body,
      remoteAddress: options.remoteAddress ?? null,
      config: options.config ?? config(),
      store,
      resolver: createInMemoryMemberRefResolver(options.links ?? DEFAULT_LINKS),
      clock: createFixedClock(RECEIVED_ISO),
      pointerCodec: POINTER_CODEC,
    },
  };
}

/** Run one scenario and hand back the result alongside the store it wrote to. */
async function run(options: ScenarioOptions = {}): Promise<{
  result: CrsWebhookHandlerResult;
  store: InMemoryMonitoringEventStore;
}> {
  const { store, input } = scenario(options);
  return { result: await handleCrsWebhook(input), store };
}

/** The `status` of every reply entry, in order — the shape the ack assertions compare against. */
function ackStatuses(body: WebhookAckEntry[]): boolean[] {
  return body.map((entry) => entry.status);
}

/** The `hook_id` of every reply entry, in order. */
function ackHookIds(body: WebhookAckEntry[]): Array<string | null> {
  return body.map((entry) => entry.hook_id);
}

// ---------------------------------------------------------------------------------------------
// What lands in the row
// ---------------------------------------------------------------------------------------------

describe('handleCrsWebhook — the stored row', () => {
  it('writes exactly one row per accepted event', async () => {
    const { result, store } = await run({
      events: [
        crsEvent({ id: 'hook-1', user_id: MEMBER_ONE }),
        crsEvent({ id: 'hook-2', user_id: MEMBER_TWO }),
        crsEvent({ id: 'hook-3', user_id: MEMBER_THREE }),
      ],
    });

    assert.equal(result.status, 200);
    assert.equal(store.readAll().length, 3);
    assert.deepEqual(
      store.readAll().map((row) => row.clientId),
      [CLIENT_ONE, CLIENT_TWO, CLIENT_THREE],
    );
  });

  it('carries exactly the four permitted keys, by key-set EQUALITY and not by subset', async () => {
    // Equality is the whole assertion. `keys.includes('clientId')` passes just as happily on a row
    // that also carries an alert body, which is precisely the row this test exists to forbid.
    const { store } = await run();

    const [stored] = store.readAll();
    assert.deepEqual(Object.keys(stored).sort(), PERMITTED_EVENT_KEYS);
  });

  it('hands the store an argument with exactly those four keys and nothing else', async () => {
    // The second site of the same equality, one layer up from the row. This is the one that goes
    // red if the record argument is ever built by spreading the parsed event, because the in-memory
    // store would truncate that back to four fields and the row assertion above would not notice.
    const store = createCapturingStore();
    await run({ store, events: [crsEvent({ id: 'hook-1', user_id: MEMBER_ONE })] });

    assert.equal(store.captured().length, 1);
    assert.deepEqual(Object.keys(store.captured()[0]).sort(), PERMITTED_EVENT_KEYS);
    assert.equal(
      JSON.stringify(store.captured()).includes('memberRef'),
      false,
      'the routing key resolves a client and is not itself stored',
    );
  });

  it('lets no alert-content field survive into a stored row', async () => {
    const { store } = await run({
      events: [
        crsEvent({ id: 'hook-1', user_id: MEMBER_ONE }),
        crsEvent({ id: 'hook-2', user_id: MEMBER_TWO }),
      ],
    });

    const serialized = JSON.stringify(store.readAll());
    for (const marker of ALERT_MARKER_VALUES) {
      assert.equal(
        serialized.includes(marker),
        false,
        `an alert-content field reached a monitoring row: ${marker}`,
      );
    }
  });

  it('lets no alert-content field or vendor hook id reach the reply either', async () => {
    const { result } = await run({ events: [crsEvent({ id: 'hook-1' })] });

    const serialized = JSON.stringify(result);
    for (const marker of ALERT_MARKER_VALUES) {
      assert.equal(serialized.includes(marker), false, `an alert field reached the reply: ${marker}`);
    }
  });

  it('converts the epoch-milliseconds time into the row and stamps the injected clock', async () => {
    const { store } = await run();

    const [stored] = store.readAll();
    assert.equal(stored.occurredAt, EVENT_ISO);
    assert.equal(stored.receivedAt, RECEIVED_ISO);
    assert.equal(stored.eventType, 'ACCALERT');
  });

  it('stores an unpublished event type rather than refusing it', async () => {
    // Plan 04-03 accepts an unrecognised type on purpose — refusing it would put it in a resend
    // loop with no end. The row is kept; the fan-out is not spent on it.
    const { result, store } = await run({
      events: [crsEvent({ id: 'hook-1', type: 'ACCWHATEVERCOMESNEXT' })],
    });

    assert.deepEqual(ackStatuses(result.body), [true]);
    assert.equal(store.readAll().length, 1);
    assert.equal(store.readAll()[0].eventType, 'ACCWHATEVERCOMESNEXT');
    assert.deepEqual(result.fanOut, []);
  });
});

// ---------------------------------------------------------------------------------------------
// The reply
// ---------------------------------------------------------------------------------------------

describe('handleCrsWebhook — the reply array', () => {
  it('answers 200 with one entry per event, in the order CRS sent them', async () => {
    const { result } = await run({
      events: [
        crsEvent({ id: 'hook-1', user_id: MEMBER_ONE }),
        crsEvent({ id: 'hook-2', user_id: MEMBER_TWO }),
        crsEvent({ id: 'hook-3', user_id: MEMBER_THREE }),
      ],
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.length, 3);
    assert.deepEqual(ackHookIds(result.body), ['hook-1', 'hook-2', 'hook-3']);
    assert.deepEqual(ackStatuses(result.body), [true, true, true]);
  });

  it('gives every entry exactly the keys hook_id and status', async () => {
    // The snake_case spelling is the vendor's wire shape. Renaming either key produces a reply CRS
    // cannot match to a hook, so every event would resend while the endpoint answered 200.
    const { result } = await run({
      events: [crsEvent({ id: 'hook-1', user_id: MEMBER_ONE }), crsEvent({ id: 'hook-2', user_id: MEMBER_TWO })],
    });

    for (const entry of result.body) {
      assert.deepEqual(Object.keys(entry).sort(), PERMITTED_ACK_KEYS);
    }
  });

  it('carries a null hook_id rather than dropping an entry when the element had no id', async () => {
    const { result } = await run({
      events: [crsEvent({ id: 'hook-1', user_id: MEMBER_ONE }), crsEvent({ id: undefined, user_id: MEMBER_TWO })],
    });

    assert.deepEqual(ackHookIds(result.body), ['hook-1', null]);
    assert.deepEqual(ackStatuses(result.body), [true, true]);
  });

  it('answers status false for the one event that failed to persist, and 200 for the batch', async () => {
    const store = createStoreFailingAt(2);
    const { result } = await run({
      store,
      events: [
        crsEvent({ id: 'hook-1', user_id: MEMBER_ONE }),
        crsEvent({ id: 'hook-2', user_id: MEMBER_TWO }),
        crsEvent({ id: 'hook-3', user_id: MEMBER_THREE }),
      ],
    });

    // The HTTP status stays 200 because CRS reads the BODY, not the code: a status other than
    // `true` is what makes it resend, and it should resend exactly hook-2.
    assert.equal(result.status, 200);
    assert.deepEqual(ackStatuses(result.body), [true, false, true]);
    assert.deepEqual(ackHookIds(result.body), ['hook-1', 'hook-2', 'hook-3']);
    assert.equal(store.attempts(), 3, 'all three writes must be attempted');
    assert.equal(store.readAll().length, 2, 'the two that did not fail must be stored');
    assert.deepEqual(
      store.readAll().map((row) => row.clientId),
      [CLIENT_ONE, CLIENT_THREE],
    );
  });

  it('leaks nothing from the caught store rejection into the reply', async () => {
    const store = createStoreFailingAt(1);
    const { result } = await run({ store, events: [crsEvent({ id: 'hook-1' })] });

    assert.deepEqual(ackStatuses(result.body), [false]);
    assert.equal(JSON.stringify(result).includes('STORE-REJECTION-CANARY-7d24'), false);
  });

  it('answers status false and writes nothing for a member we cannot attribute', async () => {
    // The likeliest cause is the webhook overtaking the enrollment row, so a resend is the cure.
    const { result, store } = await run({
      events: [crsEvent({ id: 'hook-1', user_id: UNKNOWN_MEMBER })],
    });

    assert.equal(result.status, 200);
    assert.deepEqual(ackStatuses(result.body), [false]);
    assert.equal(store.readAll().length, 0);
    assert.deepEqual(result.fanOut, []);
  });

  it('fails closed and requests redelivery when pointer protection is not configured', async () => {
    const { input, store } = scenario({ events: [crsEvent({ id: 'hook-unconfigured' })] });
    input.pointerCodec = null;

    const result = await handleCrsWebhook(input);

    assert.deepEqual(result.body, [{ hook_id: 'hook-unconfigured', status: false }]);
    assert.equal(store.readAll().length, 0);
    assert.equal(store.readAlertPointers().length, 0);
    assert.deepEqual(result.fanOut, []);
  });

  it('acknowledges and discards a signed late event for an inactive enrollment', async () => {
    const { input, store } = scenario({ events: [crsEvent({ id: 'hook-withdrawn' })] });
    input.resolver = {
      async resolveForClient() { return null; },
      async resolveClientForMember() { throw new MonitoringInactiveError(); },
    };
    const result = await handleCrsWebhook(input);
    assert.deepEqual(ackStatuses(result.body), [true]);
    assert.equal(store.readAll().length, 0);
    assert.deepEqual(result.fanOut, []);
  });

  it('acknowledges a per-event bad shape TRUE and stores nothing for it, keeping the rest', async () => {
    // Deliberate, and arguable, so it is named rather than left to look like an accident: `false`
    // would ask CRS to resend an event that is malformed on every attempt, and CRS publishes no
    // attempt cap, so that loop has no documented end. We lose one unparseable event; the
    // alternative is unbounded traffic against our own endpoint. Plan 04-08 records the tradeoff
    // in the lane file as an open question for the Kale call.
    const { result, store } = await run({
      events: [
        crsEvent({ id: 'hook-1', user_id: MEMBER_ONE }),
        crsEvent({ id: 'hook-2', user_id: MEMBER_TWO, time: 'not-a-number' }),
        crsEvent({ id: 'hook-3', user_id: MEMBER_THREE }),
      ],
    });

    assert.equal(result.status, 200);
    assert.deepEqual(ackStatuses(result.body), [true, true, true]);
    assert.deepEqual(ackHookIds(result.body), ['hook-1', 'hook-2', 'hook-3']);
    assert.equal(store.readAll().length, 2, 'the malformed element must not produce a row');
    assert.deepEqual(
      store.readAll().map((row) => row.clientId),
      [CLIENT_ONE, CLIENT_THREE],
    );
  });

  it('reads a lone malformed element that still carries an id as a per-event failure', async () => {
    // A one-element batch is ordinary rather than exotic — ACCALERT is real-time-capable — so the
    // hook id is what separates "one bad element" from "an unparseable request".
    const { result, store } = await run({
      events: [crsEvent({ id: 'hook-1', time: 'not-a-number' })],
    });

    assert.equal(result.status, 200);
    assert.deepEqual(result.body, [{ hook_id: 'hook-1', status: true }]);
    assert.equal(store.readAll().length, 0);
  });
});

// ---------------------------------------------------------------------------------------------
// Rejection paths — CRS-05 (a), the consequence rather than the reason
// ---------------------------------------------------------------------------------------------

describe('handleCrsWebhook — no rejection path writes anything', () => {
  const cases: ReadonlyArray<{
    name: string;
    status: number;
    options: ScenarioOptions;
  }> = [
    {
      name: 'bad_auth — the wrong password',
      status: 401,
      options: {
        headers: new Headers({ authorization: basicAuthHeader(FAKE_BASIC_USER, 'not-the-pass') }),
      },
    },
    {
      name: 'bad_auth — no authorization header at all',
      status: 401,
      options: { headers: new Headers() },
    },
    {
      name: 'bad_auth — the credential is not configured, so the endpoint fails closed',
      status: 401,
      options: { config: config({ basicUser: null, basicPass: null }) },
    },
    {
      name: 'bad_signature — a digest that does not match the body',
      status: 401,
      options: {
        config: config({ hmacSecret: FAKE_HMAC_SECRET }),
        headers: new Headers({
          authorization: VALID_AUTH_HEADER,
          'x-crs-signature': signatureFor('[]', FAKE_HMAC_SECRET),
        }),
      },
    },
    {
      name: 'source_ip — a caller outside the configured allowlist',
      status: 403,
      options: {
        config: config({ sourceIps: [ALLOWED_ADDRESS] }),
        remoteAddress: BLOCKED_ADDRESS,
      },
    },
    {
      name: 'bad_shape — a body that is not JSON',
      status: 400,
      options: { body: 'this is not json' },
    },
    {
      name: 'bad_shape — a JSON object where CRS sends an array',
      status: 400,
      options: { body: JSON.stringify({ type: 'ACCALERT' }) },
    },
    {
      name: 'bad_shape — an empty array',
      status: 400,
      options: { body: JSON.stringify([]) },
    },
    {
      name: 'bad_shape — a lone element with neither an id nor a usable shape',
      status: 400,
      options: { events: [{ nothing: 'usable' }] },
    },
  ];

  for (const testCase of cases) {
    it(`${testCase.name} answers ${testCase.status}, an empty body and an empty fan-out`, async () => {
      const { result, store } = await run(testCase.options);

      assert.equal(result.status, testCase.status);
      assert.deepEqual(result.body, [], 'a refused request must not name an event it did not accept');
      assert.deepEqual(result.fanOut, []);
      assert.equal(store.readAll().length, 0, 'no rejection path may write a row');
    });
  }
});

// ---------------------------------------------------------------------------------------------
// Fan-out — CRS-05 (d)
// ---------------------------------------------------------------------------------------------

describe('handleCrsWebhook — the fan-out list', () => {
  it('returns a stored ACCALERT with the client it was attributed to', async () => {
    const { result } = await run({ events: [crsEvent({ id: 'hook-1', type: 'ACCALERT' })] });

    assert.equal(result.fanOut.length, 1);
    assert.equal(result.fanOut[0].clientId, CLIENT_ONE);
    assert.match(result.fanOut[0].monitoringEventId, /^[0-9a-f-]{36}$/);
    assert.deepEqual(result.fanOut[0].event, {
      eventType: 'ACCALERT',
      occurredAt: EVENT_ISO,
      memberRef: MEMBER_ONE,
    });
  });

  it('returns every analysis-relevant type and no other published type', async () => {
    for (const eventType of CRS_ANALYSIS_RELEVANT_EVENT_TYPES) {
      const { result } = await run({ events: [crsEvent({ id: 'hook-1', type: eventType })] });
      assert.equal(result.fanOut.length, 1, `${eventType} should be worth a plan refresh`);
    }

    for (const eventType of ['ACCLOGINFAIL', 'IDFAIL', 'ACCREG', 'ACCREGFAIL', 'ACCLOCKED', 'ERROR', 'TEST']) {
      const { result, store } = await run({ events: [crsEvent({ id: 'hook-1', type: eventType })] });
      assert.deepEqual(ackStatuses(result.body), [true], `${eventType} is still acknowledged`);
      assert.equal(store.readAll().length, 1, `${eventType} is still stored`);
      assert.deepEqual(result.fanOut, [], `${eventType} must not spend an analysis run`);
    }
  });

  it('does not fan out an analysis-relevant event that failed to persist', async () => {
    // The refresh would otherwise run against a monitoring history missing the very event that
    // triggered it. This is the assertion that goes red if the fan-out append is moved above the
    // persistence check.
    const store = createStoreFailingAt(1);
    const { result } = await run({ store, events: [crsEvent({ id: 'hook-1', type: 'ACCALERT' })] });

    assert.deepEqual(ackStatuses(result.body), [false]);
    assert.equal(store.readAll().length, 0);
    assert.deepEqual(result.fanOut, []);
  });

  it('does not fan out an analysis-relevant event whose member could not be attributed', async () => {
    const { result } = await run({
      events: [crsEvent({ id: 'hook-1', type: 'SCOREREF', user_id: UNKNOWN_MEMBER })],
    });

    assert.deepEqual(ackStatuses(result.body), [false]);
    assert.deepEqual(result.fanOut, []);
  });

  it('fans out only the events that survived a mixed batch', async () => {
    const store = createStoreFailingAt(2);
    const { result } = await run({
      store,
      events: [
        crsEvent({ id: 'hook-1', type: 'ACCALERT', user_id: MEMBER_ONE }),
        crsEvent({ id: 'hook-2', type: 'ACCALERT', user_id: MEMBER_TWO }),
        crsEvent({ id: 'hook-3', type: 'ACCLOGINFAIL', user_id: MEMBER_THREE }),
      ],
    });

    assert.deepEqual(ackStatuses(result.body), [true, false, true]);
    assert.deepEqual(
      result.fanOut.map((item) => item.clientId),
      [CLIENT_ONE],
    );
  });

  it('schedules nothing itself — the caller gets a list and decides', async () => {
    // `after()` fires even when the handler returned an error, so a handler that scheduled its own
    // fan-out would fan out on the 401 path. The proof that it does not is that the work is still
    // sitting in the return value, and that a refused request returns an empty one.
    const { result } = await run({ events: [crsEvent({ id: 'hook-1' })] });
    assert.equal(result.fanOut.length, 1);

    const refused = await run({ headers: new Headers() });
    assert.deepEqual(refused.result.fanOut, []);
  });

  it('collapses duplicate delivery to one stored row and one stable fan-out id', async () => {
    const { input, store } = scenario({
      events: [crsEvent({ id: 'stable-hook', type: 'ACCALERT' })],
    });

    const first = await handleCrsWebhook(input);
    const second = await handleCrsWebhook(input);
    assert.equal(store.readAll().length, 1);
    assert.equal(first.fanOut[0].monitoringEventId, second.fanOut[0].monitoringEventId);
    assert.deepEqual(first.body, second.body);
  });

  it('gives distinct persisted ids to distinct callback keys', async () => {
    const store = createInMemoryMonitoringEventStore();
    const first = await run({ store, events: [crsEvent({ id: 'stable-hook-one' })] });
    const second = await run({ store, events: [crsEvent({ id: 'stable-hook-two' })] });

    assert.notEqual(
      first.result.fanOut[0].monitoringEventId,
      second.result.fanOut[0].monitoringEventId,
    );
    assert.equal(store.readAll().length, 2);
  });
});

// ---------------------------------------------------------------------------------------------
// The hot path
// ---------------------------------------------------------------------------------------------

describe('handleCrsWebhook — the hot path', () => {
  it('makes no network call before it answers', async () => {
    const originalFetch = globalThis.fetch;
    let reached = false;

    globalThis.fetch = (() => {
      reached = true;
      throw new Error('the handler must answer without touching the network');
    }) as typeof globalThis.fetch;

    try {
      const { result, store } = await run({
        events: [
          crsEvent({ id: 'hook-1', user_id: MEMBER_ONE }),
          crsEvent({ id: 'hook-2', user_id: MEMBER_TWO }),
        ],
      });

      assert.equal(result.status, 200);
      assert.equal(store.readAll().length, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(reached, false, 'the handler reached the network on the hot path');
  });

  it('reads time only from the injected clock, so two runs stamp the same instant', async () => {
    const first = await run();
    const second = await run();

    assert.deepEqual(first.store.readAll(), second.store.readAll());
    assert.equal(first.store.readAll()[0].receivedAt, RECEIVED_ISO);
  });
});
