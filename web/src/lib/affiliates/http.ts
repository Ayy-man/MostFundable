import { isAuthError } from "@/lib/auth/errors";
import { AffiliateError } from "@/lib/affiliates/types";
import { recordRouteFailure, withCorrelationId } from "@/lib/diagnostics/route-failure";

export function privateJson(body: unknown, status = 200): Response {
  const response = Response.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export function disabledResponse(): Response {
  return new Response(null, { status: 404 });
}

export function affiliateFailure(error: unknown): Response {
  if (typeof error === "object" && error !== null && "status" in error && error.status === 402) {
    return privateJson({ error: "ORG_DEACTIVATED" }, 402);
  }
  if (isAuthError(error)) return privateJson({ error: error.code }, error.status);
  if (error instanceof AffiliateError) {
    const status = error.code === "invalid_payload"
      ? 400
      : error.code === "forbidden"
        ? 403
        : error.code === "not_found"
          ? 404
          : 500;
    if (status !== 500) return privateJson({ error: error.code }, status);
    return unknownAffiliateFailure(error);
  }
  return unknownAffiliateFailure(error);
}

/**
 * Every affiliate 500 — an `AffiliateError` with no mapped status as much as a bare throw — means
 * the route could not say what went wrong. R5B-04 records the classification and returns the
 * correlation id alongside the same redacted `unavailable` the caller already got.
 */
export function unknownAffiliateFailure(
  error: unknown,
  surface = "affiliates.failure",
): Response {
  const id = recordRouteFailure({ cause: error, code: "unavailable", status: 500, surface });
  return privateJson(withCorrelationId({ error: "unavailable" }, id), 500);
}
