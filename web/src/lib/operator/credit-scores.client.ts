import type { ObservedCreditScore } from '@/lib/crs/types';

export type OperatorCreditScoresRead =
  | { readonly state: 'idle' | 'loading' }
  | { readonly state: 'failed' }
  | { readonly state: 'unavailable'; readonly reason: 'monitoring_inactive' | 'not_enrolled' | 'no_score' }
  | { readonly state: 'ready'; readonly scores: readonly ObservedCreditScore[] };

export type CreditScoresResponse =
  | { readonly available: true; readonly scores: readonly ObservedCreditScore[] }
  | { readonly available: false; readonly reason: 'monitoring_inactive' | 'not_enrolled' | 'no_score' };

const BUREAUS = new Set<ObservedCreditScore['bureau']>(['EQF', 'EXP', 'TUC']);
const MODELS = new Set<ObservedCreditScore['model']>([
  'VANTAGE',
  'VANTAGE_SCORE_4',
  'FICO',
  'ERS',
  'UNKNOWN',
]);
const UNAVAILABLE_REASONS = new Set<Extract<CreditScoresResponse, { available: false }>['reason']>([
  'monitoring_inactive',
  'not_enrolled',
  'no_score',
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isObservedAt(value: unknown): value is string | null {
  return value === null
    || (typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value)));
}

function parseObservedCreditScore(value: unknown): ObservedCreditScore | null {
  const row = asRecord(value);
  if (
    row === null
    || typeof row.bureau !== 'string'
    || !BUREAUS.has(row.bureau as ObservedCreditScore['bureau'])
    || typeof row.model !== 'string'
    || !MODELS.has(row.model as ObservedCreditScore['model'])
    || !isObservedAt(row.observedAt)
    || typeof row.score !== 'number'
    || !Number.isSafeInteger(row.score)
    || row.score < 300
    || row.score > 850
  ) {
    return null;
  }
  return {
    bureau: row.bureau as ObservedCreditScore['bureau'],
    model: row.model as ObservedCreditScore['model'],
    observedAt: row.observedAt,
    score: row.score,
  };
}

/**
 * Validate the complete observed-score list at every JSON boundary. A single
 * malformed row invalidates the snapshot: rendering the remaining rows would
 * make an upstream contract failure look like a complete current bureau read.
 */
export function parseObservedCreditScores(value: unknown): readonly ObservedCreditScore[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const scores: ObservedCreditScore[] = [];
  for (const entry of value) {
    const score = parseObservedCreditScore(entry);
    if (score === null) return null;
    scores.push(score);
  }
  return scores;
}

/** Parse and narrow the route response instead of trusting a successful HTTP status. */
export function parseCreditScoresResponse(value: unknown): CreditScoresResponse | null {
  const body = asRecord(value);
  if (body === null || typeof body.available !== 'boolean') return null;
  if (body.available) {
    const scores = parseObservedCreditScores(body.scores);
    return scores === null ? null : { available: true, scores };
  }
  if (
    typeof body.reason !== 'string'
    || !UNAVAILABLE_REASONS.has(body.reason as Extract<CreditScoresResponse, { available: false }>['reason'])
  ) {
    return null;
  }
  return {
    available: false,
    reason: body.reason as Extract<CreditScoresResponse, { available: false }>['reason'],
  };
}

export async function readOperatorCreditScores(
  clientId: string,
  fetcher: typeof fetch = fetch,
): Promise<OperatorCreditScoresRead> {
  try {
    const response = await fetcher(`/api/clients/${encodeURIComponent(clientId)}/credit-scores`, {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!response.ok) return { state: 'failed' };
    const result = parseCreditScoresResponse(await response.json());
    if (result === null) return { state: 'failed' };
    return result.available
      ? { scores: result.scores, state: 'ready' }
      : { reason: result.reason, state: 'unavailable' };
  } catch {
    return { state: 'failed' };
  }
}
