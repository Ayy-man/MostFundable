import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CRS_ALERT_POINTER_FORBIDDEN_RAW_FIELDS,
  CRS_ALERT_POINTER_KEY_VERSION,
  CRS_ALERT_POINTER_RETENTION_DAYS,
} from './alert-storage-rule.ts';
import {
  createCrsAlertPointerCodec,
  readCrsAlertPointerSecret,
} from './alert-pointer.ts';

const SECRET = 'not-a-real-pointer-secret-at-least-32-bytes';
const ALERT_ID = '550e8400-e29b-41d4-a716-446655440003';
const HOOK_ID = '550e8400-e29b-41d4-a716-446655440000';
const RECEIVED_AT = '2026-08-31T01:00:01.000Z';

describe('CRS alert pointer protection', () => {
  it('encrypts the fetch id, HMACs both lookup ids, and derives expiry from the ruling', () => {
    const codec = createCrsAlertPointerCodec(SECRET);
    const pointer = codec.protectAlertId({
      alertId: ALERT_ID,
      alertReportedAt: '2026-08-31T00:59:00.000Z',
      receivedAt: RECEIVED_AT,
    });
    const hookKey = codec.protectHookId(HOOK_ID);

    assert.match(pointer.alertLookupKey, /^[0-9a-f]{64}$/);
    assert.match(hookKey, /^[0-9a-f]{64}$/);
    assert.notEqual(pointer.alertLookupKey, hookKey);
    assert.equal(JSON.stringify({ pointer, hookKey }).includes(ALERT_ID), false);
    assert.equal(JSON.stringify({ pointer, hookKey }).includes(HOOK_ID), false);
    assert.equal(pointer.keyVersion, CRS_ALERT_POINTER_KEY_VERSION);
    assert.equal(
      pointer.expiresAt,
      new Date(
        Date.parse(RECEIVED_AT)
          + CRS_ALERT_POINTER_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString(),
    );
    assert.equal(codec.openAlertId(pointer), ALERT_ID);
  });

  it('uses randomized ciphertext while keeping lookup keys stable across redelivery', () => {
    const codec = createCrsAlertPointerCodec(SECRET);
    const input = {
      alertId: ALERT_ID,
      alertReportedAt: '2026-08-31T00:59:00.000Z',
      receivedAt: RECEIVED_AT,
    };
    const first = codec.protectAlertId(input);
    const second = codec.protectAlertId(input);

    assert.equal(first.alertLookupKey, second.alertLookupKey);
    assert.notEqual(first.alertIdIv, second.alertIdIv);
    assert.notEqual(first.alertIdCiphertext, second.alertIdCiphertext);
  });

  it('fails closed for an absent, short, wrong, or tampered key', () => {
    assert.equal(readCrsAlertPointerSecret({} as NodeJS.ProcessEnv), null);
    assert.equal(readCrsAlertPointerSecret({
      CRS_ALERT_POINTER_SECRET: 'short',
    } as unknown as NodeJS.ProcessEnv), null);
    assert.throws(() => createCrsAlertPointerCodec('short'), { message: 'CRS_ALERT_POINTER_SECRET_INVALID' });

    const pointer = createCrsAlertPointerCodec(SECRET).protectAlertId({
      alertId: ALERT_ID,
      alertReportedAt: '2026-08-31T00:59:00.000Z',
      receivedAt: RECEIVED_AT,
    });
    assert.throws(
      () => createCrsAlertPointerCodec('a-different-pointer-secret-at-least-32-bytes').openAlertId(pointer),
      { message: 'CRS_ALERT_POINTER_OPEN_FAILED' },
    );
    assert.throws(
      () => createCrsAlertPointerCodec(SECRET).openAlertId({ ...pointer, alertIdTag: `${pointer.alertIdTag}x` }),
      { message: 'CRS_ALERT_POINTER_OPEN_FAILED' },
    );
  });

  it('keeps every rule-forbidden raw field out of the protected pointer shape', () => {
    const pointer = createCrsAlertPointerCodec(SECRET).protectAlertId({
      alertId: ALERT_ID,
      alertReportedAt: '2026-08-31T00:59:00.000Z',
      receivedAt: RECEIVED_AT,
    }) as unknown as Record<string, unknown>;
    for (const field of CRS_ALERT_POINTER_FORBIDDEN_RAW_FIELDS) {
      assert.equal(Object.hasOwn(pointer, field), false, `${field} crossed the storage boundary`);
    }
  });
});
