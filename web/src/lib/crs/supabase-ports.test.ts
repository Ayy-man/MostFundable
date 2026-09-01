import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createCrsAlertPointerCodec } from './alert-pointer.ts';
import { createMonitoringProviderEventKey } from './ports.ts';
import {
  createSupabaseMemberRefResolver,
  createSupabaseMonitoringEventStore,
} from './supabase-ports.ts';

import type { CrsAdminClient } from './supabase-ports.ts';
import type { CrsMemberRef } from './types.ts';

interface StoredMonitoringRow {
  id: string;
  client_id: string;
  event_type: string;
  occurred_at: string;
  received_at: string;
}

interface EnrollmentRow {
  client_id: string;
  crs_member_ref: string | null;
  status: 'active' | 'cancelled';
}

interface StoredAlertPointerRow {
  id: string;
  client_id: string;
  monitoring_event_id: string;
  provider_hook_key: string;
  provider_alert_key: string;
  alert_id_ciphertext: string | null;
  alert_id_iv: string | null;
  alert_id_tag: string | null;
  key_version: number;
  occurred_at: string;
  alert_reported_at: string;
  received_at: string;
  expires_at: string;
  delivered_at: string | null;
  read_at: string | null;
  expired_at: string | null;
}

interface FakeCall {
  operation: 'upsert' | 'select' | 'rpc';
  table: string;
  columns?: string;
  row?: Record<string, unknown>;
  options?: Record<string, unknown>;
  filter?: { column: string; value: unknown };
}

class FakeCrsClient {
  readonly monitoring = new Map<string, StoredMonitoringRow>();
  readonly pointers = new Map<string, StoredAlertPointerRow>();
  readonly enrollments: EnrollmentRow[] = [];
  readonly calls: FakeCall[] = [];
  writeFails = false;
  readFails = false;
  monitoringAuthorized = true;

  async rpc(name: string, args: Record<string, unknown>) {
    this.calls.push({ operation: 'rpc', table: name, row: args });
    return { data: this.monitoringAuthorized, error: this.readFails ? { code: 'FAKE_READ' } : null };
  }

  from(table: string) {
    return {
      upsert: async (row: StoredMonitoringRow | Omit<StoredAlertPointerRow, 'id' | 'delivered_at' | 'read_at' | 'expired_at'>, options: Record<string, unknown>) => {
        this.calls.push({ operation: 'upsert', table, row: { ...row }, options: { ...options } });
        if (this.writeFails) return { data: null, error: { code: 'FAKE_WRITE' } };
        if (table === 'monitoring_events') {
          const monitoring = row as StoredMonitoringRow;
          if (!this.monitoring.has(monitoring.id)) this.monitoring.set(monitoring.id, { ...monitoring });
        } else if (table === 'crs_alert_pointers') {
          const pointer = row as Omit<StoredAlertPointerRow, 'id' | 'delivered_at' | 'read_at' | 'expired_at'>;
          if (!this.pointers.has(pointer.provider_hook_key)) {
            this.pointers.set(pointer.provider_hook_key, {
              id: `pointer-${this.pointers.size + 1}`,
              ...pointer,
              delivered_at: null,
              read_at: null,
              expired_at: null,
            });
          }
        }
        return { data: null, error: null };
      },
      select: (columns: string) => ({
        eq: (column: string, value: unknown) => ({
          maybeSingle: async () => {
            this.calls.push({
              operation: 'select',
              table,
              columns,
              filter: { column, value },
            });
            if (this.readFails) return { data: null, error: { code: 'FAKE_READ' } };
            if (table === 'monitoring_events') {
              return {
                data: this.monitoring.get(String(value)) ?? null,
                error: null,
              };
            }
            if (table === 'crs_alert_pointers') {
              return {
                data: this.pointers.get(String(value)) ?? null,
                error: null,
              };
            }
            const row = this.enrollments.find(
              (entry) => entry[column as keyof EnrollmentRow] === value,
            );
            return { data: row ?? null, error: null };
          },
        }),
      }),
    };
  }
}

