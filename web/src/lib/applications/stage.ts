import "server-only";

/**
 * The Applying and Funded seam, and the whole of this phase's reach into the
 * stage taxonomy.
 *
 * Phase 6 owns stage movement and `transitionClientStage` is its frozen entry
 * point, so nothing in `web/src/lib/applications/` writes the tracker's stage
 * column, its entry timestamp or the history table, and nothing calls the
 * transition routine in the database directly (D-10). A grep across this
 * directory for those four names is part of the plan's verification.
 *
 * **This seam is best-effort in demo mode, and that is a property of the merged
 * stack rather than a defect here.** The manual arm at
 * `supabase/migrations/050_tracker_stage_engine.sql:131-144` requires three
 * things at once: the calling role must be `authenticated`, the actor passed in
 * must equal the subject on the JWT, and that subject's profile must hold the
 * `operator_member` role. With `FEATURE_REAL_AUTH` off the frozen demo session
 * (`web/src/lib/auth/session.ts:26-59`) is resolved from a header or a cookie
 * and carries no Supabase JWT at all, so none of the three can hold, the
 * routine raises `42501`, and `web/src/lib/tracker/transition.server.ts:110`
 * converts that into a `forbidden` error.
 *
 * Treating that as a failure would make recording an outcome fail for a reason
 * that has nothing to do with the outcome, so `forbidden` comes back as
 * `unavailable` and the caller carries on. The capability itself is proved
 * where it can be: plan 02's pgTAP calls the routine as a genuine
 * `authenticated` `operator_member` and asserts the stage moved. Phase 7's D-04
 * gave the identical limitation the identical treatment, and `docs/GAPS.md`
 * G-11-06 records it so it is not rediscovered as a Phase 11 bug.
 */

import { transitionClientStage } from "@/lib/tracker";
import type { TrackerStage } from "@/lib/tracker";

/** The only two stages this phase ever asks for. */
export type ApplicationStageTarget = Extract<TrackerStage, "applying" | "funded">;

/**
 * `unavailable` is not an error. It says the move could not be attempted in
 * this environment, which is the ordinary demo-mode answer.
 */
export type ApplicationStageResult = "transitioned" | "skipped" | "unavailable";

/**
 * The stage each target moves out of. The routine takes an expected-from stage
 * and rejects a move from anywhere else, which is what makes a concurrent
 * change safe; a caller that knows better passes its own.
 */
const EXPECTED_FROM: Readonly<Record<ApplicationStageTarget, TrackerStage>> = {
  applying: "ready",
  funded: "applying",
};

/**
 * Metadata only, in the shape `web/src/lib/tracker/enrollment-adapter.ts:43`
 * uses: the call, its two subjects, and a code. No payload, no amount and no
 * profile identifier is ever formatted here.
 */
function reportStageMiss(
  clientId: string,
  to: ApplicationStageTarget,
  code: string,
): void {
  console.error("applications stage advance unavailable", {
    call: "applicationStageAdvance",
    clientId,
    code,
    to,
  });
}

/**
 * Read a `TrackerTransitionError` without importing it.
 *
 * The error class lives in `transition.server`, which is behind Phase 6's
 * barrel on purpose, and reaching past the barrel for one class would make this
 * module depend on the tracker's private module layout. The class sets a fixed
 * `name`, so matching on that is the same check with none of the coupling.
 */
function trackerErrorCode(
  error: unknown,
): "forbidden" | "stage_transition_not_allowed" | "failed" | null {
  if (typeof error !== "object" || error === null) return null;
  const candidate = error as { name?: unknown; code?: unknown };
  if (candidate.name !== "TrackerTransitionError") return null;
  if (candidate.code === "forbidden") return "forbidden";
  if (candidate.code === "stage_transition_not_allowed") return "stage_transition_not_allowed";
  return "failed";
}

/**
 * Ask the tracker to move a client to Applying or Funded, and never let the
 * answer break the caller.
 *
 * Returns `transitioned` when the stage moved, `skipped` when the move was a
 * no-op the tracker declined for a reason that is about the client's own state,
 * and `unavailable` when the environment could not support the attempt.
 */
export async function applicationStageAdvance(
  clientId: string,
  to: ApplicationStageTarget,
  expectedFrom: TrackerStage = EXPECTED_FROM[to],
): Promise<ApplicationStageResult> {
  try {
    const result = await transitionClientStage({
      clientId,
      expectedStage: expectedFrom,
      stage: to,
    });

    switch (result.outcome) {
      case "transitioned":
        return "transitioned";
      // The tracker flag being off is an environment answer, not a client one,
      // so it reads the same way a missing session does.
      case "disabled":
        reportStageMiss(clientId, to, "tracker_disabled");
        return "unavailable";
      // `unchanged` means the client is already there. `duplicate`, `stale` and
      // `not_found` all mean the move does not apply to this client right now —
      // an outcome recorded against a client who never reached Ready, most
      // often. None of them is a fault and none should surface to a caller.
      default:
        return "skipped";
    }
  } catch (error) {
    const code = trackerErrorCode(error);
    if (code === null) {
      // Anything that is not a tracker transition error is still not this
      // phase's to raise: the outcome is already durable by the time a stage
      // move is attempted.
      reportStageMiss(clientId, to, "unexpected_error");
      return "unavailable";
    }
    reportStageMiss(clientId, to, code);
    return "unavailable";
  }
}

/** The port shape the service injects, so its tests need no tracker at all. */
export interface ApplicationStagePort {
  advance(
    clientId: string,
    to: ApplicationStageTarget,
  ): Promise<ApplicationStageResult>;
}

export const trackerApplicationStagePort: ApplicationStagePort = Object.freeze({
  advance(clientId: string, to: ApplicationStageTarget) {
    return applicationStageAdvance(clientId, to);
  },
});
