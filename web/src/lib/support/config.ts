// The draft confidence bar.
//
// BACKEND-SPEC §8 compares a draft's confidence against a Global Config value.
// No config table exists in migrations 001–051 and Phase 13 does not own one
// (IA-13-03), so the bar comes from an optional environment key with a fixed
// fallback, and the resolved number is persisted per row in
// `held_drafts.confidence_threshold`. When a config table lands, this one
// function changes and history stays accurate, because every past row already
// records the bar it was judged against.

import type { EnvSource } from '../env.ts';

export const SUPPORT_DRAFT_CONFIDENCE_THRESHOLD_KEY = 'SUPPORT_DRAFT_CONFIDENCE_THRESHOLD';

export const SUPPORT_DRAFT_CONFIDENCE_THRESHOLD_DEFAULT = 0.7;

export class SupportConfigError extends Error {
  readonly code = 'SUPPORT_CONFIG_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'SupportConfigError';
  }
}

/**
 * Read the bar, lazily.
 *
 * The read happens at call time and never at module load, so a route can be
 * imported in a build with no environment at all and a test can mutate its own
 * env object between calls. A blank value counts as absent, matching
 * `isBlank()` in `env.ts` and the promise `.env.example` makes at the top of
 * the file — a verbatim copy of that file has to boot the stack on mocks, and
 * this key ships in it as a bare `NAME=`.
 *
 * Anything else that is not a finite number in [0, 1] throws rather than
 * silently falling back, because a typo in the bar is a compliance-relevant
 * misconfiguration: too low and drafts become sendable that should not be.
 */
export function resolveDraftConfidenceThreshold(env: EnvSource = process.env): number {
  const raw = env[SUPPORT_DRAFT_CONFIDENCE_THRESHOLD_KEY];

  if (raw === undefined || raw === null || raw.trim() === '') {
    return SUPPORT_DRAFT_CONFIDENCE_THRESHOLD_DEFAULT;
  }

  const parsed = Number(raw.trim());

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new SupportConfigError(
      `${SUPPORT_DRAFT_CONFIDENCE_THRESHOLD_KEY} must be a number between 0 and 1 inclusive, ` +
        `or unset to use the default of ${SUPPORT_DRAFT_CONFIDENCE_THRESHOLD_DEFAULT}.`,
    );
  }

  return parsed;
}