function asAdminClient(fake: FakeCrsClient): CrsAdminClient {
  return fake as unknown as CrsAdminClient;
}

const EVENT = {
  clientId: '53000000-0000-0000-0000-000000000101',
  eventType: 'ACCALERT',
  occurredAt: '2026-08-16T01:00:00.000Z',
  receivedAt: '2026-08-16T01:00:01.000Z',
};

describe('Supabase monitoring event store', () => {
  it('lazily writes and reads only the exact Phase 1 fields', async () => {
    const fake = new FakeCrsClient();
    let created = 0;
    const store = createSupabaseMonitoringEventStore({
      createClient: () => {
        created += 1;
        return asAdminClient(fake);
      },
    });
    assert.equal(created, 0);

    const result = await store.record(EVENT, createMonitoringProviderEventKey('provider-event-a'));
    assert.equal(created, 1);
    assert.match(result.id, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.deepEqual(Object.keys(fake.monitoring.get(result.id) ?? {}).sort(), [
      'client_id',
      'event_type',
      'id',
      'occurred_at',
      'received_at',
    ]);
    assert.deepEqual(fake.calls[0], {
      operation: 'upsert',
      table: 'monitoring_events',
      row: {
        id: result.id,
        client_id: EVENT.clientId,
        event_type: EVENT.eventType,
        occurred_at: EVENT.occurredAt,
        received_at: EVENT.receivedAt,
      },
      options: { onConflict: 'id', ignoreDuplicates: true },
    });
    assert.equal(JSON.stringify(fake.calls).includes('provider-event-a'), false);
  });

  it('collapses duplicates and rejects changed metadata under one key', async () => {
    const fake = new FakeCrsClient();
    const store = createSupabaseMonitoringEventStore({
      createClient: () => asAdminClient(fake),
    });
    const key = createMonitoringProviderEventKey('provider-event-b');
    const first = await store.record(EVENT, key);
    const second = await store.record({ ...EVENT }, key);
    assert.deepEqual(first, second);
    assert.equal(fake.monitoring.size, 1);

    await assert.rejects(
      store.record({ ...EVENT, eventType: 'REPORTREF' }, key),
      { message: 'MONITORING_EVENT_MISMATCH' },
    );
    assert.equal(fake.monitoring.get(first.id)?.event_type, EVENT.eventType);
  });

  it('accepts a later receipt time for the same hook and keeps the first receipt', async () => {
    const fake = new FakeCrsClient();
    const store = createSupabaseMonitoringEventStore({ createClient: () => asAdminClient(fake) });
    const key = createMonitoringProviderEventKey('provider-event-redelivery');
    const first = await store.record(EVENT, key);
    const second = await store.record({ ...EVENT, receivedAt: '2026-08-16T01:05:01.000Z' }, key);
    assert.deepEqual(second, first);
    assert.equal(fake.monitoring.get(first.id)?.received_at, EVENT.receivedAt);
  });

  it('stores only protected alert pointer material and collapses redelivery', async () => {
    const fake = new FakeCrsClient();
    const store = createSupabaseMonitoringEventStore({ createClient: () => asAdminClient(fake) });
    const codec = createCrsAlertPointerCodec('not-a-real-pointer-secret-at-least-32-bytes');
    const rawHookId = '550e8400-e29b-41d4-a716-446655440000';
    const rawAlertId = '550e8400-e29b-41d4-a716-446655440003';
    const key = codec.protectHookId(rawHookId);
    const pointer = codec.protectAlertId({
      alertId: rawAlertId,
      alertReportedAt: '2026-08-16T00:59:00.000Z',
      receivedAt: EVENT.receivedAt,
    });

    const first = await store.record(EVENT, key, pointer);
    const second = await store.record(
      { ...EVENT, receivedAt: '2026-08-16T01:05:01.000Z' },
      key,
      codec.protectAlertId({
        alertId: rawAlertId,
        alertReportedAt: '2026-08-16T00:59:00.000Z',
        receivedAt: '2026-08-16T01:05:01.000Z',
      }),
    );

    assert.deepEqual(second, first);
    assert.equal(fake.pointers.size, 1);
    assert.equal(JSON.stringify(fake.calls).includes(rawHookId), false);
    assert.equal(JSON.stringify(fake.calls).includes(rawAlertId), false);
  });

  it('assigns distinct ids to distinct keys and keeps errors fixed', async () => {
    const fake = new FakeCrsClient();
    const store = createSupabaseMonitoringEventStore({
      createClient: () => asAdminClient(fake),
    });
    const first = await store.record(EVENT, createMonitoringProviderEventKey('provider-event-c'));
    const second = await store.record(EVENT, createMonitoringProviderEventKey('provider-event-d'));
    assert.notEqual(first.id, second.id);

    fake.writeFails = true;
    await assert.rejects(
      store.record(EVENT, createMonitoringProviderEventKey('provider-event-e')),
      { message: 'MONITORING_EVENT_STORE_FAILED' },
    );
  });
});

describe('Supabase member-ref resolver', () => {
  it('resolves both directions with the exact status-aware projection', async () => {
    const fake = new FakeCrsClient();
    fake.enrollments.push({
      client_id: EVENT.clientId,
      crs_member_ref: 'mock_member_one',
      status: 'active',
    });
    const resolver = createSupabaseMemberRefResolver({
      createClient: () => asAdminClient(fake),
    });

    assert.equal(await resolver.resolveForClient(EVENT.clientId), 'mock_member_one');
    assert.equal(
      await resolver.resolveClientForMember('mock_member_one' as CrsMemberRef),
      EVENT.clientId,
    );
    assert.deepEqual(
      fake.calls.map((call) => ({
        table: call.table,
        columns: call.columns,
        filter: call.filter?.column,
      })),
      [
        { table: 'enrollments', columns: 'client_id,crs_member_ref,status', filter: 'client_id' },
        { table: 'monitoring_is_authorized', columns: undefined, filter: undefined },
        { table: 'enrollments', columns: 'client_id,crs_member_ref,status', filter: 'crs_member_ref' },
        { table: 'monitoring_is_authorized', columns: undefined, filter: undefined },
      ],
    );
  });

  it('returns no member in either direction after monitoring withdrawal', async () => {
    const fake = new FakeCrsClient();
    fake.enrollments.push({ client_id: EVENT.clientId, crs_member_ref: 'mock_member_one', status: 'active' });
    fake.monitoringAuthorized = false;
    const resolver = createSupabaseMemberRefResolver({ createClient: () => asAdminClient(fake) });
    await assert.rejects(resolver.resolveForClient(EVENT.clientId), { message: 'MONITORING_INACTIVE' });
    await assert.rejects(resolver.resolveClientForMember('mock_member_one' as CrsMemberRef), { message: 'MONITORING_INACTIVE' });
  });

  it('returns an explicit inactive result for a cancelled enrollment with a retained handle', async () => {
    const fake = new FakeCrsClient();
    fake.enrollments.push({ client_id: EVENT.clientId, crs_member_ref: 'mock_member_one', status: 'cancelled' });
    const resolver = createSupabaseMemberRefResolver({ createClient: () => asAdminClient(fake) });
    await assert.rejects(resolver.resolveForClient(EVENT.clientId), { message: 'MONITORING_INACTIVE' });
    await assert.rejects(resolver.resolveClientForMember('mock_member_one' as CrsMemberRef), { message: 'MONITORING_INACTIVE' });
    assert.equal(fake.calls.some((call) => call.operation === 'rpc'), false);
  });

  it('returns null for absent rows and fixed metadata for query failure', async () => {
    const fake = new FakeCrsClient();
    const resolver = createSupabaseMemberRefResolver({
      createClient: () => asAdminClient(fake),
    });
    assert.equal(await resolver.resolveForClient(EVENT.clientId), null);

    fake.readFails = true;
    await assert.rejects(resolver.resolveForClient(EVENT.clientId), {
      message: 'MEMBER_REF_LOOKUP_FAILED',
    });
  });
});
