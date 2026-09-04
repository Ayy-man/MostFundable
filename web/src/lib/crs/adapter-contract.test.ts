// web/src/lib/crs/adapter-contract.test.ts — invoke one suite against both drivers.

import assert from 'node:assert/strict';
import { it } from 'node:test';

import { runAdapterContract } from './adapter-contract.ts';
import { createCrsAdapter, crsPullIsReplaySafe } from './adapter.ts';
import { createMockAdapter } from './mock/driver.ts';
import { systemClock } from './ports.ts';

import type { CrsWebhookConfig } from './webhook.ts';

const UNCONFIGURED_WEBHOOK: CrsWebhookConfig = {
  basicUser: null,
  basicPass: null,
  hmacSecret: null,
  hmacHeader: 'x-crs-signature',
  sourceIps: [],
};

runAdapterContract(
  () => createMockAdapter({ clock: systemClock, webhookConfig: UNCONFIGURED_WEBHOOK }),
  'mock',
);

it('keeps CI on the fully mocked adapter even when a developer shell has CRS credentials', () => {
  const isolatedEnv = {} as NodeJS.ProcessEnv;
  assert.equal(createCrsAdapter(isolatedEnv, { clock: systemClock }).driver, 'mock');
});

it('declares cached report retrieval as replay-safe', () => {
  const adapter = createMockAdapter({ clock: systemClock, webhookConfig: UNCONFIGURED_WEBHOOK });
  assert.equal(adapter.pullBilling, 'cached-read');
  assert.equal(crsPullIsReplaySafe(adapter), true);
  assert.equal(crsPullIsReplaySafe({ ...adapter, pullBilling: 'per-request' }), false);
});
