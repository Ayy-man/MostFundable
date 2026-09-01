import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeObservedCreditScores } from './scores.ts';

describe('CRS observed-score normalization', () => {
  it('keeps only current observed bureau numbers from the EFX 3B response', () => {
    assert.deepEqual(
      normalizeObservedCreditScores({
        generatedDate: 1_777_298_828_909,
        projectedScoreImprovement: 40,
        providerViews: [
          { provider: 'EFX', score: 825, scoreReasons: [{ description: 'not returned' }] },
          { provider: 'EXP', score: 761, scoreRanges: [{ low: 300, high: 850 }] },
          { provider: 'TU', score: 779, loanRiskRanges: [{ name: 'not returned' }] },
        ],
        scoreModel: 'VANTAGE',
      }),
      [
        { bureau: 'EQF', model: 'VANTAGE', observedAt: '2026-04-27T14:07:08.909Z', score: 825 },
        { bureau: 'EXP', model: 'VANTAGE', observedAt: '2026-04-27T14:07:08.909Z', score: 761 },
        { bureau: 'TUC', model: 'VANTAGE', observedAt: '2026-04-27T14:07:08.909Z', score: 779 },
      ],
    );
  });

  it('drops malformed and out-of-range bureau rows without inventing a score', () => {
    assert.deepEqual(normalizeObservedCreditScores({
      generatedDate: 'not-a-date',
      providerViews: [
        { provider: 'EFX', score: 299 },
        { provider: 'EXP', score: 851 },
        { provider: 'TU', score: 700.5 },
        { provider: 'UNKNOWN', score: 700 },
      ],
      scoreModel: 'not-a-model',
    }), []);
  });
});
