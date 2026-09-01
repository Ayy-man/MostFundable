import { featureFlag } from "@/lib/env";
import {
  disabledResponse,
  failureResponse,
  invalidRequest,
  isUuid,
  jsonResponse,
  notFoundResponse,
  sessionRequired,
} from "@/lib/applications/http";

// Next generates the equivalent global helper during build/typegen. The
// route-local fallback lets a plain `tsc --noEmit` run before the first build
// in a clean checkout — copied from `web/src/app/api/clients/[id]/route.ts:12-14`.
type RouteContext<Path extends "/api/outcomes/[id]"> = Path extends string
  ? { params: Promise<{ id: string }> }
  : never;

export async function GET(
  _request: Request,
  context: RouteContext<"/api/outcomes/[id]">,
) {
  if (!featureFlag("FEATURE_APPLICATIONS")) return disabledResponse();

  const { id } = await context.params;
  if (!isUuid(id)) return invalidRequest("The outcome id must be a UUID.");

  try {
    const [{ getSession }, { clientReachable }, applications] =
      await Promise.all([
        import("@/lib/auth/session"),
        import("@/lib/applications/access"),
        import("@/lib/applications"),
      ]);

    const session = await getSession();
    if (!session) return sessionRequired();

    const found = await applications.readOutcome(id);
    // An unknown id and an out-of-reach one answer identically, so a status
    // code cannot be used to learn that another organization has this outcome
    // (T-11-26).
    if (found === null) return notFoundResponse();
    if (!(await clientReachable(session, found.outcome.clientId))) {
      return notFoundResponse();
    }

    // The outbox state goes to a platform admin and to nobody else (T-11-32).
    // It is operational detail about a third-party integration: an operator
    // reading "recorded" learns nothing it can act on, and it would invite the
    // reading that an outcome does not count until something external accepts
    // it, which is the opposite of how `outcomes.state` works.
    const outbox =
      session.role === "platform_admin"
        ? { outboxState: await applications.readWritebackState(id) }
        : {};

    return jsonResponse(
      { outcome: found.outcome, review: found.review, ...outbox },
      200,
    );
  } catch (error) {
    return failureResponse(error);
  }
}
