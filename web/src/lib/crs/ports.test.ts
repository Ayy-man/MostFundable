// web/src/lib/crs/ports.test.ts — CRS-02 mechanism (a), plus the determinism the clock buys.
//
// The load-bearing assertion in this file is key-set EQUALITY on a recorded monitoring event, and
// the validation contract names equality for a reason: a subset assertion (`keys.includes(...)`,
// or checking the four fields are present) passes cheerfully on a record that also carries a
// bureau body. Only equality fails when a fifth field appears, which is the failure this file
// exists to produce.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createCrsAlertPointerCodec } from './alert-pointer.ts';
import {
  CRS_ALERT_POINTER_FORBIDDEN_RAW_FIELDS,
  CRS_ALERT_POINTER_OPERATIONAL_FIELDS,
} from './alert-storage-rule.ts';
import {
  createFixedClock,
  createInMemoryMemberRefResolver,
  createInMemoryMonitoringEventStore,
  createMonitoringProviderEventKey,
  monitoringEventIdForProviderKey,
  systemClock,
} from './ports.ts';
import type { MonitoringEventRecord } from './ports.ts';
import type { CrsMemberRef } from './types.ts';

/** Exactly the columns Phase 1's `monitoring_events` has beyond its own `id`, sorted. */
const PERMITTED_EVENT_KEYS = ['clientId', 'eventType', 'occurredAt', 'receivedAt'];

const SAMPLE_EVENT: MonitoringEventRecord = {
  clientId: 'client-0001',
  eventType: 'ACCALERT',
  occurredAt: '2026-08-16T03:00:00.000Z',
  receivedAt: '2026-08-16T03:00:04.000Z',
};

/**
 * An obviously-synthetic marker. Nothing here resembles bureau content — the assertions only need
 * a string that is unmistakable in a failure message if it ever turns up somewhere it should not.
 */
const OVER_WIDE_MARKER = 'OVER-WIDE-FIELD-CANARY-3b71';
const KEY_ONE = createMonitoringProviderEventKey('synthetic-event-one');
const KEY_TWO = createMonitoringProviderEventKey('synthetic-event-two');

