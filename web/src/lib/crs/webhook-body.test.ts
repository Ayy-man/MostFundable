import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CRS_WEBHOOK_MAX_BATCH_COUNT, CRS_WEBHOOK_MAX_BODY_BYTES } from './constants.ts';
import { readBoundedWebhookBody } from './webhook-body.ts';

describe('bounded CRS webhook body', () => {
  it('rejects an oversized declared length before reading', async () => {
    const request = new Request('https://local.test', { method: 'POST', headers: { 'content-length': String(CRS_WEBHOOK_MAX_BODY_BYTES + 1) }, body: '[]' });
    assert.deepEqual(await readBoundedWebhookBody(request), { ok: false, status: 413 });
    assert.equal(request.bodyUsed, false);
  });

  it('enforces the byte limit when the header is missing', async () => {
    const body = 'x'.repeat(CRS_WEBHOOK_MAX_BODY_BYTES + 1);
    const request = new Request('https://local.test', { method: 'POST', body });
    request.headers.delete('content-length');
    assert.deepEqual(await readBoundedWebhookBody(request), { ok: false, status: 413 });
  });

  it('does not trust a false small declared length', async () => {
    const request = new Request('https://local.test', { method: 'POST', headers: { 'content-length': '2' }, body: 'x'.repeat(CRS_WEBHOOK_MAX_BODY_BYTES + 1) });
    assert.deepEqual(await readBoundedWebhookBody(request), { ok: false, status: 413 });
  });

  it('accepts the exact batch-count boundary', async () => {
    const rawBody = JSON.stringify(Array.from({ length: CRS_WEBHOOK_MAX_BATCH_COUNT }, () => ({})));
    assert.deepEqual(await readBoundedWebhookBody(new Request('https://local.test', { method: 'POST', body: rawBody })), { ok: true, rawBody });
  });

  it('rejects an over-boundary decoded batch before persistence', async () => {
    const rawBody = JSON.stringify(Array.from({ length: CRS_WEBHOOK_MAX_BATCH_COUNT + 1 }, () => ({})));
    assert.deepEqual(await readBoundedWebhookBody(new Request('https://local.test', { method: 'POST', body: rawBody })), { ok: false, status: 413 });
  });
});
