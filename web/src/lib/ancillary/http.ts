import { recordRouteFailure, withCorrelationId } from "@/lib/diagnostics/route-failure";

export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(data, { status, headers });
}
export function disabled(): Response { return json({ error: "ancillary_disabled" }, 404); }
export function invalid(code = "invalid_request"): Response { return json({ error: code }, 400); }
export function unavailable(code = "service_unavailable"): Response { return json({ error: code }, 503); }
export function failure(error: unknown): Response {
  if (error && typeof error === "object") {
    const row = error as { status?: unknown; message?: unknown };
    if (row.status === 401) return json({ error: "authentication_required" }, 401);
    if (row.status === 402) return json({ error: "ORG_DEACTIVATED" }, 402);
    if (row.status === 403) return json({ error: "forbidden" }, 403);
    if (typeof row.message === "string") {
      if (row.message.includes("NOT_FOUND")) return json({ error: "not_found" }, 404);
      if (row.message.includes("INVALID") || row.message.includes("REQUIRED") || row.message.includes("PUBLISHED")) return json({ error: row.message.toLowerCase() }, 422);
      if (row.message.includes("UNAVAILABLE")) return unavailable(row.message.toLowerCase());
    }
  }
  return unknownAncillaryFailure(error);
}
/**
 * The catch shared by storage, training, notification, export, purge and pull-cap administration.
 * R5B-05: the cause is recorded here instead of vanishing, and the caller gets the id that names the
 * line. The recorded fields are a classification and identifiers only — a document, a parsed credit
 * report or any other uploaded content can never reach the log stream through this path.
 */
export function unknownAncillaryFailure(error: unknown, surface = "ancillary.failure"): Response {
  const id = recordRouteFailure({ cause: error, code: "ancillary_failed", status: 500, surface });
  return json(withCorrelationId({ error: "ancillary_failed" }, id), 500);
}
export function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
export function hasKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean { return Object.keys(value).every((key) => allowed.includes(key)); }
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
