import "server-only";

import { onEnrollmentSucceeded } from "@/lib/analysis/worker";

import { onEnrollmentActivated } from "./transition.server";

/**
 * Integration-owned glue between lane B's durable enrollment activation and the
 * two downstream entry points DEC-OWN-PHASE7-CHAIN names, in the order it fixes:
 * Phase 6's stage transition first, then Phase 5's analysis enqueue.
 *
 * `onEnrollmentSucceeded` sets provenance `scheduled` inside the worker — the
 * adapter never asks for the operator-initiated refresh provenance, which is a
 * different cause and is not what an activation is.
 */
export type EnrollmentActivationInput = {
  actorId: string;
  clientId: string;
  enrollmentId: string;
};

export type EnrollmentGlueDependencies = {
  activateStage(input: { clientId: string; enrollmentId: string }): Promise<unknown>;
  enqueueAnalysis(input: { clientId: string; enrollmentId: string }): Promise<unknown>;
};

const productionDependencies: EnrollmentGlueDependencies = {
  activateStage: onEnrollmentActivated,
  enqueueAnalysis: onEnrollmentSucceeded,
};

/**
 * INTERFACES §7: a glue failure is logged as metadata only — the call that
 * failed, the two subjects, and the error's own name and message. No payload, no
 * member reference, no provider body, no bureau value is ever formatted here.
 */
function reportGlueFailure(
  call: "onEnrollmentActivated" | "onEnrollmentSucceeded",
  input: EnrollmentActivationInput,
  error: unknown,
): void {
  const failure = error instanceof Error ? error : new Error("unknown_error");
  console.error("tracker enrollment glue failed", {
    call,
    clientId: input.clientId,
    enrollmentId: input.enrollmentId,
    errorMessage: failure.message,
    errorName: failure.name,
  });
}

/**
 * Build the port lane B injects. Both calls are wrapped and swallowed on purpose
 * (07-CONTEXT D-04): the `activate` effect runs immediately before
 * `start_subscription` in a plain sequential effect loop, so a throw here would
 * skip the charge for a consumer who has already passed identity verification.
 * Migration 257 writes the initial analysis tuple in the activation transaction.
 * This second enqueue is an idempotent verification path, so an outage here
 * cannot leave an active enrollment without durable work.
 */
export function createTrackerEnrollmentPort(
  dependencies: EnrollmentGlueDependencies = productionDependencies,
) {
  return Object.freeze({
    async enrollmentActivated(input: EnrollmentActivationInput): Promise<void> {
      try {
        await dependencies.activateStage({
          clientId: input.clientId,
          enrollmentId: input.enrollmentId,
        });
      } catch (error) {
        reportGlueFailure("onEnrollmentActivated", input, error);
      }

      try {
        await dependencies.enqueueAnalysis({
          clientId: input.clientId,
          enrollmentId: input.enrollmentId,
        });
      } catch (error) {
        reportGlueFailure("onEnrollmentSucceeded", input, error);
      }
    },
  });
}

/** The instance lane B's `defaultDependencies()` injects. */
export const trackerEnrollmentPort = createTrackerEnrollmentPort();
