import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  parseCreditScoresResponse,
  readOperatorCreditScores,
} from './credit-scores.client.ts';

const SCORE = {
  bureau: 'EQF',
  model: 'VANTAGE',
  observedAt: '2026-08-30T00:00:00.000Z',
  score: 825,
} as const;

function stubFetch(body: unknown, status = 200): typeof fetch {
  return (async () => Response.json(body, { status })) as unknown as typeof fetch;
}

describe('operator credit-score response contract', () => {
  it('accepts only the closed bureau and model vocabularies and valid score bounds', () => {
    const parsed = parseCreditScoresResponse({
      available: true,
      scores: [
        { bureau: 'EQF', model: 'VANTAGE', observedAt: null, score: 300 },
        { bureau: 'EXP', model: 'VANTAGE_SCORE_4', observedAt: SCORE.observedAt, score: 700 },
        { bureau: 'TUC', model: 'FICO', observedAt: SCORE.observedAt, score: 848 },
        { bureau: 'EQF', model: 'ERS', observedAt: SCORE.observedAt, score: 849 },
        { bureau: 'EXP', model: 'UNKNOWN', observedAt: SCORE.observedAt, score: 850 },
      ],
    });
    assert.equal(parsed?.available, true);
    assert.deepEqual(parsed?.available ? parsed.scores.map((score) => score.score) : [], [300, 700, 848, 849, 850]);
  });

  it('rejects nullable, partial, unknown, fractional and out-of-range score payloads', () => {
    const malformed: readonly unknown[] = [
      null,
      { available: null, scores: [SCORE] },
      { available: true, scores: null },
      { available: true, scores: [] },
      { available: true, scores: [null] },
      { available: true, scores: [{ ...SCORE, bureau: 'EFX' }] },
      { available: true, scores: [{ ...SCORE, model: null }] },
      { available: true, scores: [{ ...SCORE, model: 'VANTAGE_3' }] },
      { available: true, scores: [{ ...SCORE, observedAt: 'not-a-date' }] },
      { available: true, scores: [{ ...SCORE, observedAt: false }] },
      { available: true, scores: [{ ...SCORE, score: null }] },
      { available: true, scores: [{ ...SCORE, score: '825' }] },
      { available: true, scores: [{ ...SCORE, score: 299 }] },
      { available: true, scores: [{ ...SCORE, score: 700.5 }] },
      { available: true, scores: [{ ...SCORE, score: 851 }] },
      { available: true, scores: [{ ...SCORE, score: Number.NaN }] },
      { available: true, scores: [{ ...SCORE, score: Number.POSITIVE_INFINITY }] },
      { available: false, reason: null },
      { available: false, reason: 'provider_timeout' },
    ];
    for (const body of malformed) {
      assert.equal(parseCreditScoresResponse(body), null, JSON.stringify(body));
    }
  });

  it('constructs a narrow response instead of forwarding extra upstream fields', () => {
    assert.deepEqual(parseCreditScoresResponse({
      available: true,
      providerPayload: { report: 'must not pass through' },
      scores: [{ ...SCORE, factors: ['must not pass through'] }],
    }), { available: true, scores: [SCORE] });
    for (const reason of ['monitoring_inactive', 'not_enrolled', 'no_score'] as const) {
      assert.deepEqual(parseCreditScoresResponse({ available: false, debug: 'drop', reason }), {
        available: false,
        reason,
      });
    }
  });
});

describe('operator credit-score read', () => {
  it('returns ready only after validating the successful JSON body', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const result = await readOperatorCreditScores('client/id', (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      calls.push({ init, input: String(input) });
      return Response.json({ available: true, scores: [SCORE] });
    }) as unknown as typeof fetch);
    assert.deepEqual(result, { scores: [SCORE], state: 'ready' });
    assert.deepEqual(calls, [{
      init: { cache: 'no-store', credentials: 'same-origin' },
      input: '/api/clients/client%2Fid/credit-scores',
    }]);
  });

  it('maps every malformed 200 to failed instead of returning a ready value', async () => {
    for (const body of [
      null,
      { available: true, scores: null },
      { available: true, scores: [{ ...SCORE, bureau: 'EFX' }] },
      { available: false, reason: 'provider_timeout' },
    ]) {
      assert.deepEqual(await readOperatorCreditScores('client-a', stubFetch(body)), { state: 'failed' });
    }
  });

  it('keeps explicit unavailable reasons separate from HTTP and transport failures', async () => {
    assert.deepEqual(
      await readOperatorCreditScores('client-a', stubFetch({ available: false, reason: 'no_score' })),
      { reason: 'no_score', state: 'unavailable' },
    );
    assert.deepEqual(await readOperatorCreditScores('client-a', stubFetch({ error: 'down' }, 503)), {
      state: 'failed',
    });
    const dropped = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    assert.deepEqual(await readOperatorCreditScores('client-a', dropped), { state: 'failed' });
  });
});
