// web/src/lib/crs/feature-flag.ts — the single FEATURE_ANALYSIS read.
//
// Both Phase 4 route handlers (`GET /api/monitoring/token`, `POST /api/webhooks/crs`) read the
// flag through this one function. The integration-owned `env.ts` is the canonical flag reader;
// this lane-owned wrapper preserves the exported name without duplicating its truthy set.

import { featureFlag } from '../env.ts';

/**
 * Uses the shared closed truthy set. Everything else, including an absent or blank value, stays
 * OFF until integration flips it (DEV-ONBOARDING "one environment": new behaviour lands on
 * `main` behind its `FEATURE_*` flag).
 */
export function isAnalysisEnabled(env: NodeJS.ProcessEnv): boolean {
  return featureFlag('FEATURE_ANALYSIS', env);
}
