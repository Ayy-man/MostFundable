import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MonitoringInactiveError } from './ports.ts';
import { readOperatorCreditScores } from './operator-scores.ts';

const MEMBER = 'mock_clean_000001' as import('./types.ts').CrsMemberRef;

describe('operator CRS score read', () => {
  it('resolves from the scoped client id and returns only observed scores', async () => {
    const result = await readOperatorCreditScores('client-a', {
      adapter: {
        driver: 'mock',
        async getLatestScores(memberRef) {
          assert.equal(memberRef, MEMBER);
          return [{ bureau: 'EQF', model: 'VANTAGE', observedAt: null, score: 825 }];
        },
      },
      resolver: { async resolveForClient(clientId) { assert.equal(clientId, 'client-a'); return MEMBER; } },
    });
    assert.deepEqual(result, {
      available: true,
      scores: [{ bureau: 'EQF', model: 'VANTAGE', observedAt: null, score: 825 }],
    });
  });

  it('distinguishes missing enrollment, inactive consent and no provider score', async () => {
    const adapter = { driver: 'mock' as const, async getLatestScores() { return []; } };
    assert.deepEqual(await readOperatorCreditScores('client-a', {
      adapter,
      resolver: { async resolveForClient() { return null; } },
    }), { available: false, reason: 'not_enrolled' });
    assert.deepEqual(await readOperatorCreditScores('client-a', {
      adapter,
      resolver: { async resolveForClient() { throw new MonitoringInactiveError(); } },
    }), { available: false, reason: 'monitoring_inactive' });
    assert.deepEqual(await readOperatorCreditScores('client-a', {
      adapter,
      resolver: { async resolveForClient() { return MEMBER; } },
    }), { available: false, reason: 'no_score' });
  });

  it('does not send a legacy mock handle to the live provider', async () => {
    let providerCalls = 0;
    const result = await readOperatorCreditScores('client-a', {
      adapter: {
        driver: 'sandbox',
        async getLatestScores() {
          providerCalls += 1;
          return [];
        },
      },
      resolver: { async resolveForClient() { return MEMBER; } },
    });

    assert.deepEqual(result, { available: false, reason: 'not_enrolled' });
    assert.equal(providerCalls, 0);
  });
});
