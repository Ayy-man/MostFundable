import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  SUPPORT_DRAFT_CONFIDENCE_THRESHOLD_DEFAULT,
  resolveDraftConfidenceThreshold,
} from './config.ts';

function throwsConfigInvalid(raw: string): void {
  assert.throws(
    () => resolveDraftConfidenceThreshold({ SUPPORT_DRAFT_CONFIDENCE_THRESHOLD: raw }),
    (error: unknown) =>
      error instanceof Error &&
      (error as { code?: string }).code === 'SUPPORT_CONFIG_INVALID',
    `expected ${JSON.stringify(raw)} to be refused`,
  );
}

describe('draft confidence threshold', () => {
  it('falls back when the key is absent', () => {
    assert.equal(resolveDraftConfidenceThreshold({}), SUPPORT_DRAFT_CONFIDENCE_THRESHOLD_DEFAULT);
    assert.equal(resolveDraftConfidenceThreshold({}), 0.7);
  });

  // A blank value counts as absent everywhere in this repo — `isBlank()` in
  // env.ts, and the promise at the top of `.env.example` that a verbatim copy
  // boots the stack on mocks. This key ships in that file as a bare `NAME=`,
  // so treating a blank as invalid would break the copy it appears in.
  it('treats a blank value as absent', () => {
    assert.equal(resolveDraftConfidenceThreshold({ SUPPORT_DRAFT_CONFIDENCE_THRESHOLD: '' }), 0.7);
    assert.equal(
      resolveDraftConfidenceThreshold({ SUPPORT_DRAFT_CONFIDENCE_THRESHOLD: '   ' }),
      0.7,
    );
  });

  it('accepts both ends of the interval and a value inside it', () => {
    assert.equal(resolveDraftConfidenceThreshold({ SUPPORT_DRAFT_CONFIDENCE_THRESHOLD: '0' }), 0);
    assert.equal(resolveDraftConfidenceThreshold({ SUPPORT_DRAFT_CONFIDENCE_THRESHOLD: '1' }), 1);
    assert.equal(
      resolveDraftConfidenceThreshold({ SUPPORT_DRAFT_CONFIDENCE_THRESHOLD: '0.85' }),
      0.85,
    );
    assert.equal(
      resolveDraftConfidenceThreshold({ SUPPORT_DRAFT_CONFIDENCE_THRESHOLD: ' 0.55 ' }),
      0.55,
    );
  });

  it('refuses anything that is not a number in the unit interval', () => {
    for (const raw of ['abc', '-0.1', '1.1', 'NaN', 'Infinity', '0.5x', '1e400']) {
      throwsConfigInvalid(raw);
    }
  });

  it('reads lazily, so a later environment change is picked up', () => {
    const env: Record<string, string | undefined> = {};
    assert.equal(resolveDraftConfidenceThreshold(env), 0.7);
    env.SUPPORT_DRAFT_CONFIDENCE_THRESHOLD = '0.42';
    assert.equal(resolveDraftConfidenceThreshold(env), 0.42);
  });
});
