// Browser-safe boundary: keep every server, provider, and database import out.
//
// R5B-03 / R5B-04 / R5B-05 / R5C-07. Roughly ninety catch sites across the money routes, the
// authenticated workflow routes and the shared ancillary mapper used to collapse an unknown cause
// into a generic status with no server-side record at all — the reviewers replaced `console.error`
// with a counter and it returned zero on every probe. This module is the one place that record is
// written, so a production 500 can be tied to a log line instead of being an unexplained blank.
//
// Three properties hold it together:
//
// 1. **One seam, not ninety `console.error` calls.** The shared mappers already exist at the right
//    level; the recording point belongs beside them. A route reaches the seam by calling its
//    mapper, so a new route that uses a mapper is covered without doing anything.
// 2. **The correlation id is in the response body.** A redacted body that says only
//    `billing_unavailable` cannot be joined to anything. The id is the single field the response is
//    allowed to grow (R5 triage: "Do not widen any redacted response body beyond adding the
//    correlation id"), and it is emitted on the unknown-cause path only — a deliberate refusal or a
//    named domain error keeps the byte-identical body it already had.
// 3. **Identifiers only, never content.** The two-rails rule binds the log stream exactly as it
//    binds storage. This module records a cause *classification*, the thrown value's `name`, and a
//    `code` that has to match a strict identifier pattern to be recorded at all. It never records a
//    message, a response body, a bureau record, a Stripe object, a header, a session token or a
//    provider secret — there is no field on `RouteFailureRecord` that could carry one.
//
// No imports on purpose. `@/lib/billing/http` documents itself as importing nothing but types so it
// is safe to load before a flag check, and `@/lib/applications/http` makes the same promise; a
// `node:crypto` import here would break both. `globalThis.crypto.randomUUID` is available in the
// Node runtime and on the Edge runtime alike.

export const ROUTE_FAILURE_EVENT = "route_failure";

/**
 * What kind of thing was thrown. This is the classification the triage asked for: enough to tell a
 * driver rejection from a Postgres refusal from a bare string, and nothing that could be a value.
 */
export type RouteFailureCauseKind = "error" | "object" | "string" | "empty" | "other";

export interface RouteFailureRecord {
  readonly event: typeof ROUTE_FAILURE_EVENT;
  /** Echoed in the response body so a caller's 500 and this line can be joined. */
  readonly correlationId: string;
  /** The mapper or route that answered, e.g. `billing.errorFor` or `api.uploads.credit_report`. */
  readonly surface: string;
  /** The closed-vocabulary code the caller was given. */
  readonly code: string;
  readonly status: number;
  readonly causeKind: RouteFailureCauseKind;
  /** `error.name` when it is an identifier — `AppError`, `TypeError`, `MisconfiguredDriverError`. */
  readonly causeName: string | null;
  /** `error.code` when it is an identifier — a SQLSTATE like `57014`, `ECONNREFUSED`, a provider code. */
  readonly causeCode: string | null;
  readonly at: string;
}

export type RouteFailureSink = (record: RouteFailureRecord) => void;

// Deliberately strict. A SQLSTATE, a Node errno, a Stripe code and our own codes all fit; a Postgres
// sentence, a URL, a JSON blob and anything carrying whitespace or a row value do not. Anything that
// fails this test is dropped rather than truncated, because a truncated payload is still a payload.
const IDENTIFIER = /^[A-Za-z0-9_.:-]{1,64}$/;

function defaultSink(record: RouteFailureRecord): void {
  console.error(`[${ROUTE_FAILURE_EVENT}] ${JSON.stringify(record)}`);
}

let sink: RouteFailureSink = defaultSink;

/**
 * Swap the sink. Returns a restore function so a test never has to remember what was there before.
 * Passing `null` restores the console writer.
 */
export function setRouteFailureSink(next: RouteFailureSink | null): () => void {
  const previous = sink;
  sink = next ?? defaultSink;
  return () => {
    sink = previous;
  };
}

let counter = 0;

function correlationId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (typeof uuid === "string") return uuid;
  counter += 1;
  return `rf-${Date.now().toString(36)}-${counter.toString(36)}`;
}

function identifier(value: unknown): string | null {
  return typeof value === "string" && IDENTIFIER.test(value) ? value : null;
}

function classify(cause: unknown): Pick<RouteFailureRecord, "causeCode" | "causeKind" | "causeName"> {
  if (cause === null || cause === undefined) {
    return { causeCode: null, causeKind: "empty", causeName: null };
  }
  if (typeof cause === "string") {
    // The string itself is not recorded: a thrown string is as likely to be a Postgres sentence as
    // an identifier, and there is no way to tell from here.
    return { causeCode: null, causeKind: "string", causeName: null };
  }
  if (cause instanceof Error) {
    return {
      causeCode: identifier((cause as { code?: unknown }).code),
      causeKind: "error",
      causeName: identifier(cause.name),
    };
  }
  if (typeof cause === "object") {
    const row = cause as { code?: unknown; name?: unknown };
    return {
      causeCode: identifier(row.code),
      causeKind: "object",
      causeName: identifier(row.name),
    };
  }
  return { causeCode: null, causeKind: "other", causeName: null };
}

/**
 * Record one unknown-cause route failure and return the correlation id to put in the response.
 *
 * Call this only on the branch where the cause was *not* recognised. A 401 a caller earned, a 404
 * for a row that does not exist and a 409 the domain refused are all answers, not failures, and
 * recording them would bury the outages this exists to surface.
 */
export function recordRouteFailure(input: {
  cause: unknown;
  code: string;
  status: number;
  surface: string;
}): string {
  const id = correlationId();
  sink({
    at: new Date().toISOString(),
    correlationId: id,
    event: ROUTE_FAILURE_EVENT,
    ...classify(input.cause),
    code: input.code,
    status: input.status,
    surface: input.surface,
  });
  return id;
}

/** The one field an unknown-cause response body is allowed to grow. */
export function withCorrelationId<T extends object>(
  body: T,
  id: string,
): T & { correlationId: string } {
  return { ...body, correlationId: id };
}
