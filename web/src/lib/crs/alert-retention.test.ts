import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CRS_ALERT_POINTER_RETENTION_DAYS } from './alert-storage-rule.ts';
import { runCrsAlertBatch } from './alert-retention.ts';

describe('CRS alert pointer retention job', () => {
  it('hands the repository a bounded scrub at the rule-derived expiry instant', async () => {
    const receivedAt = new Date('2026-08-31T01:00:01.000Z');
    const expiry = new Date(
      receivedAt.getTime() + CRS_ALERT_POINTER_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    const calls: Array<{ limit: number; now: string }> = [];

    const result = await runCrsAlertBatch('global', '2026-11-29', {
      now: () => expiry,
      repository: {
        async scrubExpired(now, limit) {
          calls.push({ now, limit });
          return 3;
        },
      },
    });

    assert.deepEqual(calls, [{ now: expiry.toISOString(), limit: 500 }]);
    assert.deepEqual(result, { status: 'ok', rows: 3 });
  });

  it('fails with fixed metadata for invalid scope or repository failure', async () => {
    assert.deepEqual(await runCrsAlertBatch('org:not-global', '2026-11-29'), {
      status: 'failed',
      code: 'CRS_ALERT_BATCH_SUBJECT_INVALID',
    });
    assert.deepEqual(await runCrsAlertBatch('global', '2026-11-29', {
      repository: { async scrubExpired() { throw new Error('secret database detail'); } },
    }), {
      status: 'failed',
      code: 'CRS_ALERT_POINTER_PURGE_FAILED',
    });
  });
});
