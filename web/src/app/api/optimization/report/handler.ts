import { OptimizationDataError } from "@/lib/optimization/read.ts";
import { OptimizationReportError, parseReportRequest } from "@/lib/optimization/report.ts";

import type { SessionProfile } from "@/lib/auth/session";
import type { OptimizationReportRequest } from "@/lib/optimization/report.ts";
import type { ConsumerOptimizationV1 } from "@/lib/optimization/types.ts";

const privateHeaders = { "Cache-Control": "private, no-store" };

export interface OptimizationReportDependencies {
  requireConsumer(): Promise<SessionProfile>;
  readBody(): Promise<unknown>;
  reportChecklistItem(request: OptimizationReportRequest): Promise<void>;
  readConsumerOptimization(session: SessionProfile): Promise<ConsumerOptimizationV1 | null>;
  recordFailure(input: { cause: unknown; code: string; status: number; surface: string }): string;
}

function errorResponse(
  code: string,
  message: string,
  status: number,
  extra: Record<string, unknown> = {},
) {
  return Response.json({ error: { code, message }, ...extra }, { status, headers: privateHeaders });
}

function accessStatus(error: unknown): 401 | 403 | null {
  if (typeof error !== "object" || error === null || !("status" in error)) return null;
  return error.status === 401 ? 401 : error.status === 403 ? 403 : null;
}

/**
 * The Optimization view's write, separated from `route.ts` for the same reason the read is.
 *
 * Four refusals and one success, and the success is deliberately shaped like the read's: it answers
 * with the whole freshly re-read view rather than with the row that was written. A surface that
 * patched its own state from a write's return value would be rendering what it asked for instead of
 * what happened, and the two differ the moment the analysis pipeline moves a factor underneath it.
 *
 * The 409 is worth naming, because it is a normal answer rather than an incident: the database
 * refuses any transition other than todo <-> reported, so a second click on a report that already
 * landed, or a click on a factor the pipeline has since started verifying, arrives here. Both mean
 * the caller's snapshot is stale, and the honest answer is to say so rather than to make the write
 * idempotent and let the person believe the button did what it said.
 */
export async function handleOptimizationReport(
  dependencies: OptimizationReportDependencies,
): Promise<Response> {
  let session: SessionProfile;
  try {
    session = await dependencies.requireConsumer();
  } catch (error) {
    const status = accessStatus(error);
    if (status === 403) {
      return errorResponse(
        "role_forbidden",
        "This account cannot update funding readiness optimization.",
        403,
      );
    }
    return errorResponse(
      "session_required",
      "Sign in to update your funding readiness optimization.",
      401,
    );
  }

  let request: OptimizationReportRequest;
  try {
    request = parseReportRequest(await dependencies.readBody());
  } catch {
    // Both a malformed body and an unreportable factor land here, and both get the same answer:
    // naming which one it was would tell an unauthenticated prober which factor keys exist.
    return errorResponse(
      "invalid_request",
      "That readiness item cannot be marked from here.",
      400,
    );
  }

  try {
    await dependencies.reportChecklistItem(request);
  } catch (error) {
    if (error instanceof OptimizationReportError) {
      if (error.code === "forbidden") {
        return errorResponse(
          "role_forbidden",
          "This account cannot update funding readiness optimization.",
          403,
        );
      }
      if (error.code === "invalid_request") {
        return errorResponse(
          "invalid_request",
          "That readiness item cannot be marked from here.",
          400,
        );
      }
      if (error.code === "conflict") {
        return errorResponse(
          "report_conflict",
          "This item has moved since your page loaded. Refresh to see where it stands.",
          409,
        );
      }
    }
    const correlationId = dependencies.recordFailure({
      cause: error,
      code: "report_unavailable",
      status: 503,
      surface: "api.optimization.report",
    });
    return errorResponse(
      "report_unavailable",
      "Funding readiness optimization is temporarily unavailable.",
      503,
      { correlationId },
    );
  }

  try {
    const data = await dependencies.readConsumerOptimization(session);
    return Response.json({ data }, { status: 200, headers: privateHeaders });
  } catch (error) {
    if (error instanceof OptimizationDataError && error.code === "forbidden") {
      return errorResponse(
        "role_forbidden",
        "This account cannot view funding readiness optimization.",
        403,
      );
    }
    // The write landed and the re-read did not. Saying 503 here is honest about the response and
    // silent about the write, which is the correct pair: the surface's recovery is to re-read, and
    // a re-read will show the change that did happen.
    const correlationId = dependencies.recordFailure({
      cause: error,
      code: "optimization_unavailable",
      status: 503,
      surface: "api.optimization.report.read-back",
    });
    return errorResponse(
      "optimization_unavailable",
      "Funding readiness optimization is temporarily unavailable.",
      503,
      { correlationId },
    );
  }
}
