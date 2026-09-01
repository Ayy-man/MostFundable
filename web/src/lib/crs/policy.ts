import {
  CRS_FORBIDDEN_SCORE_PROJECTION_ENDPOINTS,
  CRS_SCORE_PROJECTION_RESPONSE_FIELD_PREFIXES,
  CRS_SCORE_PROJECTION_RESPONSE_FIELDS,
} from './spec-catalog.ts';

const POLICY_ORIGIN = 'https://crs-policy.invalid';

export class CrsCompliancePolicyError extends Error {
  constructor() {
    super('CRS request blocked by compliance policy');
    this.name = 'CrsCompliancePolicyError';
  }
}

function normalizedPath(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) throw new CrsCompliancePolicyError();

  let decoded: string;
  try {
    decoded = decodeURIComponent(new URL(path, POLICY_ORIGIN).pathname);
  } catch {
    throw new CrsCompliancePolicyError();
  }

  const collapsed = decoded.replace(/\/{2,}/g, '/').replace(/\/+$/, '').toLowerCase();
  return collapsed === '' ? '/' : collapsed;
}

function isForbiddenEndpoint(path: string): boolean {
  const normalized = normalizedPath(path);
  return CRS_FORBIDDEN_SCORE_PROJECTION_ENDPOINTS.some((endpoint) => {
    const denied = endpoint.path.toLowerCase();
    const start = normalized.lastIndexOf(denied);
    if (start < 0) return false;
    const suffix = normalized.slice(start + denied.length);
    return suffix === '' || (endpoint.includesDescendants && suffix.startsWith('/'));
  });
}

/**
 * The only URL construction seam for outbound CRS traffic.
 *
 * Numeric score-gain claims are blocked by product policy. Keep the denial before string
 * construction so callers cannot obtain a URL for either CRS projection
 * product, including Optimal Path configuration descendants.
 */
export function buildCrsRequestUrl(baseUrl: string, path: string): string {
  if (isForbiddenEndpoint(path)) throw new CrsCompliancePolicyError();

  const constructed = `${baseUrl}${path}`;
  let constructedPath: string;
  try {
    constructedPath = new URL(constructed).pathname;
  } catch {
    throw new CrsCompliancePolicyError();
  }
  if (isForbiddenEndpoint(constructedPath)) throw new CrsCompliancePolicyError();
  return constructed;
}

function isScoreProjectionField(key: string): boolean {
  const normalized = key.toLowerCase();
  return CRS_SCORE_PROJECTION_RESPONSE_FIELDS.some(
    (field) => field.toLowerCase() === normalized,
  ) || CRS_SCORE_PROJECTION_RESPONSE_FIELD_PREFIXES.some(
    (prefix) => normalized.startsWith(prefix.toLowerCase()),
  );
}

/**
 * Remove projection claims from provider JSON before any CRS adapter can inspect, seal, or derive
 * from it. Observed scores and unrelated report fields remain intact.
 */
export function stripCrsScoreProjectionFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripCrsScoreProjectionFields);
  if (typeof value !== 'object' || value === null) return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !isScoreProjectionField(key))
      .map(([key, child]) => [key, stripCrsScoreProjectionFields(child)]),
  );
}
