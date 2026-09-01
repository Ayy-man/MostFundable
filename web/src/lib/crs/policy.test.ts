import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CRS_FORBIDDEN_SCORE_PROJECTION_ENDPOINTS,
  CRS_SCORE_PROJECTION_RESPONSE_FIELD_PREFIXES,
  CRS_SCORE_PROJECTION_RESPONSE_FIELDS,
} from './spec-catalog.ts';
import {
  buildCrsRequestUrl,
  CrsCompliancePolicyError,
  stripCrsScoreProjectionFields,
} from './policy.ts';

const BASE_URL = 'https://crs.invalid/api';

function endpointVariants(path: string): readonly string[] {
  return [
    path,
    `${path}/`,
    `${path}?test=spec-derived`,
    path.replaceAll('-', '%2D'),
    path.toUpperCase(),
  ];
}

function projectedKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(projectedKeys);
  if (typeof value !== 'object' || value === null) return [];

  return Object.entries(value).flatMap(([key, child]) => {
    const exact = CRS_SCORE_PROJECTION_RESPONSE_FIELDS.some(
      (field) => field.toLowerCase() === key.toLowerCase(),
    );
    const prefixed = CRS_SCORE_PROJECTION_RESPONSE_FIELD_PREFIXES.some((prefix) =>
      key.toLowerCase().startsWith(prefix.toLowerCase()),
    );
    return [...(exact || prefixed ? [key] : []), ...projectedKeys(child)];
  });
}

describe('CRS score-projection compliance policy', () => {
  it('refuses every spec-catalogued projection endpoint before a URL can be constructed', () => {
    for (const endpoint of CRS_FORBIDDEN_SCORE_PROJECTION_ENDPOINTS) {
      for (const path of endpointVariants(endpoint.path)) {
        assert.throws(
          () => buildCrsRequestUrl(BASE_URL, path),
          CrsCompliancePolicyError,
          `constructed prohibited CRS URL for ${path}`,
        );
      }

      if (endpoint.includesDescendants) {
        assert.throws(
          () => buildCrsRequestUrl(BASE_URL, `${endpoint.path}/spec-derived-config`),
          CrsCompliancePolicyError,
          `constructed prohibited CRS descendant URL for ${endpoint.path}`,
        );
      }

      const segments = endpoint.path.split('/').filter(Boolean);
      const lastSegment = segments.at(-1);
      assert.ok(lastSegment);
      assert.throws(
        () => buildCrsRequestUrl(
          `${BASE_URL}/${segments.slice(0, -1).join('/')}`,
          `/${lastSegment}`,
        ),
        CrsCompliancePolicyError,
        `constructed prohibited CRS URL by splitting ${endpoint.path} across base and path`,
      );
    }
  });

  it('recursively strips every spec-catalogued projection field without removing observed scores', () => {
    const exactFields = Object.fromEntries(
      CRS_SCORE_PROJECTION_RESPONSE_FIELDS.map((field, index) => [field, index + 1]),
    );
    const prefixedFields = Object.fromEntries(
      CRS_SCORE_PROJECTION_RESPONSE_FIELD_PREFIXES.map((prefix, index) => [
        `${prefix}specDerivedAttribute`,
        index + 1,
      ]),
    );
    const providerResponse = {
      score: 700,
      nested: [{ safe: true, ...exactFields }, { observedScore: 701, ...prefixedFields }],
    };

    const stripped = stripCrsScoreProjectionFields(providerResponse);

    assert.deepEqual(projectedKeys(stripped), []);
    assert.deepEqual(stripped, {
      score: 700,
      nested: [{ safe: true }, { observedScore: 701 }],
    });
    assert.notEqual(stripped, providerResponse);
    assert.notDeepEqual(projectedKeys(providerResponse), []);
  });
});
