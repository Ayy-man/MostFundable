import { recordRouteFailure, withCorrelationId } from "@/lib/diagnostics/route-failure";

import {
  VaultError,
  type BankDetailPayload,
  type BankListRow,
  type VaultErrorCode,
} from "./types.ts";

/**
 * The HTTP shapes `/api/banks` and `/api/banks/[ref]` share.
 *
 * Deliberately pure — no `server-only`, no service import, no Supabase — so a
 * route can import it at module scope and answer its flag-off branch without
 * loading anything that could reach a database. `routes.test.ts` asserts that
 * ordering by source position, because it is a claim about what the file does
 * before it does anything and a passing request cannot tell "the flag was off"
 * apart from "the database was fast".
 *
 * One mapping from this library's closed error codes to statuses and fixed
 * strings lives here, so no route invents a second one and no Postgres message,
 * SQLSTATE or column value can reach a caller.
 */

export const privateHeaders = { "Cache-Control": "private, no-store" };

/** Mirrors `banks_cache.bank_ref`'s shape check, so a 400 beats a 23514. */
const BANK_REF_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;

export function isBankRef(value: unknown): value is string {
  return typeof value === "string" && BANK_REF_PATTERN.test(value);
}

export function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: privateHeaders });
}

export function errorResponse(code: string, message: string, status: number): Response {
  return jsonResponse({ error: code, message }, status);
}

const ERROR_STATUS: Readonly<Record<VaultErrorCode, number>> = {
  disabled: 503,
  not_found: 404,
  configuration_error: 503,
  failed: 500,
};

const ERROR_MESSAGE: Readonly<Record<VaultErrorCode, string>> = {
  disabled: "The lender database is not enabled.",
  not_found: "That lender is not in the database.",
  configuration_error: "The lender database is not configured.",
  failed: "The lender request could not be completed.",
};

/** The flag-off answer, identical on both routes. */
export function disabledResponse(): Response {
  return errorResponse("vault_disabled", ERROR_MESSAGE.disabled, ERROR_STATUS.disabled);
}

export function sessionRequired(): Response {
  return errorResponse("session_required", "Sign in to use the lender database.", 401);
}

export function roleForbidden(): Response {
  return errorResponse("role_forbidden", "This account cannot browse lenders.", 403);
}

export function invalidRequest(message: string): Response {
  return errorResponse("invalid_request", message, 400);
}

function accessStatus(error: unknown): 401 | 402 | 403 | null {
  if (typeof error !== "object" || error === null || !("status" in error)) return null;
  const status = (error as { status: unknown }).status;
  return status === 401 || status === 402 || status === 403 ? status : null;
}

export function failureResponse(error: unknown): Response {
  const status = accessStatus(error);
  if (status === 401) return sessionRequired();
  if (status === 402) return errorResponse("ORG_DEACTIVATED", "This organization is deactivated.", 402);
  if (status === 403) return roleForbidden();

  if (error instanceof VaultError) {
    return errorResponse(error.code, ERROR_MESSAGE[error.code], ERROR_STATUS[error.code]);
  }

  // An unknown error's message is the last thing that should be echoed: it is
  // the one place a driver or Postgres string could still be carrying a value.
  // The message stays off the wire and the cause is recorded server-side, with
  // the caller given the id that joins its 500 to that record.
  const id = recordRouteFailure({
    cause: error,
    code: "failed",
    status: ERROR_STATUS.failed,
    surface: "vault.failure_response",
  });
  return jsonResponse(
    withCorrelationId({ error: "failed", message: ERROR_MESSAGE.failed }, id),
    ERROR_STATUS.failed,
  );
}

/**
 * What each route needs from the world, so a test can supply it.
 *
 * The seams live here rather than in the route files because `routes.test.ts`
 * asserts that each route's module-scope imports are exactly the flag reader
 * and this module — the property that makes the flag-off branch provably free
 * of anything that could reach a database. A type imported from a third module
 * would widen that list for no gain; these belong beside the responses they
 * feed anyway.
 *
 * The role check is a port for the same reason the reader is: without it a
 * flag-on test would have to stand up a session, and the thing worth asserting
 * is that the route calls it at all, before it reads anything.
 */
export interface BankListPorts {
  listBanks(): Promise<BankListRow[]>;
  requireRole(...roles: readonly string[]): Promise<unknown>;
}

export interface BankDetailPorts {
  readBank(ref: string): Promise<BankDetailPayload | null>;
  requireRole(...roles: readonly string[]): Promise<unknown>;
}

/** The answer for a lender that is absent, unpublished, or never existed. */
export function bankNotFound(): Response {
  return errorResponse("not_found", ERROR_MESSAGE.not_found, ERROR_STATUS.not_found);
}
