import type { BureauCode, ObservedCreditScore } from './types.ts';

const BUREAU_BY_PROVIDER: Readonly<Record<string, BureauCode | undefined>> = {
  EFX: 'EQF',
  EQF: 'EQF',
  EXP: 'EXP',
  TU: 'TUC',
  TUC: 'TUC',
};

const SCORE_MODELS = new Set<ObservedCreditScore['model']>([
  'VANTAGE',
  'VANTAGE_SCORE_4',
  'FICO',
  'ERS',
  'UNKNOWN',
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function observedAt(value: unknown): string | null {
  const instant = typeof value === 'number' ? value : Date.parse(String(value));
  return Number.isFinite(instant) ? new Date(instant).toISOString() : null;
}

/**
 * Reduce CRS's EFX 1B/3B response to the only fields the operator tracker may
 * receive. A malformed provider row is omitted, so one bureau outage does not
 * erase the valid bureaus beside it.
 */
export function normalizeObservedCreditScores(value: unknown): readonly ObservedCreditScore[] {
  if (!isObject(value) || !Array.isArray(value.providerViews)) return [];
  const model = typeof value.scoreModel === 'string' && SCORE_MODELS.has(value.scoreModel as ObservedCreditScore['model'])
    ? value.scoreModel as ObservedCreditScore['model']
    : 'UNKNOWN';
  const generatedAt = observedAt(value.generatedDate);

  return value.providerViews.flatMap((view): ObservedCreditScore[] => {
    if (!isObject(view) || typeof view.provider !== 'string') return [];
    const bureau = BUREAU_BY_PROVIDER[view.provider];
    const score = view.score;
    if (bureau === undefined || typeof score !== 'number' || !Number.isInteger(score) || score < 300 || score > 850) {
      return [];
    }
    return [{ bureau, model, observedAt: generatedAt, score }];
  });
}
