import "server-only";

import type {
  AnalysisCompletedInput,
  AnalysisStageTracker,
} from "@/lib/analysis/ports";

import { onAnalysisCompleted } from "./transition.server";

export type AnalysisGlueCall = (input: {
  analysisRunId: string;
  clientId: string;
}) => Promise<unknown>;

/**
 * Integration-owned implementation of Phase 5's `AnalysisStageTracker` port.
 *
 * `readinessScore` is part of the port's input and is deliberately **not**
 * forwarded. DEC-OWN-PHASE7-CHAIN item 2 fixes Phase 6's signature at
 * `{ analysisRunId, clientId }`; the tracker read model resolves readiness from
 * `analysis_runs` itself, so passing the score would widen a frozen interface and
 * hand the tracker a number the database has not necessarily persisted. Do not
 * "fix" the unused field by threading it through.
 *
 * Unlike the enrollment adapter this one does not swallow. The worker owns the
 * error taxonomy for this call — a throw becomes `tracker_failed`, which is
 * retryable and idempotent on `analysisRunId` — and swallowing here would turn a
 * missed transition into a job that reports success.
 */
export function createTrackerAnalysisStageTracker(
  transition: AnalysisGlueCall = onAnalysisCompleted,
): AnalysisStageTracker {
  return Object.freeze({
    // `readinessScore` is destructured off and discarded here, not ignored by
    // accident — see the note above.
    async recordAnalysisCompleted({
      analysisRunId,
      clientId,
    }: AnalysisCompletedInput): Promise<void> {
      await transition({ analysisRunId, clientId });
    },
  });
}

/** The instance the analysis worker's production dependencies inject. */
export const trackerAnalysisStageTracker: AnalysisStageTracker =
  createTrackerAnalysisStageTracker();
