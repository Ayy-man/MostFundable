import { CRS_SPEC_ERROR_CODES } from '@/lib/crs/spec-catalog';

export type CrsEnrollmentFailureAction = 'stop' | 'resume_existing' | 'new_link' | 'retry_later';

export type CrsEnrollmentFailure = {
  action: CrsEnrollmentFailureAction;
  message: string;
};

/**
 * Existing-surface copy for CRS's deterministic sandbox and production failures. The stable code
 * selects the behavior; provider messages and details never reach the browser.
 */
export function crsEnrollmentFailure(codes: readonly string[]): CrsEnrollmentFailure {
  if (codes.includes(CRS_SPEC_ERROR_CODES.userAlreadyRegistered)) {
    return {
      action: 'resume_existing',
      message: 'A verification account already exists for this email. Contact support to resume enrollment.',
    };
  }
  if (codes.includes(CRS_SPEC_ERROR_CODES.ditRejected)) {
    return {
      action: 'stop',
      message: 'We could not verify your identity, so enrollment did not start. Contact support for another verification option.',
    };
  }
  if (codes.includes(CRS_SPEC_ERROR_CODES.smfaTokenInvalidOrExpired)) {
    return {
      action: 'new_link',
      message: 'The secure verification link expired. Request a new link and try again.',
    };
  }
  if (codes.includes(CRS_SPEC_ERROR_CODES.thinFile)) {
    return {
      action: 'stop',
      message: 'We could not enroll this credit file in monitoring. No charge was made. Contact support for available options.',
    };
  }
  if (
    codes.includes(CRS_SPEC_ERROR_CODES.enrollmentError) ||
    codes.includes(CRS_SPEC_ERROR_CODES.enrollmentFeatureError) ||
    codes.includes(CRS_SPEC_ERROR_CODES.serviceUnavailable)
  ) {
    return {
      action: 'retry_later',
      message: 'The monitoring provider could not complete enrollment. No charge was made. Try again later.',
    };
  }
  return {
    action: 'retry_later',
    message: 'The enrollment provider could not complete the request. Try again later.',
  };
}
