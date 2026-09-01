import { recordRouteFailure, withCorrelationId } from "@/lib/diagnostics/route-failure";

export type TenantErrorCode =
  | "FEATURE_DISABLED"
  | "INVALID_TENANT_INPUT"
  | "ORG_DEACTIVATED"
  | "TENANT_ACTION_UNAVAILABLE"
  | "TENANT_CONFLICT"
  | "TENANT_INVITE_DELIVERY_FAILED"
  | "TENANT_INVITE_INVALID"
  | "TENANT_NOT_FOUND"
  | "TENANT_REACTIVATION_REQUIRES_TRIAL_EXTENSION"
  | "TENANT_SEAT_SYNC_FAILED"
  | "TENANT_REQUEST_FAILED";

export class TenantError extends Error {
  readonly code: TenantErrorCode;
  readonly status: number;

  constructor(status: number, code: TenantErrorCode, message: string) {
    super(message);
    this.name = "TenantError";
    this.status = status;
    this.code = code;
  }
}

export class TenantBillingWallError extends TenantError {
  constructor() {
    super(402, "ORG_DEACTIVATED", "This organization is deactivated.");
    this.name = "TenantBillingWallError";
  }
}

export function tenantErrorResponse(error: unknown): Response {
  if (error instanceof TenantError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }

  return unknownTenantFailure(error);
}

/**
 * The tenancy answer that means the cause was not recognised. R5B-04 records it here — a
 * provisioning, invite or brand route that 500s in production now leaves a line naming the throw's
 * class and code, and the caller carries the id that points at it.
 */
export function unknownTenantFailure(
  error: unknown,
  surface = "tenancy.error_response",
): Response {
  const id = recordRouteFailure({
    cause: error,
    code: "TENANT_REQUEST_FAILED",
    status: 500,
    surface,
  });
  return Response.json(
    withCorrelationId(
      {
        error: {
          code: "TENANT_REQUEST_FAILED" as const,
          message: "The tenant request could not be completed.",
        },
      },
      id,
    ),
    { status: 500 },
  );
}
