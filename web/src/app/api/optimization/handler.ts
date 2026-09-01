import { OptimizationDataError } from "@/lib/optimization/read.ts";

import type { SessionProfile } from "@/lib/auth/session";
import type { ConsumerOptimizationV1 } from "@/lib/optimization/types.ts";

const privateHeaders = { "Cache-Control": "private, no-store" };

export interface OptimizationGetDependencies {
  requireConsumer(): Promise<SessionProfile>;
  readConsumerOptimization(session: SessionProfile): Promise<ConsumerOptimizationV1 | null>;
  recordFailure(input: { cause: unknown; code: string; status: number; surface: string }): string;
}

function errorResponse(code: string, message: string, status: number, extra: Record<string, unknown> = {}) {
  return Response.json({ error: { code, message }, ...extra }, { status, headers: privateHeaders });
}

function accessStatus(error: unknown): 401 | 403 | null {
  if (typeof error !== "object" || error === null || !("status" in error)) return null;
  return error.status === 401 ? 401 : error.status === 403 ? 403 : null;
}

/**
 * The Optimization view's read, separated from `route.ts` so its behaviour can be exercised
 * without a Next.js request context.
 *
 * Three answers and no fourth: the view (or an explicit null when the consumer has no workspace),
 * a refusal, or an outage. A read that failed is NEVER shaped like a healthy empty view — the
 * surface renders `data: null` as "nothing analyzed yet", so folding a broken read into it would
 * tell a consumer their file is empty when we simply could not look.
 */
export async function handleOptimizationGet(
  dependencies: OptimizationGetDependencies,
): Promise<Response> {
  let session: SessionProfile;
  try {
    session = await dependencies.requireConsumer();
  } catch (error) {
    const status = accessStatus(error);
    if (status === 403) {
      return errorResponse("role_forbidden", "This account cannot view funding readiness optimization.", 403);
    }
    return errorResponse("session_required", "Sign in to view your funding readiness optimization.", 401);
  }

  try {
    const data = await dependencies.readConsumerOptimization(session);
    return Response.json({ data }, { status: 200, headers: privateHeaders });
  } catch (error) {
    if (error instanceof OptimizationDataError && error.code === "forbidden") {
      return errorResponse("role_forbidden", "This account cannot view funding readiness optimization.", 403);
    }
    // The cause stays off the wire and goes to the diagnostics seam; the caller gets only the id
    // that joins its 503 to the one recorded line naming the throw's class and code.
    const correlationId = dependencies.recordFailure({
      cause: error,
      code: "optimization_unavailable",
      status: 503,
      surface: "api.optimization.read",
    });
    return errorResponse(
      "optimization_unavailable",
      "Funding readiness optimization is temporarily unavailable.",
      503,
      { correlationId },
    );
  }
}
