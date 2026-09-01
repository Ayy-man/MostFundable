import { featureFlag } from "@/lib/env";
import {
  disabledResponse,
  failureResponse,
  hasOnlyKeys,
  invalidRequest,
  isRecord,
  isUuid,
  jsonResponse,
  notFoundResponse,
  sessionRequired,
} from "@/lib/applications/http";
import {
  APPLICATION_CONSUMER_STATUS_VALUES,
  APPLICATION_OPERATOR_STATUS_VALUES,
  APPLICATION_VISIBILITY_VALUES,
  type ApplicationConsumerStatus,
  type ApplicationOperatorStatus,
  type ApplicationVisibility,
} from "@/lib/applications/types";

// Next generates the equivalent global helper during build/typegen. Keeping
// this route-local fallback lets the repository's plain `tsc --noEmit` script
// run before the first build in a clean checkout — copied from
// `web/src/app/api/clients/[id]/route.ts:12-14`.
type RouteContext<Path extends "/api/applications/[id]"> = Path extends string
  ? { params: Promise<{ id: string }> }
  : never;

// The exact four fields a caller may change. An unknown key is a 400 rather
// than a silent no-op, so a typo is visible and `state`, `clientId`,
// `createdBy` and every timestamp stay un-settable from a browser (T-11-25).
const PATCH_KEYS = [
  "operatorStatus",
  "consumerStatus",
  "amountCents",
  "visibility",
] as const;

export async function GET(
  _request: Request,
  context: RouteContext<"/api/applications/[id]">,
) {
  if (!featureFlag("FEATURE_APPLICATIONS")) return disabledResponse();

  const { id } = await context.params;
  if (!isUuid(id)) return invalidRequest("The application id must be a UUID.");

  try {
    const [{ getSession }, { clientReachable }, { readApplication }] =
      await Promise.all([
        import("@/lib/auth/session"),
        import("@/lib/applications/access"),
        import("@/lib/applications"),
      ]);

    const session = await getSession();
    if (!session) return sessionRequired();

    const application = await readApplication(id);
    // An unknown id and an unreachable one answer identically. Splitting them
    // would turn this route into a way to enumerate another tenant's records.
    if (application === null) return notFoundResponse();
    if (!(await clientReachable(session, application.clientId))) {
      return notFoundResponse();
    }

    return jsonResponse({ application }, 200);
  } catch (error) {
    return failureResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/applications/[id]">,
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
  if (!isRecord(body) || !hasOnlyKeys(body, PATCH_KEYS)) {
    return invalidRequest("The request body contains unsupported fields.");
  }
  if (Object.keys(body).length === 0) {
    return invalidRequest("The request body changes nothing.");
  }
  if (
    body.operatorStatus !== undefined &&
    !APPLICATION_OPERATOR_STATUS_VALUES.includes(
      body.operatorStatus as ApplicationOperatorStatus,
    )
  ) {
    return invalidRequest("operatorStatus is not a supported value.");
  }
  if (
    body.consumerStatus !== undefined &&
    !APPLICATION_CONSUMER_STATUS_VALUES.includes(
      body.consumerStatus as ApplicationConsumerStatus,
    )
  ) {
    return invalidRequest("consumerStatus is not a supported value.");
  }
  if (
    body.visibility !== undefined &&
    !APPLICATION_VISIBILITY_VALUES.includes(
      body.visibility as ApplicationVisibility,
    )
  ) {
    return invalidRequest("visibility is not a supported value.");
  }
  if (
    body.amountCents !== undefined &&
    body.amountCents !== null &&
    !(Number.isSafeInteger(body.amountCents) && (body.amountCents as number) >= 0)
  ) {
    return invalidRequest("amountCents must be a non-negative whole number.");
  }

  try {
    const [
      { requireOrgMember },
      { assertTenantWriteAllowed },
      { clientReachable },
      { readApplication, updateApplication },
    ] = await Promise.all([
      import("@/lib/auth/session"),
      import("@/lib/tenancy/wall"),
      import("@/lib/applications/access"),
      import("@/lib/applications"),
    ]);

    const session = await requireOrgMember();
    await assertTenantWriteAllowed(session);
    const existing = await readApplication(id);
    if (existing === null) return notFoundResponse();
    if (!(await clientReachable(session, existing.clientId))) {
      return notFoundResponse();
    }

    const application = await updateApplication({
      applicationId: id,
      ...(body.operatorStatus === undefined
        ? {}
        : { operatorStatus: body.operatorStatus as ApplicationOperatorStatus }),
      ...(body.consumerStatus === undefined
        ? {}
        : { consumerStatus: body.consumerStatus as ApplicationConsumerStatus }),
      ...(body.amountCents === undefined
        ? {}
        : { amountCents: body.amountCents as number | null }),
      ...(body.visibility === undefined
        ? {}
        : { visibility: body.visibility as ApplicationVisibility }),
    });

    return jsonResponse({ application }, 200);
  } catch (error) {
    return failureResponse(error);
  }
}
