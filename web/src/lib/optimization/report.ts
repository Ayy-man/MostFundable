import {
  CONSUMER_REPORTABLE_TEMPLATE_KEY_BY_FACTOR_KEY,
  CONSUMER_REPORT_ACTIONS_V1,
} from "./map.ts";

import type { ConsumerReportActionV1 } from "./map.ts";

export type { ConsumerReportActionV1 } from "./map.ts";

/**
 * Why a report was refused.
 *
 * `invalid_request` — the body did not name a reportable factor or one of the two actions. Decided
 * here, before the database is touched, so a typo never becomes a permission answer.
 * `forbidden` — the session may not write this at all: wrong role, or no session behind the flag.
 * `conflict` — the row is not where the caller thought it was. A factor the pipeline is verifying,
 * a second click on a report that already landed, or a consumer with no active client record.
 * Every one of those is a stale caller rather than a broken platform, and the surface's answer is
 * the same in all three: re-read and re-render.
 * `write_failed` — anything else. Never folded into one of the above.
 */
export type OptimizationReportErrorCode =
  | "conflict"
  | "forbidden"
  | "invalid_request"
  | "write_failed";

export class OptimizationReportError extends Error {
  readonly name = "OptimizationReportError";
  readonly code: OptimizationReportErrorCode;

  // Not a constructor parameter property: Node's strip-only TypeScript mode rejects those, and
  // this module is reachable from `node --test`.
  constructor(code: OptimizationReportErrorCode) {
    super("Optimization report failed");
    this.code = code;
  }
}

export interface OptimizationReportRequest {
  readonly factorKey: string;
  readonly action: ConsumerReportActionV1;
}

/**
 * The `raise` messages migration 391 uses, and what each one means to a caller.
 *
 * Keyed by the message the function raises rather than by SQLSTATE, because the codes are shared
 * (`42501` also arrives from a plain grant refusal) while the messages are this function's own.
 * A message that is not in this table is deliberately NOT guessed at: it becomes `write_failed`
 * and reaches the diagnostics seam with its cause, which is the honest answer for a refusal
 * nobody here has read.
 */
const REFUSAL_BY_MESSAGE: Readonly<Record<string, OptimizationReportErrorCode>> = Object.freeze({
  CHECKLIST_ACTION_INVALID: "invalid_request",
  CHECKLIST_ACTOR_REQUIRED: "forbidden",
  CHECKLIST_CLIENT_NOT_FOUND: "conflict",
  CHECKLIST_FORBIDDEN: "forbidden",
  CHECKLIST_TEMPLATE_NOT_REPORTABLE: "invalid_request",
  CHECKLIST_TEMPLATE_UNKNOWN: "conflict",
  CHECKLIST_TRANSITION_FORBIDDEN: "conflict",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Is this action one the platform understands? Derived from the action list, never retyped. */
export function isReportAction(value: unknown): value is ConsumerReportActionV1 {
  return (CONSUMER_REPORT_ACTIONS_V1 as readonly string[]).includes(value as string);
}

/**
 * Read a request body into the two values the write needs, or refuse it.
 *
 * The factor key is checked against the reportable table rather than against a list written here,
 * so the route can never accept a key the map does not know how to translate. It is still not the
 * boundary: migration 391 refuses the same set in SQL, and that refusal is the one a caller who
 * skips this route runs into.
 */
export function parseReportRequest(body: unknown): OptimizationReportRequest {
  if (!isRecord(body)) throw new OptimizationReportError("invalid_request");
  const { factorKey, action } = body;
  if (typeof factorKey !== "string" || !isReportAction(action)) {
    throw new OptimizationReportError("invalid_request");
  }
  if (CONSUMER_REPORTABLE_TEMPLATE_KEY_BY_FACTOR_KEY[factorKey] === undefined) {
    throw new OptimizationReportError("invalid_request");
  }
  return { action, factorKey };
}

/** The template key a factor reports under, or a refusal when it reports under none. */
export function templateKeyForFactor(factorKey: string): string {
  const templateKey = CONSUMER_REPORTABLE_TEMPLATE_KEY_BY_FACTOR_KEY[factorKey];
  if (templateKey === undefined) throw new OptimizationReportError("invalid_request");
  return templateKey;
}

/**
 * Turn whatever the database said into one of the four answers above.
 *
 * The message is matched as a substring because PostgREST wraps the raised message in its own
 * envelope on some paths; the tokens are unique enough that a substring match cannot collide with
 * another function's refusal.
 */
export function reportErrorFor(error: unknown): OptimizationReportError {
  if (error instanceof OptimizationReportError) return error;
  const message = isRecord(error) && typeof error.message === "string" ? error.message : "";
  for (const [token, code] of Object.entries(REFUSAL_BY_MESSAGE)) {
    if (message.includes(token)) return new OptimizationReportError(code);
  }
  return new OptimizationReportError("write_failed");
}