describe('createInMemoryMonitoringEventStore — CRS-02 (a), the absence of a sink', () => {
  it('stores exactly the four permitted keys — key-set equality, never a subset', async () => {
    const store = createInMemoryMonitoringEventStore();
    await store.record(SAMPLE_EVENT, KEY_ONE);

    const stored = store.readAll();
    assert.equal(stored.length, 1);
    assert.deepEqual(Object.keys(stored[0]).sort(), PERMITTED_EVENT_KEYS);
    assert.deepEqual(stored[0], SAMPLE_EVENT);
  });

  it('truncates an over-wide record at the boundary instead of spreading it', async () => {
    const store = createInMemoryMonitoringEventStore();

    // The deliberate cast stands in for a future caller who hands the store more than the type
    // allows — a webhook receiver passing the parsed event straight through, say. The type would
    // reject this at compile time, so the cast is how the test reaches the runtime behaviour
    // underneath it: the store names the four fields it copies rather than spreading its
    // argument, so the extra one is dropped and never retained.
    const overWide = {
      ...SAMPLE_EVENT,
      clientId: 'client-0002',
      payload: OVER_WIDE_MARKER,
    } as unknown as MonitoringEventRecord;

    await store.record(overWide, KEY_ONE);

    const stored = store.readAll()[0];
    assert.deepEqual(Object.keys(stored).sort(), PERMITTED_EVENT_KEYS);
    assert.ok(!JSON.stringify(stored).includes(OVER_WIDE_MARKER));
  });

  it('appends one record per call, in the order they arrived', async () => {
    const store = createInMemoryMonitoringEventStore();
    await store.record(SAMPLE_EVENT, KEY_ONE);
    await store.record({ ...SAMPLE_EVENT, eventType: 'SCOREREF' }, KEY_TWO);

    assert.deepEqual(
      store.readAll().map((event) => event.eventType),
      ['ACCALERT', 'SCOREREF'],
    );
  });

  it('hands back a copy of the list, so a caller cannot append through the result', async () => {
    const store = createInMemoryMonitoringEventStore();
    await store.record(SAMPLE_EVENT, KEY_ONE);

    store.readAll().push({ ...SAMPLE_EVENT, eventType: 'TEST' });
    assert.equal(store.readAll().length, 1);
  });

  it('returns the same RFC-shaped UUID and one row for duplicate delivery', async () => {
    const store = createInMemoryMonitoringEventStore();
    const first = await store.record(SAMPLE_EVENT, KEY_ONE);
    const second = await store.record({ ...SAMPLE_EVENT }, KEY_ONE);

    assert.deepEqual(first, second);
    assert.match(first.id, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(first.id, monitoringEventIdForProviderKey(KEY_ONE));
    assert.equal(store.readAll().length, 1);
  });

  it('treats receipt time as first-seen metadata rather than provider identity', async () => {
    const store = createInMemoryMonitoringEventStore();
    const first = await store.record(SAMPLE_EVENT, KEY_ONE);
    const second = await store.record(
      { ...SAMPLE_EVENT, receivedAt: '2026-08-16T03:05:04.000Z' },
      KEY_ONE,
    );
    assert.deepEqual(second, first);
    assert.deepEqual(store.readAll(), [SAMPLE_EVENT]);
  });

  it('keeps one protected pointer with exactly the rule-approved operational fields', async () => {
    const store = createInMemoryMonitoringEventStore();
    const codec = createCrsAlertPointerCodec('not-a-real-pointer-secret-at-least-32-bytes');
    const hookId = '550e8400-e29b-41d4-a716-446655440000';
    const alertId = '550e8400-e29b-41d4-a716-446655440003';
    const hookKey = codec.protectHookId(hookId);
    const pointer = codec.protectAlertId({
      alertId,
      alertReportedAt: '2026-08-16T02:59:00.000Z',
      receivedAt: SAMPLE_EVENT.receivedAt,
    });

    await store.record(SAMPLE_EVENT, hookKey, pointer);
    await store.record(
      { ...SAMPLE_EVENT, receivedAt: '2026-08-16T03:05:04.000Z' },
      hookKey,
      codec.protectAlertId({
        alertId,
        alertReportedAt: '2026-08-16T02:59:00.000Z',
        receivedAt: '2026-08-16T03:05:04.000Z',
      }),
    );

    const [stored] = store.readAlertPointers();
    const expectedKeys = [
      ...CRS_ALERT_POINTER_OPERATIONAL_FIELDS.map((field) => ({
        alert_id_ciphertext: 'alertIdCiphertext',
        alert_id_iv: 'alertIdIv',
        alert_id_tag: 'alertIdTag',
        alert_reported_at: 'alertReportedAt',
        client_id: 'clientId',
        delivered_at: 'deliveredAt',
        expired_at: 'expiredAt',
        expires_at: 'expiresAt',
        key_version: 'keyVersion',
        monitoring_event_id: 'monitoringEventId',
        occurred_at: 'occurredAt',
        provider_alert_key: 'alertLookupKey',
        provider_hook_key: 'providerHookKey',
        read_at: 'readAt',
        received_at: 'receivedAt',
      })[field]),
    ].sort();
    assert.deepEqual(Object.keys(stored).sort(), expectedKeys);
    assert.equal(store.readAlertPointers().length, 1);
    const serialized = JSON.stringify(stored);
    assert.equal(serialized.includes(hookId), false);
    assert.equal(serialized.includes(alertId), false);
    for (const rawField of CRS_ALERT_POINTER_FORBIDDEN_RAW_FIELDS) {
      assert.equal(Object.hasOwn(stored, rawField), false);
    }
  });

  it('assigns a different UUID to a different transient provider key', async () => {
    assert.notEqual(
      monitoringEventIdForProviderKey(KEY_ONE),
      monitoringEventIdForProviderKey(KEY_TWO),
    );
  });

  it('fails closed when one transient key is reused for changed metadata', async () => {
    const store = createInMemoryMonitoringEventStore();
    await store.record(SAMPLE_EVENT, KEY_ONE);
    await assert.rejects(
      store.record({ ...SAMPLE_EVENT, eventType: 'REPORTREF' }, KEY_ONE),
      { message: 'MONITORING_EVENT_MISMATCH' },
    );
    assert.deepEqual(store.readAll(), [SAMPLE_EVENT]);
  });
});

describe('createInMemoryMemberRefResolver', () => {
  const CLIENT_A = 'client-a';
  const MEMBER_REF_A = 'mock_member_a' as CrsMemberRef;
  const MEMBER_REF_B = 'mock_member_b' as CrsMemberRef;

  it('returns null for an unknown client rather than throwing', async () => {
    const resolver = createInMemoryMemberRefResolver();
    assert.equal(await resolver.resolveForClient('nobody-here'), null);
  });

  it('returns null for an unknown member ref rather than throwing', async () => {
    const resolver = createInMemoryMemberRefResolver();
    assert.equal(await resolver.resolveClientForMember(MEMBER_REF_A), null);
  });

  it('resolves a seeded pair in both directions', async () => {
    const resolver = createInMemoryMemberRefResolver([
      { clientId: CLIENT_A, memberRef: MEMBER_REF_A },
    ]);

    assert.equal(await resolver.resolveForClient(CLIENT_A), MEMBER_REF_A);
    assert.equal(await resolver.resolveClientForMember(MEMBER_REF_A), CLIENT_A);
  });

  it('links a pair after construction', async () => {
    const resolver = createInMemoryMemberRefResolver();
    resolver.link(CLIENT_A, MEMBER_REF_A);

    assert.equal(await resolver.resolveForClient(CLIENT_A), MEMBER_REF_A);
  });

  it('drops the stale reverse entry when a client is re-linked', async () => {
    const resolver = createInMemoryMemberRefResolver([
      { clientId: CLIENT_A, memberRef: MEMBER_REF_A },
    ]);
    resolver.link(CLIENT_A, MEMBER_REF_B);

    assert.equal(await resolver.resolveForClient(CLIENT_A), MEMBER_REF_B);
    // The retired ref must stop resolving, or a webhook arriving on it is attributed to a client
    // that has since moved.
    assert.equal(await resolver.resolveClientForMember(MEMBER_REF_A), null);
  });
});

describe('Clock — deterministic time, which is why no test in this phase sleeps', () => {
  const PINNED_ISO = '2026-08-16T12:00:00.000Z';

  it('returns the same instant on repeated now() calls', () => {
    const clock = createFixedClock(PINNED_ISO);
    assert.equal(clock.now().toISOString(), PINNED_ISO);
    assert.equal(clock.now().toISOString(), PINNED_ISO);
  });

  it('advances by exactly the milliseconds given', () => {
    const clock = createFixedClock(PINNED_ISO);
    const before = clock.now().getTime();

    clock.advance(30_000);
    assert.equal(clock.now().getTime() - before, 30_000);
    assert.equal(clock.now().toISOString(), '2026-08-16T12:00:30.000Z');

    clock.advance(-1);
    assert.equal(clock.now().getTime() - before, 29_999);
  });

  it('hands back a distinct Date each call, so mutating one cannot move the clock', () => {
    const clock = createFixedClock(PINNED_ISO);
    const first = clock.now();
    assert.notStrictEqual(first, clock.now());

    first.setTime(0);
    assert.equal(clock.now().toISOString(), PINNED_ISO);
  });

  it('rejects a timestamp it cannot parse rather than pinning to an invalid instant', () => {
    assert.throws(() => createFixedClock('not-a-timestamp'), RangeError);
  });

  it('rejects a non-finite advance rather than moving to an invalid instant', () => {
    const clock = createFixedClock(PINNED_ISO);
    assert.throws(() => clock.advance(Number.NaN), RangeError);
    assert.equal(clock.now().toISOString(), PINNED_ISO);
  });

  it('systemClock reads a real instant', () => {
    const instant = systemClock.now();
    assert.ok(instant instanceof Date);
    assert.ok(Number.isFinite(instant.getTime()));
  });
});
