import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createFixedClock,
  createInMemoryMemberRefResolver,
  createInMemoryMonitoringEventStore,
} from './ports.ts';
import { createCrsAlertPointerCodec } from './alert-pointer.ts';
import { CRS_ALERT_POINTER_RETENTION_DAYS } from './alert-storage-rule.ts';
import {
  CRS_SPEC_WEBHOOK_ACK_FIELDS,
  CRS_SPEC_WEBHOOK_ALERT_FIELDS,
  CRS_SPEC_WEBHOOK_ALERT_TYPE,
  CRS_SPEC_WEBHOOK_CORE_FIELDS,
} from './spec-catalog.ts';
import { handleCrsWebhook } from './webhook-handler.ts';
import { parseWebhookBatchEntries } from './webhook.ts';

import type { CrsMemberRef } from './types.ts';
import type { CrsWebhookConfig } from './webhook.ts';

const HOOK_ID = '550e8400-e29b-41d4-a716-446655440000';
const MEMBER_ID = '550e8400-e29b-41d4-a716-446655440001' as CrsMemberRef;
const HOST_ID = '550e8400-e29b-41d4-a716-446655440002';
const ALERT_ID = '550e8400-e29b-41d4-a716-446655440003';
const CLIENT_ID = '53000000-0000-0000-0000-000000000101';
const CREATED_AT = Date.parse('2026-08-31T01:00:00.000Z');
const ALERT_AT = Date.parse('2026-08-31T00:59:00.000Z');
const BASIC_USER = 'phase1-user';
const BASIC_PASS = 'phase1-pass';
const POINTER_CODEC = createCrsAlertPointerCodec('phase1-pointer-secret-is-at-least-32-bytes');

const config: CrsWebhookConfig = {
  basicUser: BASIC_USER,
  basicPass: BASIC_PASS,
  hmacSecret: null,
  hmacHeader: 'x-crs-signature',
  sourceIps: [],
};

function authorization(): string {
  return `Basic ${Buffer.from(`${BASIC_USER}:${BASIC_PASS}`).toString('base64')}`;
}

function payload(): Record<string, unknown> {
  const values: Record<string, unknown> = {
    id: HOOK_ID,
    type: CRS_SPEC_WEBHOOK_ALERT_TYPE,
    user_id: MEMBER_ID,
    host_id: HOST_ID,
    time: CREATED_AT,
    alert_id: ALERT_ID,
    alert_date: ALERT_AT,
    alert_source: 'Equifax',
  };
  assert.deepEqual(
    [...CRS_SPEC_WEBHOOK_CORE_FIELDS, ...CRS_SPEC_WEBHOOK_ALERT_FIELDS]
      .every((field) => Object.hasOwn(values, field)),
    true,
  );
  return values;
}

describe('CRS Phase 1 webhook contract', () => {
  it('retains only the fetch pointer from a spec-catalogued ACCALERT parse', () => {
    const [entry] = parseWebhookBatchEntries({
      headers: new Headers({ authorization: authorization() }),
      rawBody: JSON.stringify([payload()]),
      config,
    }) as unknown as Array<{
      alertPointer?: { alertId: string; alertReportedAt: string };
      hookId: string | null;
      parse: { ok: boolean };
    }>;

    assert.equal(entry.parse.ok, true);
    assert.equal(entry.hookId, HOOK_ID);
    assert.deepEqual(entry.alertPointer, {
      alertId: ALERT_ID,
      alertReportedAt: new Date(ALERT_AT).toISOString(),
    });
  });

  it('acknowledges a later redelivery of the same stable hook id without a second row', async () => {
    const clock = createFixedClock('2026-08-31T01:00:01.000Z');
    const store = createInMemoryMonitoringEventStore();
    const input = {
      headers: new Headers({ authorization: authorization() }),
      rawBody: JSON.stringify([payload()]),
      config,
      store,
      resolver: createInMemoryMemberRefResolver([{ clientId: CLIENT_ID, memberRef: MEMBER_ID }]),
      clock,
      pointerCodec: POINTER_CODEC,
    };

    const first = await handleCrsWebhook(input);
    clock.advance(5 * 60 * 1000);
    const redelivery = await handleCrsWebhook(input);

    const permittedAckKeys = [...CRS_SPEC_WEBHOOK_ACK_FIELDS].sort();
    assert.deepEqual(Object.keys(first.body[0]).sort(), permittedAckKeys);
    assert.deepEqual(first.body, [{ hook_id: HOOK_ID, status: true }]);
    assert.deepEqual(redelivery.body, [{ hook_id: HOOK_ID, status: true }]);
    assert.equal(store.readAll().length, 1);
    const [storedPointer] = store.readAlertPointers();
    assert.equal(store.readAlertPointers().length, 1);
    assert.equal(POINTER_CODEC.openAlertId(storedPointer), ALERT_ID);
    assert.equal(JSON.stringify(storedPointer).includes(HOOK_ID), false);
    assert.equal(JSON.stringify(storedPointer).includes(ALERT_ID), false);
    assert.equal(
      storedPointer.expiresAt,
      new Date(
        Date.parse('2026-08-31T01:00:01.000Z')
          + CRS_ALERT_POINTER_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString(),
    );
  });
});
