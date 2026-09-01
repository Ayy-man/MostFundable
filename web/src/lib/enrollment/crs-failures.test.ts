import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CRS_SPEC_ERROR_CODES } from '@/lib/crs/spec-catalog';
import { crsEnrollmentFailure } from '@/lib/enrollment/crs-failures';

describe('CRS enrollment failure UI contract', () => {
  const scenarios = [
    { code: CRS_SPEC_ERROR_CODES.userAlreadyRegistered, action: 'resume_existing' },
    { code: CRS_SPEC_ERROR_CODES.ditRejected, action: 'stop' },
    { code: CRS_SPEC_ERROR_CODES.smfaTokenInvalidOrExpired, action: 'new_link' },
    { code: CRS_SPEC_ERROR_CODES.thinFile, action: 'stop' },
    { code: CRS_SPEC_ERROR_CODES.enrollmentError, action: 'retry_later' },
    { code: CRS_SPEC_ERROR_CODES.serviceUnavailable, action: 'retry_later' },
  ] as const;

  for (const scenario of scenarios) {
    it(`maps ${scenario.code} to its spec-derived existing-surface action`, () => {
      const result = crsEnrollmentFailure([scenario.code]);
      assert.equal(result.action, scenario.action);
      assert.ok(result.message.length > 0);
      assert.doesNotMatch(result.message, /quiz|review queue|manual review/i);
      if (
        scenario.code === CRS_SPEC_ERROR_CODES.enrollmentError ||
        scenario.code === CRS_SPEC_ERROR_CODES.serviceUnavailable
      ) {
        assert.match(result.message, /No charge was made/);
      }
    });
  }

  it('fails closed on an unknown provider code without reflecting it into copy', () => {
    const result = crsEnrollmentFailure(['SC999']);
    assert.equal(result.action, 'retry_later');
    assert.doesNotMatch(result.message, /SC999/);
    assert.doesNotMatch(result.message, /your identity|you failed|you could not be verified/i);
  });

  it('describes missing provider decision metadata as a provider fault', () => {
    const result = crsEnrollmentFailure([]);
    assert.equal(result.action, 'retry_later');
    assert.equal(result.message, 'The enrollment provider could not complete the request. Try again later.');
    assert.doesNotMatch(result.message, /your identity|enrollment did not start/i);
  });

  it('tells an existing CRS registrant to resume instead of retrying registration', () => {
    const result = crsEnrollmentFailure([CRS_SPEC_ERROR_CODES.userAlreadyRegistered]);
    assert.equal(result.action, 'resume_existing');
    assert.equal(
      result.message,
      'A verification account already exists for this email. Contact support to resume enrollment.',
    );
    assert.doesNotMatch(result.message, /try again later|identity failed|could not verify/i);
  });
});
