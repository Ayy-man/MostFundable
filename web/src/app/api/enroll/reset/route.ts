import { DEMO_CONSUMER_PERSONA_EMAILS } from "@/lib/demo/demo-session";
import { demoResetEnabled } from "@/lib/enrollment/demo-reset";
import { AppError, toHttpResponse } from "@/lib/enrollment/errors";

export const runtime = "nodejs";

interface EnrollResetDependencies {
  getSession: typeof import("@/lib/auth/session").getSession;
  resetDemoConsumerWorkspace: typeof import("@/lib/enrollment/repository").resetDemoConsumerWorkspace;
}

/**
 * Demo-only: start the signed-in seeded consumer's enrollment over.
 *
 * Nothing is erased. Migration 392 archives the consumer's current client — with its enrollment,
 * consents, e-signature, subscription and IDV rows still attached, where the operator book keeps
 * showing them — and binds the profile to a fresh Onboarding client, which is the pre-enrollment
 * state `GET /api/enroll` then reports. The surface reloads to pick that up.
 *
 * Three gates, each answering 404 so the route does not exist unless every one holds: the flags
 * (`FEATURE_ENROLLMENT`, `FEATURE_REAL_AUTH`, `FEATURE_DEMO_QUICK_SIGN_IN`), a consumer session,
 * and membership of the closed persona list — which the database re-checks on its own.
 */
export async function handleEnrollmentReset(
  overrides?: EnrollResetDependencies,
): Promise<Response> {
  try {
    if (!demoResetEnabled()) {
      throw new AppError("not_found", "Enrollment reset is unavailable.");
    }
    const dependencies = overrides ?? await (async () => {
      const [{ getSession }, repository] = await Promise.all([
        import("@/lib/auth/session"),
        import("@/lib/enrollment/repository"),
      ]);
      return {
        getSession,
        resetDemoConsumerWorkspace: repository.resetDemoConsumerWorkspace,
      };
    })();
    const actor = await dependencies.getSession();
    if (!actor) throw new AppError("unauthenticated", "Authentication is required.");
    if (actor.role !== "consumer") {
      throw new AppError("not_found", "Enrollment reset is unavailable.");
    }
    const result = await dependencies.resetDemoConsumerWorkspace(actor, DEMO_CONSUMER_PERSONA_EMAILS);
    if (!result.ok) throw result.error;
    return Response.json({ clientId: result.value });
  } catch (error) {
    return toHttpResponse(error);
  }
}

export async function POST(): Promise<Response> {
  return handleEnrollmentReset();
}
