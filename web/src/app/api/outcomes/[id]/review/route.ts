import { featureFlag } from "@/lib/env";
import {
  disabledResponse,
  errorResponse,
  failureResponse,
  hasOnlyKeys,
  invalidRequest,
  isRecord,
  isUuid,
  jsonResponse,
  roleForbidden,
  sessionRequired,
} from "@/lib/applications/http";
import {
  WRITEBACK_RECORDED_LABEL,
  type OutcomeReviewState,
  type VaultWritebackState,
} from "@/lib/applications/types";

type RouteContext<Path extends "/api/outcomes/[id]/review"> =
  Path extends string ? { params: Promise<{ id: string }> } : never;

const REVIEW_KEYS = ["decision"] as const;
const DECISIONS = ["approved", "removed"] as const;
type Decision = (typeof DECISIONS)[number];

/**
 * What actually happened, said in the words the state supports.
 *
 * The message is derived from the outbox state rather than from the decision,
 * because those two answer different questions: the decision is what a platform
 * admin chose, and the outbox state is whether anything left this system. On
 * the committed `fixture` driver nothing has, so `recorded` is the honest word.
 * The pre-flight's third pass names a "last synchronised N minutes ago" badge as
 * the canonical infrastructure claim with nothing behind it; a delivery sentence
 * over an undelivered row is the same statement wearing a different verb. That
 * verb is banned outright under this tree and `routes.test.ts` checks for it,
 * which is why this comment does not spell it either.
 */
function decisionMessage(
  reviewState: OutcomeReviewState,
  outboxState: VaultWritebackState | null,
  failureCode: string | null,
): string {
  if (reviewState !== "approved") {
    // `review_outcome` dropped the staged row and the trigger enqueued the
    // recompute inside the same transaction, so both halves of this sentence
    // are already true by the time a caller reads it.
    return "This outcome is corrected and the lender's recorded history will refresh.";
  }
  if (outboxState === null) {
    // No staged row: the write-back for this outcome was already delivered on
    // an earlier pass, so there is nothing new to stage and nothing to claim.
    return "This outcome counts toward the lender's recorded history.";
  }
  if (outboxState === "delivered") {
    // The only branch that may say this, and it is reachable only from the
    // `supabase` write-back arm, which needs a VAULT service key (KA-11-1).
    // Nothing on the committed default arm can get here.
    return "Sent to the funding brain.";
  }
  if (outboxState === "failed") {
    return `The write-back is staged and will be retried (${failureCode ?? "transport"}).`;
  }
  return WRITEBACK_RECORDED_LABEL;
}

export async function POST(
  request: Request,
  context: RouteContext<"/api/outcomes/[id]/review">,
) {
  if (!featureFlag("FEATURE_APPLICATIONS")) return disabledResponse();

  const { id } = await context.params;
  if (!isUuid(id)) return invalidRequest("The outcome id must be a UUID.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidRequest("The request body must be valid JSON.");
  }
  if (!isRecord(body)) {
    return invalidRequest("The request body contains unsupported fields.");
  }
  if ("reasonCode" in body) {
    // `outcome_reviews.reason_code` exists with a 1-64 length check, and
    // `public.review_outcome` has no parameter that writes it — the column has
    // no writer at all today. Accepting the field and dropping it would be a
    // silent no-op, and writing it around the definer function would be a
    // second write path to a table whose whole point is that only that function
    // changes it. So it is refused until a migration widens the function's
    // signature, and the refusal says which of the two it is.
    return invalidRequest("reasonCode is not recorded yet.");
  }
  if (!hasOnlyKeys(body, REVIEW_KEYS)) {
    return invalidRequest("The request body contains unsupported fields.");
  }
  if (body.decision === "pending") {
    // `pending` is where a review starts, not something an admin can choose.
    // The function raises `22023` on it too; this is the readable half.
    return invalidRequest("A decision is approved or removed, never pending.");
  }
  if (!(DECISIONS as readonly unknown[]).includes(body.decision)) {
    return invalidRequest("decision must be approved or removed.");
  }
  const decision = body.decision as Decision;

  try {
    const [{ getSession }, applications] = await Promise.all([
      import("@/lib/auth/session"),
      import("@/lib/applications"),
    ]);

    const session = await getSession();
    if (!session) return sessionRequired();
    // Two independent checks, and both are wanted (T-11-30). This one gives a
    // clean 403 without a round trip; `public.review_outcome` reads
    // `profiles.role` itself and raises `42501`, which the repository maps to
    // `forbidden` and `failureResponse` turns into the same 403. Deleting this
    // guard would not open the path — it would only make the answer slower.
    if (session.role !== "platform_admin") return roleForbidden();

    const decided = await applications.reviewOutcome({
      outcomeId: id,
      decision,
      // Session-derived, and the function checks it against `auth.uid()` on the
      // browser-scoped arm, so a forged actor cannot be recorded either way.
      actorProfileId: session.id,
    });

    if (decided.result === "unchanged") {
      // The same decision was already in force, so the database wrote nothing:
      // no second outbox row, no second alert, no second audit entry. A 200
      // here would report a write that did not happen.
      return errorResponse(
        "conflict",
        "This correction is already in force.",
        409,
      );
    }

    // Drain this lender's refresh job inline, best effort, exactly as the
    // outcome-entry route does and for the same reason: the trigger enqueues
    // the recompute but nothing in this repository schedules a worker
    // (`web/src/lib/analysis/worker.ts` has no production caller either), so
    // without this call ROADMAP criterion 1 would hold in pgTAP and quietly
    // not hold in the running system. A throw or a lease already held by a
    // concurrent request leaves the row `queued` for whatever drains it next
    // and changes nothing about this response. `docs/GAPS.md` G-11-07 records
    // that a scheduled drainer is still owed by whichever phase owns
    // background execution.
    try {
      await applications.drainOutcomeRefreshJobs(undefined, {
        maxIterations: 1,
      });
    } catch {
      // Swallowed on purpose: the correction is committed and a stale
      // aggregate is not a reason to tell an admin their decision failed.
    }

    return jsonResponse(
      {
        result: decided.result,
        reviewState: decided.reviewState,
        outboxState: decided.outboxState,
        notified: decided.notified,
        message: decisionMessage(
          decided.reviewState,
          decided.outboxState,
          decided.delivery?.failureCode ?? null,
        ),
      },
      200,
    );
  } catch (error) {
    // A VAULT failure never reaches here: the service catches it, marks the
    // outbox row and returns, so an unreachable third party cannot stop a
    // platform admin correcting a lender's counted history (T-11-34).
    return failureResponse(error, {
      not_found: "The outcome was not found.",
    });
  }
}
