import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFixedClock } from '../crs/ports.ts';
import { CRS_SPEC_HOSTS, CRS_SPEC_PATHS } from '../crs/spec-catalog.ts';
import { createSandboxAdapter } from '../crs/sandbox/driver.ts';

import type { CrsMemberRef } from '../crs/types.ts';

const MEMBER = '550e8400-e29b-41d4-a716-446655440000' as CrsMemberRef;
const DIRECT_TOKEN = 'not-a-real-direct-token';
const PREAUTH_TOKEN = 'not-a-real-preauth-token';
const USER_TOKEN = 'not-a-real-user-token';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('CRS report replay under the 2026-08-27 contract', () => {
  it('replays the provider-cached GET and never constructs the obsolete billable POST fanout', async () => {
    const calls: Array<{ method: string; path: string; idempotency: string | null }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const requestPath = new URL(String(input)).pathname.replace('/api', '');
      calls.push({
        method: init?.method ?? 'GET',
        path: requestPath,
        idempotency: new Headers(init?.headers).get('idempotency-key'),
      });
      if (requestPath === CRS_SPEC_PATHS.directLogin) {
        return json({ token: DIRECT_TOKEN, expires: 3600, refresh: 'not-a-real-refresh-token' });
      }
      if (requestPath === CRS_SPEC_PATHS.directPreauthToken.replace('{id}', MEMBER)) {
        return json({ userId: MEMBER, token: PREAUTH_TOKEN });
      }
      if (requestPath === CRS_SPEC_PATHS.userPreauthExchange.replace('{preauthToken}', PREAUTH_TOKEN)) {
        return json({ id: MEMBER, token: USER_TOKEN, expires: 900, refresh: 'not-a-real-user-refresh' });
      }
      if (requestPath === CRS_SPEC_PATHS.latestEquifaxReport) {
        return json({ id: 'provider-cached-report', reportType: 'US_EFX', providerViews: [] });
      }
      throw new Error(`unexpected test path ${requestPath}`);
    };
    const adapter = createSandboxAdapter({
      baseUrl: CRS_SPEC_HOSTS.development.api,
      apiKey: 'not-a-real-api-key',
      exposeVerificationUrl: false,
      secret: 'not-a-real-api-secret',
      timeoutMs: 1_000,
    }, {
      clock: createFixedClock('2026-08-29T01:00:00.000Z'),
      webhookConfig: {
        basicUser: null,
        basicPass: null,
        hmacSecret: null,
        hmacHeader: 'x-crs-signature',
        sourceIps: [],
      },
      fetchImpl,
    });

    await adapter.softPull(MEMBER, ['EQF1001'], { idempotencyKey: 'first-worker-attempt' });
    await adapter.softPull(MEMBER, ['EQF1001'], { idempotencyKey: 'recovered-worker-attempt' });

    const reportCalls = calls.filter((call) => call.path === CRS_SPEC_PATHS.latestEquifaxReport);
    assert.equal(reportCalls.length, 2);
    assert.ok(reportCalls.every((call) => call.method === 'GET'));
    assert.ok(reportCalls.every((call) => call.idempotency === null));
    assert.ok(calls.every((call) => !call.path.includes('/direct/credit-report/')));
  });
});
