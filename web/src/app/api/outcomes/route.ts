import { featureFlag } from "@/lib/env";
import {
  disabledResponse,
  failureResponse,
  invalidRequest,
  isBankRef,
  isUuid,
  jsonResponse,
  notFoundResponse,
  roleForbidden,
  sessionRequired,
} from "@/lib/applications/http";
import { BANK_STATS_LABEL } from "@/lib/applications/types";

// Two pure module-scope imports, exactly as the applications routes have, so
// the flag-off branch answers before anything loadable is loaded and
// `routes.test.ts` can assert that by source position.

/**
 * The three reads this collection offers, and a caller picks exactly one.
 *
 * The pending-review queue is `?review=pending` rather than a
 * `/api/outcomes/reviews` sibling of `[id]`. Neither the vendored
 * `route.md` nor `dynamic-routes.md` states which of a static and a dynamic
 * segment at the same level wins, and a grep across the whole vendored docs
 * tree finds no such sentence anywhere (pre-flight P-03, `docs/GAPS.md`
 * G-11-01). Designing around an unstated resolution order costs one query
 * parameter; depending on it costs a debugging session the first time it
 * resolves the other way.
 */
const QUERY_FORMS = ["clientId", "review", "bankRef"] as const;
type QueryForm = (typeof QUERY_FORMS)[number];

function isQueryForm(value: string): value is QueryForm {
  return (QUERY_FORMS as readonly string[]).includes(value);
}

export async function GET(request: Request) {
  if (!featureFlag("FEATURE_APPLICATIONS")) return disabledResponse();

  const params = new URL(request.url).searchParams;
  const keys = [...params.keys()];

  // Exactly one key, counted before de-duplication: zero forms, two forms and a
  // repeated form are all a 400. A silently preferred branch would make the
  // answer depend on parameter order, which is not something a caller can see.
  if (keys.length !== 1 || !isQueryForm(keys[0])) {
    return invalidRequest(
      "Supply exactly one of clientId, review or bankRef.",
    );
  }
  const form: QueryForm = keys[0];

  const clientId = params.get("clientId");
  const bankRef = params.get("bankRef");

  if (form === "clientId" && !isUuid(clientId)) {
    return invalidRequest("clientId must be a UUID.");
  }
  if (form === "review" && params.get("review") !== "pending") {
    // `pending` is the only queue there is. Accepting `approved` here would
    // read as a decided-corrections log, which is the audit log's job.
    return invalidRequest("review accepts pending only.");
  }
  if (form === "bankRef" && !isBankRef(bankRef)) {
    return invalidRequest("bankRef must be a lender handle.");
  }

  try {
    const [{ getSession }, { clientReachable }, applications] =
      await Promise.all([
        import("@/lib/auth/session"),
        import("@/lib/applications/access"),
        import("@/lib/applications"),
      ]);

    const session = await getSession();
    if (!session) return sessionRequired();

    if (form === "review") {
      // 403, never an empty 200 (T-11-31): an empty list is a different and
      // misleading answer, and it would let any caller learn the queue exists
      // and infer its size from how the surface behaves.
      //
      // With `FEATURE_REAL_AUTH` on, `outcome_reviews_select_scoped` scopes the
      // read underneath as well, so a mistake here is not on its own enough.
      // With the flag off — the committed default — the repository falls back
      // to the admin client (G-11-09) and this line is the whole gate, which is
      // why it is a role comparison and not a filter.
      if (session.role !== "platform_admin") return roleForbidden();
      return jsonResponse(
        { reviews: await applications.listPendingReviews() },
        200,
      );
    }

    if (form === "bankRef") {
      // This aggregate crosses tenancy on purpose. `bank_outcome_stats` is one
      // row per lender built from every organization's outcomes, which is the
      // whole point of pooling them, and the row carries no client, profile or
      // org identifier — 081's pgTAP asserts both halves. `docs/GAPS.md`
      // G-11-03 is where the reasoning lives, so this does not read as a leak
      // to the next person who finds an unscoped read in a multi-tenant app.
      const stats = await applications.readBankStats(bankRef as string);
      if (stats === null) {
        // No row means no counted outcome for this lender yet. Returning a
        // zeroed row instead would make "the refresh job ran" and "the refresh
        // job has not run" indistinguishable, and plan 07's e2e watches
        // exactly that distinction.
        return notFoundResponse("No outcomes are recorded for this lender yet.");
      }
      return jsonResponse({ stats, message: BANK_STATS_LABEL }, 200);
    }

    if (!(await clientReachable(session, clientId as string))) {
      return notFoundResponse();
    }
    return jsonResponse(
      { outcomes: await applications.listOutcomesWithReviews(clientId as string) },
      200,
    );
  } catch (error) {
    return failureResponse(error);
  }
}
