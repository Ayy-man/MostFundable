import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { setRouteFailureSink } from '@/lib/diagnostics/route-failure';

import { handleGetCreditScores } from './route.ts';

const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const SESSION = {
  disabledAt: null,
  id: '22222222-2222-4222-8222-222222222222',
  manages: [],
  orgId: '33333333-3333-4333-8333-333333333333',
  orgMembership: 'current' as const,
  orgRole: 'owner' as const,
  role: 'operator_member' as const,
};

function dependencies(overrides: Partial<Parameters<typeof handleGetCreditScores>[1]> = {}) {
  return {
    async clientReachable() { return true; },
    async readScores() {
      return {
        available: true,
        providerPayload: { report: 'must not pass through' },
        scores: [{ bureau: 'EQF', factors: ['must not pass through'], model: 'VANTAGE', observedAt: null, score: 825 }],
      };
    },
    async requireRole() { return SESSION; },
    trackerEnabled: () => true,
    ...overrides,
  } as NonNullable<Parameters<typeof handleGetCreditScores>[1]>;
}

function context(id = CLIENT_ID) {
  return { params: Promise.resolve({ id }) };
}

describe('operator credit-score route', () => {
  it('returns a tenant-scoped no-store response', async () => {
    const response = await handleGetCreditScores(context(), dependencies());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await response.json(), {
      available: true,
      scores: [{ bureau: 'EQF', model: 'VANTAGE', observedAt: null, score: 825 }],
    });
  });

  it('hides an unreachable client before touching CRS', async () => {
    let scoreReads = 0;
    const response = await handleGetCreditScores(context(), dependencies({
      async clientReachable() { return false; },
      async readScores() { scoreReads += 1; return { available: true, scores: [] }; },
    }));
    assert.equal(response.status, 404);
    assert.equal(scoreReads, 0);
  });

  it('rejects invalid ids and a disabled tracker before score access', async () => {
    assert.equal((await handleGetCreditScores(context('not-a-uuid'), dependencies())).status, 400);
    assert.equal((await handleGetCreditScores(context(), dependencies({ trackerEnabled: () => false }))).status, 503);
  });

  it('turns malformed provider results into a private 503 instead of a malformed 200', async () => {
    const failures: unknown[] = [];
    const malformed = [
      null,
      { available: true, scores: null },
      { available: true, scores: [] },
      { available: true, scores: [{ bureau: 'EFX', model: 'VANTAGE', observedAt: null, score: 825 }] },
      { available: true, scores: [{ bureau: 'EQF', model: 'VANTAGE', observedAt: null, score: 825.5 }] },
      { available: false, reason: 'provider_timeout' },
    ];
    const restore = setRouteFailureSink((record) => failures.push(record));
    try {
      for (const value of malformed) {
        const response = await handleGetCreditScores(context(), dependencies({
          async readScores() { return value; },
        }));
        assert.equal(response.status, 503);
        assert.equal(response.headers.get('cache-control'), 'private, no-store');
        const body = await response.json() as { correlationId?: unknown; error?: { code?: unknown } };
        assert.equal(body.error?.code, 'credit_scores_unavailable');
        assert.equal(typeof body.correlationId, 'string');
      }
    } finally {
      restore();
    }
    assert.equal(failures.length, malformed.length);
    const stableFailureFields = failures.map((value) => {
      const { at: _at, correlationId: _correlationId, ...record } = value as Record<string, unknown>;
      return record;
    });
    assert.doesNotMatch(JSON.stringify(stableFailureFields), /825|provider_timeout|must not pass through/);
  });
});
