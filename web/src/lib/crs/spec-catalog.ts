/**
 * Security-relevant CRS v3 contract facts, transcribed from the client spec updated 2026-08-27.
 *
 * Source: https://crsintegration.redocly.app/client-spec
 * OpenAPI version: v3
 *
 * Tests and enforcement both consume this catalog so a spec reconciliation changes one dated
 * source of truth rather than copying endpoint or response-field literals into reproductions.
 */
export const CRS_SPEC_UPDATED_AT = '2026-08-27' as const;

export const CRS_SPEC_HOSTS = {
  development: {
    api: 'https://efx-dev.stitchcredit.com/api',
    widget: 'https://efx-dev.stitchcredit.com',
  },
  production: {
    api: 'https://efx-wgt.stitchcredit.com/api',
    widget: 'https://wgt.stitchcredit.com',
  },
} as const;

export const CRS_SPEC_PATHS = {
  directLogin: '/direct/login',
  directRefresh: '/direct/refresh-token',
  directUserRegistration: '/direct/user-reg',
  directPreauthToken: '/direct/preauth-token/{id}',
  userPreauthExchange: '/users/preauth-token/{preauthToken}',
  ditIdentity: '/users/dit-identity',
  smfaSendLink: '/users/smfa-send-link/{ditToken}',
  smfaVerifyStatus: '/users/smfa-verify-status/{smfaToken}',
  latestEquifaxScores: '/users/efx-latest-scores',
  latestEquifaxReport: '/users/efx-latest-report',
  latestMultiBureauReport: '/users/latest-report',
  closeAccount: '/direct/close-account/{id}',
  pauseEnrollment: '/direct/users/{userId}/pause-enrollment',
  resumeEnrollment: '/direct/users/{userId}/resume-enrollment',
} as const;

export const CRS_SPEC_TOKEN_TTLS_SECONDS = {
  direct: 60 * 60,
  directRefresh: 2 * 60 * 60,
  preauth: 30,
  user: 15 * 60,
  userRefresh: 30 * 60,
  dit: 15 * 60,
  smfaSession: 15 * 60,
} as const;

export const CRS_SPEC_DIT_PASS_STATUS = 'Approve' as const;
export const CRS_SPEC_DIT_FAILURE_STATUSES = ['Review', 'Deny'] as const;
export const CRS_SPEC_SMFA_PASS_STATUSES = ['GREEN', 'YELLOW'] as const;
export const CRS_SPEC_SMFA_FAILURE_STATUSES = ['ORANGE', 'RED'] as const;
export const CRS_SPEC_SMFA_PENDING_STATUS = 'INCOMPLETE' as const;
export const CRS_SPEC_SMFA_CHALLENGE_KIND = 'smfa_link' as const;
export const CRS_SPEC_IDV_SUBMISSION_KIND = 'smfa_status' as const;
export const CRS_SPEC_TRANSIENT_IDENTITY_KEYS = [
  'dateOfBirth',
  'ssn',
  'address',
] as const;

export const CRS_SPEC_WEBHOOK_EVENT_TYPES = [
  'ACCNEW',
  'IDFAIL',
  'ACCREG',
  'ACCREGFAIL',
  'ACCCLOSED',
  'ACCLOCKED',
  'ACCLOGINFAIL',
  'ACCALERT',
  'SCOREREF',
  'REPORTREF',
  'ERROR',
  'TEST',
  'IDPASS',
  'IDTF',
  'IDSVCOUT',
  'IDSVCINC',
] as const;

export const CRS_SPEC_WEBHOOK_ALERT_TYPE = 'ACCALERT' as const;

export const CRS_SPEC_WEBHOOK_CORE_FIELDS = [
  'id',
  'type',
  'user_id',
  'host_id',
  'time',
] as const;

export const CRS_SPEC_WEBHOOK_ALERT_FIELDS = [
  'alert_id',
  'alert_date',
  'alert_source',
] as const;

export const CRS_SPEC_WEBHOOK_ACK_FIELDS = ['hook_id', 'status'] as const;
export const CRS_SPEC_WEBHOOK_BASIC_CREDENTIAL_MAX_LENGTH = 15 as const;

export const CRS_SPEC_ERROR_CODES = {
  userAlreadyRegistered: 'SC102',
  alreadyIdentified: 'SC301',
  ditRejected: 'SC303',
  ditUnavailable: 'SC315',
  smfaTokenInvalidOrExpired: 'SC326',
  smfaIncomplete: 'SC325',
  thinFile: 'SC306',
  enrollmentError: 'SC313',
  enrollmentFeatureError: 'SC308',
  serviceUnavailable: 'SC320',
  unauthorizedConsumerAccess: 'SC402',
  unauthorizedPremiumFeatureAccess: 'SC407',
  dataAccessRequired: 'SC405',
  alreadyClosed: 'SC121',
  unenrollmentQueued: 'SC307',
} as const;

export const CRS_SPEC_REPORT_RETENTION_MONTHS = 3 as const;

export type CrsForbiddenEndpoint = {
  readonly path: string;
  readonly includesDescendants: boolean;
};

export const CRS_FORBIDDEN_SCORE_PROJECTION_ENDPOINTS = [
  { path: '/users/efx-score-up', includesDescendants: false },
  { path: '/users/efx-optimal-path', includesDescendants: true },
] as const satisfies readonly CrsForbiddenEndpoint[];

/** Numeric score-gain or target-score fields published by Score Up and Optimal Path responses. */
export const CRS_SCORE_PROJECTION_RESPONSE_FIELDS = [
  'scoreIncrementLowerBound',
  'scoreIncrementUpperBound',
  'targetScore',
  'projectedScoreImprovement',
  'projectedMonthlyScore',
] as const;

/** Optimal Path emits one projected factor delta per modeled attribute under this prefix. */
export const CRS_SCORE_PROJECTION_RESPONSE_FIELD_PREFIXES = [
  'projectedDelta-',
] as const;
