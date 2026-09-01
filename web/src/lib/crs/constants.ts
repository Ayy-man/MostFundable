// web/src/lib/crs/constants.ts — runtime constants backed by the dated v3 client-spec catalog.
// Nothing here reads env and nothing throws on import. Provider contract facts that can change
// live in spec-catalog.ts so enforcement and regression tests consume the same source.

import type { BureauCode, ReportCode } from './types.ts';

// ---------------------------------------------------------------------------------------------
// Token validity times — CRS client spec updated 2026-08-27
// ---------------------------------------------------------------------------------------------

/** Preauthorization tokens expire after 30 seconds and are single use. */
export const CRS_PREAUTH_TOKEN_TTL_SECONDS = 30;

/** User tokens expire after 15 minutes. */
export const CRS_USER_SESSION_TOKEN_TTL_SECONDS = 900;

/** Direct tokens expire after one hour. */
export const CRS_DIRECT_TOKEN_TTL_SECONDS = 3600;

/** SMFA sessions expire after 15 minutes. */
export const CRS_MOBILE_VERIFICATION_TTL_SECONDS = 900;

/** CRS v3 permits refresh beginning 30 seconds before the one-hour direct token expires. */
export const CRS_REFRESH_TOKEN_VALID_AFTER_SECONDS = 3570;

/** CRS v3 direct refresh tokens expire two hours after the original login. */
export const CRS_REFRESH_TOKEN_EXPIRES_AFTER_SECONDS = 7200;

// ---------------------------------------------------------------------------------------------
// Bureaus and report codes — data estate
// ---------------------------------------------------------------------------------------------

/** UNVERIFIED (https://crscreditapi.redoc.ly/openapi/reference/tag/Equifax/, fetched 2026-08-16) — the three bureaus, in the order the tri-merge reports them. */
export const CRS_BUREAU_CODES: readonly [BureauCode, BureauCode, BureauCode] = [
  'EQF',
  'EXP',
  'TUC',
] as const;

/**
 * UNVERIFIED (https://crscreditapi.redoc.ly/developer-portal/consumer-credit/, fetched 2026-08-16) — the JSON report code per bureau.
 *
 * Detail the spec lacked and pre-flight A4a found: EQF1001 returns JSON *and* PDF, EXP1001 is
 * JSON only (PDF "coming soon"), and TUC3002 is JSON while TransUnion's PDF is a *separate* code,
 * TUC1001. So "three codes" is right for JSON and wrong the moment anyone wants a PDF.
 */
export const CRS_REPORT_CODE_BY_BUREAU: Readonly<Record<BureauCode, ReportCode>> = {
  EQF: 'EQF1001',
  EXP: 'EXP1001',
  TUC: 'TUC3002',
} as const;

// ---------------------------------------------------------------------------------------------
// Webhooks — monitoring estate
// ---------------------------------------------------------------------------------------------

/** The event discriminator catalog from the client spec dated 2026-08-27. */
export { CRS_SPEC_WEBHOOK_EVENT_TYPES as CRS_WEBHOOK_EVENT_TYPES } from './spec-catalog.ts';

/** Portal limits from the client spec dated 2026-08-27; both fields are capped at 15 characters. */
export {
  CRS_SPEC_WEBHOOK_BASIC_CREDENTIAL_MAX_LENGTH as CRS_WEBHOOK_BASIC_PASSWORD_MAX_LENGTH,
  CRS_SPEC_WEBHOOK_BASIC_CREDENTIAL_MAX_LENGTH as CRS_WEBHOOK_BASIC_USERNAME_MAX_LENGTH,
} from './spec-catalog.ts';

/**
 * UNVERIFIED-FOR-ACCOUNT (no public source; pre-flight A6c) — 5000 ms.
 *
 * This is a SELF-IMPOSED budget, not a CRS requirement. No CRS page publishes an ACK deadline, a
 * timeout, a retry interval or an attempt cap; the 5 seconds in our own spec has no source. Retry
 * is driven by the response *body* — a `status` other than `true` makes CRS resend — so the
 * budget exists to keep the handler honest, not to satisfy a documented contract.
 */
export const CRS_ACK_BUDGET_MS = 5000;

/**
 * SELF-IMPOSED — the 2026-08-27 client spec publishes no byte or event-count ceiling. These
 * conservative receiver limits are ours and must be confirmed during provider onboarding.
 */
export const CRS_WEBHOOK_MAX_BODY_BYTES = 1024 * 1024;
export const CRS_WEBHOOK_MAX_BATCH_COUNT = 100;

// ---------------------------------------------------------------------------------------------
// Identity verification — monitoring estate
// ---------------------------------------------------------------------------------------------

/** Local mock-only allowance. CRS v3 has no identity quiz or KBA fallback. */
export const CRS_IDV_QUIZ_MAX_ANSWERS = 4;

/** Local mock-only lock window. CRS v3 rejects Review and Deny without a retry flow. */
export const CRS_IDV_LOCKOUT_HOURS = 72;
