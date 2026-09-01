/**
 * The HTTP shapes every applications and outcomes route shares.
 *
 * Deliberately pure: no `server-only`, no service import, no Supabase. A route
 * imports this at module scope so its flag-off branch can answer without
 * loading anything, and reaches the service through `@/lib/applications` only
 * after the flag check has passed. That ordering is what makes "the flag off
 * costs nothing" a property of the source rather than a hope, and
 * `routes.test.ts` asserts it by position.
 *
 * One mapping from this library's closed error codes to statuses and fixed
 * strings lives here, so no route invents a second one and no database message,
 * SQLSTATE, constraint name or column value can reach a caller (T-11-27).
 */

import { recordRouteFailure, withCorrelationId } from "@/lib/diagnostics/route-failure";
import {
  APPLICATIONS_DISABLED_CODE,
  APPLICATIONS_DISABLED_MESSAGE,
  ApplicationsError,
  type ApplicationsErrorCode,
} from "./types.ts";

export const privateHeaders = { "Cache-Control": "private, no-store" };

/** `applications.bank_ref`'s format check, mirrored so a 400 beats a 23514. */
const BANK_REF_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isBankRef(value: unknown): value is string {
  return typeof value === "string" && BANK_REF_PATTERN.test(value);
}

export function isIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ISO_DATE_PATTERN.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when the body carries no key outside the allow-list. */
export function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

export function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: privateHeaders });
}

export function errorResponse(
  code: string,
  message: string,
  status: number,
): Response {
  return jsonResponse({ error: code, message }, status);
}

/** The flag-off answer, identical on every route in the phase. */
export function disabledResponse(): Response {
  return errorResponse(
    APPLICATIONS_DISABLED_CODE,
    APPLICATIONS_DISABLED_MESSAGE,
    503,
  );
}

/** The 401 every route shares. The session helpers throw it; reads return null. */
export function sessionRequired(): Response {
  return errorResponse("session_required", "Sign in to use applications.", 401);
}

/** The 403 for a role that has no business on this surface at all. */
export function roleForbidden(): Response {
  return errorResponse(
    "role_forbidden",
    "This account cannot access this application.",
    403,
  );
}

export function invalidRequest(message: string): Response {
  return errorResponse("invalid_request", message, 400);
}

const ERROR_STATUS: Readonly<Record<ApplicationsErrorCode, number>> = {
  disabled: 503,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  unknown_reference: 400,
  attestation_required: 400,
  configuration_error: 503,
  failed: 500,
};

const ERROR_MESSAGE: Readonly<Record<ApplicationsErrorCode, string>> = {
  disabled: APPLICATIONS_DISABLED_MESSAGE,
  forbidden: "This account cannot access this application.",
  not_found: "The application was not found.",
  conflict: "The request conflicts with a record that already exists.",
  unknown_reference: "The request names a lender or record that does not exist.",
  attestation_required: "An operator note must carry its attestation.",
  configuration_error: "Applications are not configured.",
  failed: "The applications request could not be completed.",
};

/**
 * Read the 401/403 an `AuthError` carries. The session helpers throw rather
 * than return for these, and the status is the only part of the error a route
 * may act on.
 */
export function accessStatus(error: unknown): 401 | 402 | 403 | null {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return null;
  }
  const status = (error as { status: unknown }).status;
  return status === 401 || status === 402 || status === 403 ? status : null;
}

/**
 * Turn anything thrown inside a handler into a response.
 *
 * `overrides` lets one route give a code a more useful sentence — the outcome
 * route's 409, for instance — without any route inventing its own status map.
 */
export function failureResponse(
  error: unknown,
  overrides: Partial<Record<ApplicationsErrorCode, string>> = {},
): Response {
  const status = accessStatus(error);
  if (status === 401) {
    return errorResponse("session_required", "Sign in to use applications.", 401);
  }
  if (status === 402) {
    return errorResponse("ORG_DEACTIVATED", "This organization is deactivated.", 402);
  }
  if (status === 403) {
    return errorResponse(
      "role_forbidden",
      "This account cannot access this application.",
      403,
    );
  }

  if (error instanceof ApplicationsError) {
    return errorResponse(
      error.code,
      overrides[error.code] ?? ERROR_MESSAGE[error.code],
      ERROR_STATUS[error.code],
    );
  }

  // Anything else is unknown, and an unknown error's message is the last thing
  // that should be echoed: it is the one place a driver or Postgres string
  // could still be carrying a row value. R5B-04 adds the other half — the
  // message stays off the wire, but the cause is now recorded server-side and
  // the caller gets the id that joins its 500 to that record.
  return unknownApplicationsFailure(error);
}

/** The one applications answer that means "we do not know", and the only one that records. */
export function unknownApplicationsFailure(
  error: unknown,
  surface = "applications.failure_response",
): Response {
  const id = recordRouteFailure({
    cause: error,
    code: "failed",
    status: ERROR_STATUS.failed,
    surface,
  });
  return jsonResponse(
    withCorrelationId({ error: "failed", message: ERROR_MESSAGE.failed }, id),
    ERROR_STATUS.failed,
  );
}

/**
 * The 404 an unknown id and an out-of-reach id share (T-11-26).
 *
 * The message is overridable for the one 404 that is not about reachability at
 * all — a lender with no counted outcome yet has no `bank_outcome_stats` row —
 * because telling that caller "the application was not found" would point at
 * the wrong thing entirely.
 */
export function notFoundResponse(message: string = ERROR_MESSAGE.not_found): Response {
  return errorResponse("not_found", message, 404);
}
