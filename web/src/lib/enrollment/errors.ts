import { recordRouteFailure, withCorrelationId } from "@/lib/diagnostics/route-failure";

export type AppErrorCode =
  | "EMAIL_ALREADY_REGISTERED"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "invalid_payload"
  | "payment_field_rejected"
  | "identity_account_exists"
  | "identity_verification_failed"
  | "conflict"
  | "billing_configuration"
  | "settlement_blocked"
  | "driver_unavailable"
  | "unexpected";

const STATUS_BY_CODE: Readonly<Record<AppErrorCode, number>> = {
  EMAIL_ALREADY_REGISTERED: 409,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid_payload: 400,
  payment_field_rejected: 400,
  identity_account_exists: 409,
  identity_verification_failed: 422,
  conflict: 409,
  billing_configuration: 409,
  settlement_blocked: 409,
  driver_unavailable: 503,
  unexpected: 500,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  /**
   * Set when the throw site already recorded the cause through the diagnostics seam.
   *
   * Deep code cannot answer with a `Response`, so a mapper that wanted both a real status and a
   * correlation id previously had to choose: throw an `AppError` and lose the id, or fall through to
   * `unknownEnrollmentFailure` and take 500. Carrying the id on the error lets the boundary echo it,
   * which is what `route-failure-coverage` requires of anything that records — a recorded failure
   * the caller cannot name is a log nobody can join a support report to.
   */
  readonly correlationId?: string;

  constructor(
    code: AppErrorCode,
    message: string,
    status = STATUS_BY_CODE[code],
    correlationId?: string,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    if (correlationId !== undefined) this.correlationId = correlationId;
  }
}

export function toHttpResponse(err: unknown): Response {
  if (err instanceof AppError) {
    // A row outside the actor's scope maps to not_found, not forbidden, so the
    // response does not confirm which enrollment identifiers exist.
    const body = { error: { code: err.code, message: err.message } };
    return Response.json(
      err.correlationId === undefined ? body : withCorrelationId(body, err.correlationId),
      { status: err.status },
    );
  }

  if (
    err instanceof Error &&
    err.name === "SessionAccessError" &&
    "status" in err &&
    (err.status === 401 || err.status === 403)
  ) {
    const code: AppErrorCode = err.status === 401 ? "unauthenticated" : "forbidden";
    return Response.json(
      {
        error: {
          code,
          message: err.status === 401 ? "Authentication is required." : "Access is denied.",
        },
      },
      { status: err.status },
    );
  }

  return unknownEnrollmentFailure(err);
}

/**
 * The `unexpected` 500 every enrollment route shares — the one answer that means the cause was not
 * recognised. R5B-04: it is recorded here rather than discarded, and the caller is handed the
 * correlation id so a support report can name the line instead of the symptom.
 */
export function unknownEnrollmentFailure(
  err: unknown,
  surface = "enrollment.to_http_response",
): Response {
  const id = recordRouteFailure({ cause: err, code: "unexpected", status: 500, surface });
  return Response.json(
    withCorrelationId(
      {
        error: {
          code: "unexpected" as const,
          message: "The request could not be completed.",
        },
      },
      id,
    ),
    { status: 500 },
  );
}
