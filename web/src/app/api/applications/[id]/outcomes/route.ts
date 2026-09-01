import { featureFlag } from "@/lib/env";
import {
  disabledResponse,
  failureResponse,
  hasOnlyKeys,
  invalidRequest,
  isIsoDate,
  isRecord,
  isUuid,
  jsonResponse,
  notFoundResponse,
  roleForbidden,
  sessionRequired,
} from "@/lib/applications/http";
import {
  OUTCOME_COUNTED_LABEL,
  OUTCOME_KIND_VALUES,
  type OutcomeKind,
} from "@/lib/applications/types";

type RouteContext<Path extends "/api/applications/[id]/outcomes"> =
  Path extends string ? { params: Promise<{ id: string }> } : never;

const OUTCOME_KEYS = ["kind", "amountCents", "decidedOn"] as const;
const RECORDING_ROLES = new Set(["operator_member", "platform_admin", "consumer"]);

export async function POST(
  request: Request,
  context: RouteContext<"/api/applications/[id]/outcomes">,
) {
  if (!featureFlag("FEATURE_APPLICATIONS")) return disabledResponse();

  const { id } = await context.params;
  if (!isUuid(id)) return invalidRequest("The application id must be a UUID.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidRequest("The request body must be valid JSON.");
  }
  if (!isRecord(body) || !hasOnlyKeys(body, OUTCOME_KEYS)) {
    return invalidRequest("The request body contains unsupported fields.");
  }
  if (!OUTCOME_KIND_VALUES.includes(body.kind as OutcomeKind)) {
    return invalidRequest("kind must be approved, denied or withdrawn.");
  }
  const kind = body.kind as OutcomeKind;

  // `outcomes_amount_shape` in migration 080: an approved outcome carries a
  // positive amount and no other kind carries one. The route says which half
  // is wrong; the constraint is still what makes it true.
  const amountCents = body.amountCents === undefined ? null : body.amountCents;
  if (kind === "approved") {
    if (!(Number.isSafeInteger(amountCents) && (amountCents as number) > 0)) {
      return invalidRequest("An approved outcome needs a positive amountCents.");
    }
  } else if (amountCents !== null) {
    return invalidRequest("Only an approved outcome carries an amount.");
  }

  // Absent means "let the database date it", which is `current_date` inside
  // `record_outcome` — one clock rather than two.
  if (body.decidedOn !== undefined && !isIsoDate(body.decidedOn)) {
    return invalidRequest("decidedOn must be a YYYY-MM-DD date.");
  }
  const decidedOn = body.decidedOn === undefined ? null : (body.decidedOn as string);

  try {
    const [
      { getSession },
      { assertTenantWriteAllowed },
      { clientReachable },
      { readApplication, recordOutcome, drainOutcomeRefreshJobs },
    ] = await Promise.all([
      import("@/lib/auth/session"),
      import("@/lib/tenancy/wall"),
      import("@/lib/applications/access"),
      import("@/lib/applications"),
    ]);

    const session = await getSession();
    if (!session) return sessionRequired();
    if (!RECORDING_ROLES.has(session.role)) return roleForbidden();
    await assertTenantWriteAllowed(session);

    const application = await readApplication(id);
    if (application === null) return notFoundResponse();
    if (!(await clientReachable(session, application.clientId))) {
      return notFoundResponse();
    }

    // `public.record_outcome` writes the counted outcome, the trigger opens the
    // pending review, and a second trigger enqueues the recompute — all in one
    // transaction, so this layer cannot skip any of the three. The stage move to
    // Funded happens inside the service and is best effort; an `unavailable`
    // result is reported in the body and never changes the status.
    const recorded = await recordOutcome({
      applicationId: id,
      kind,
      amountCents: kind === "approved" ? (amountCents as number) : null,
      decidedOn,
      // Session-derived. `recorded_by` is not settable from a browser (T-11-29).
      actorProfileId: session.id,
    });

    // Drain this bank's refresh job inline.
    //
    // Nothing in this repository schedules a worker — `drainAnalysisQueue` at
    // `web/src/lib/analysis/worker.ts:260` has no production caller either — so
    // a queued row would sit unread and the lender's stats would be right in
    // pgTAP and stale in the running system. The recompute is in-database and
    // bounded to one bank, so inline costs one round trip, and the queue keeps
    // its real job: idempotency and retry. If this throws, or a concurrent
    // request already holds the lease, the row stays queued for whatever drains
    // it next and the response is unchanged. `docs/GAPS.md` G-11-07.
    try {
      await drainOutcomeRefreshJobs(undefined, { maxIterations: 1 });
    } catch {
      // Deliberately swallowed: the outcome is already durable and already
      // counted, and a stale aggregate is not a reason to fail the entry.
    }

    return jsonResponse(
      {
        outcome: recorded.outcome,
        review: recorded.review,
        stage: recorded.stage,
        message: OUTCOME_COUNTED_LABEL,
      },
      201,
    );
  } catch (error) {
    return failureResponse(error, {
      conflict:
        "This application already has a counted outcome. A platform admin can correct it first.",
    });
  }
}
