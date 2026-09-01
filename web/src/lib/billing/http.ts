// http.ts — every string a billing route can put in front of a browser.
//
// The point of a closed map is that `billingError` physically cannot emit text
// that is not written in this file. A route that catches a database or provider
// rejection picks a code; it never forwards a message. That is T-10-23, and it
// also means the compliance copy gate has one small file to police instead of
// two route handlers with inline strings.
//
// Every builder sets `Cache-Control: private, no-store`. Billing state is
// per-tenant and changes on a webhook nobody's browser knows about, so a shared
// cache holding it is both a disclosure risk and a correctness one.
//
// This module imports nothing but types, plus the diagnostics seam — which itself imports nothing
// at all, so loading this file before a flag check still costs nothing.

import { recordRouteFailure, withCorrelationId } from "@/lib/diagnostics/route-failure";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" } as const;

export const BILLING_ERROR_CODES = [
  "billing_unavailable",
  "org_deactivated",
  "invalid_request",
  "org_required",
  "role_forbidden",
  "session_required",
  "subscription_conflict",
] as const;

export type BillingErrorCode = (typeof BILLING_ERROR_CODES)[number];

const BILLING_MESSAGES: Readonly<Record<BillingErrorCode, string>> = {
  billing_unavailable: "Billing is temporarily unavailable. Try again shortly.",
  org_deactivated: "This organization is deactivated.",
  invalid_request: "The request could not be read.",
  // Deliberately the same wording as role_forbidden: an operator asking about
  // an organization it does not belong to learns nothing about whether that
  // organization exists.
  org_required: "This account cannot view billing for that organization.",
  role_forbidden: "This account cannot view billing for that organization.",
  session_required: "Sign in to view billing.",
  subscription_conflict: "The billing record could not be changed in its current state.",
};

const BILLING_STATUS: Readonly<Record<BillingErrorCode, number>> = {
  billing_unavailable: 500,
  org_deactivated: 402,
  invalid_request: 400,
  org_required: 403,
  role_forbidden: 403,
  session_required: 401,
  subscription_conflict: 409,
};

/**
 * The flag-off answer for a read. Deliberately a 200 carrying `enabled: false`
 * rather than a 404: the route exists, the feature is not turned on, and a
 * caller should be able to tell those apart without parsing an error.
 */
export function disabledRead(): Response {
  return Response.json({ enabled: false }, { headers: PRIVATE_HEADERS, status: 200 });
}

/**
 * The flag-off answer for a write. Also a 200 — nothing failed, and a 503 here
 * would make a disabled feature look like an outage to anything retrying.
 */
export function disabledWrite(): Response {
  return Response.json(
    { code: "billing_disabled" },
    { headers: PRIVATE_HEADERS, status: 200 },
  );
}

export function billingOk<T extends Record<string, unknown>>(
  body: T,
  status = 200,
): Response {
  return Response.json(
    { ...body, enabled: true },
    { headers: PRIVATE_HEADERS, status },
  );
}

export function billingError(code: BillingErrorCode): Response {
  return Response.json(
    { error: { code, message: BILLING_MESSAGES[code] } },
    { headers: PRIVATE_HEADERS, status: BILLING_STATUS[code] },
  );
}

/**
 * Maps a thrown error onto one of the six codes above without importing either
 * error class. Duck typing rather than `instanceof` on purpose: both throwers
 * reach these routes through a dynamic import, and a duplicated module in a
 * bundle would make `instanceof` quietly false and turn a 403 into a 500.
 *
 * An unrecognised throw becomes `billing_unavailable`, so a database or provider
 * message can never be the thing that decides what a browser reads.
 */
/**
 * The unknown-cause arm of `billingErrorFor`, and the only place a billing route may answer 500
 * without knowing why. R5B-03: it records the cause classification and hands the caller the
 * correlation id that ties its 500 to that line.
 */
export function billingUnknownFailure(error: unknown, surface = "billing.error_for"): Response {
  const id = recordRouteFailure({
    cause: error,
    code: "billing_unavailable",
    status: BILLING_STATUS.billing_unavailable,
    surface,
  });
  return Response.json(
    withCorrelationId(
      {
        error: {
          code: "billing_unavailable" as const,
          message: BILLING_MESSAGES.billing_unavailable,
        },
      },
      id,
    ),
    { headers: PRIVATE_HEADERS, status: BILLING_STATUS.billing_unavailable },
  );
}

export function billingErrorFor(error: unknown): Response {
  if (typeof error !== "object" || error === null) {
    return billingUnknownFailure(error);
  }

  const thrown = error as { code?: unknown; name?: unknown; status?: unknown };

  if (thrown.code === "ORG_DEACTIVATED" || thrown.status === 402) {
    return billingError("org_deactivated");
  }

  if (thrown.name === "AuthError") {
    return billingError(thrown.status === 401 ? "session_required" : "role_forbidden");
  }

  switch (thrown.code) {
    case "unauthenticated":
      return billingError("session_required");
    case "forbidden":
      return billingError("role_forbidden");
    case "conflict":
    case "settlement_blocked":
      return billingError("subscription_conflict");
    case "invalid_payload":
      return billingError("invalid_request");
    default:
      return billingUnknownFailure(error);
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** The start route accepts an empty object; every provider input is server-owned. */
export type StartSubscriptionBody = Record<string, never>;

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: "invalid_request" };

const INVALID = { code: "invalid_request" as const, ok: false as const };

export function validateStartSubscription(
  body: unknown,
): ValidationResult<StartSubscriptionBody> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return INVALID;
  }

  const input = body as Record<string, unknown>;
  return Object.keys(input).length === 0
    ? { ok: true, value: {} }
    : INVALID;
}
