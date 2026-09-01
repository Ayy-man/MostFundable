import { featureFlag } from "@/lib/env";
import {
  disabledResponse,
  failureResponse,
  hasOnlyKeys,
  invalidRequest,
  isBankRef,
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

// Only two module-scope imports, and both are pure: the flag reader and the
// response shapes. Everything that could touch a database is loaded inside a
// handler, after the flag check has already returned. `routes.test.ts` asserts
// that ordering by source position, because it is a claim about what this file
// does before it does anything, and a passing request cannot tell "the flag was
// off" apart from "the database was fast".

const CREATE_KEYS = [
  "clientId",
  "bankRef",
  "operatorStatus",
  "consumerStatus",
  "amountCents",
  "visibility",
] as const;

function validAmount(value: unknown): value is number | null | undefined {
  return (
    value === undefined ||
    value === null ||
    (Number.isSafeInteger(value) && (value as number) >= 0)
  );
}

export async function GET(request: Request) {
  if (!featureFlag("FEATURE_APPLICATIONS")) return disabledResponse();

  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => key !== "clientId")) {
    return invalidRequest("The applications filter is not supported.");
  }
  const clientId = params.get("clientId");
  // No `scope=all`: the policy is the scope, and a second selector here would
  // eventually disagree with `private.can_access_client`.
  if (!isUuid(clientId)) return invalidRequest("clientId must be a UUID.");

  try {
    const [{ getSession }, { clientReachable }, { listApplications }] =
      await Promise.all([
        import("@/lib/auth/session"),
        import("@/lib/applications/access"),
        import("@/lib/applications"),
      ]);

    const session = await getSession();
    if (!session) return sessionRequired();
    if (!(await clientReachable(session, clientId))) {
      // The same 404 an unknown id gets, so a response cannot be used to learn
      // that another organization has this client (T-11-26).
      return notFoundResponse();
    }

    return jsonResponse(
      { applications: await listApplications(clientId) },
      200,
    );
  } catch (error) {
    return failureResponse(error);
  }
}

export async function POST(request: Request) {
  if (!featureFlag("FEATURE_APPLICATIONS")) return disabledResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidRequest("The request body must be valid JSON.");
  }

  if (!isRecord(body) || !hasOnlyKeys(body, CREATE_KEYS)) {
    return invalidRequest("The request body contains unsupported fields.");
  }
  if (!isUuid(body.clientId)) return invalidRequest("clientId must be a UUID.");
  if (!isBankRef(body.bankRef)) {
    return invalidRequest("bankRef must be a lender handle.");
  }
  if (!validAmount(body.amountCents)) {
    return invalidRequest("amountCents must be a non-negative whole number.");
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

  const clientId = body.clientId;

  try {
    const [{ requireOrgMember }, { assertTenantWriteAllowed }, { clientReachable }, { createApplication }] =
      await Promise.all([
        import("@/lib/auth/session"),
        import("@/lib/tenancy/wall"),
        import("@/lib/applications/access"),
        import("@/lib/applications"),
      ]);

    const session = await requireOrgMember();
    await assertTenantWriteAllowed(session);
    if (!(await clientReachable(session, clientId))) return notFoundResponse();

    const created = await createApplication({
      clientId,
      bankRef: body.bankRef,
      amountCents: (body.amountCents as number | null | undefined) ?? null,
      ...(body.operatorStatus === undefined
        ? {}
        : { operatorStatus: body.operatorStatus as ApplicationOperatorStatus }),
      ...(body.consumerStatus === undefined
        ? {}
        : { consumerStatus: body.consumerStatus as ApplicationConsumerStatus }),
      ...(body.visibility === undefined
        ? {}
        : { visibility: body.visibility as ApplicationVisibility }),
      // Never from the body: the actor is whoever holds the session.
      createdBy: session.id,
    });

    return jsonResponse(created, 201);
  } catch (error) {
    return failureResponse(error, {
      conflict: "This client already has an application with that lender.",
    });
  }
}
