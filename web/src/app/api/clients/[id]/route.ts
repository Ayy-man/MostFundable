import { recordRouteFailure, withCorrelationId } from "@/lib/diagnostics/route-failure";
import { featureFlag } from "@/lib/env";
import {
  isTrackerUuid,
  validateTrackerPatchInput,
} from "@/lib/tracker/types";

const privateHeaders = { "Cache-Control": "private, no-store" };

// Next generates the equivalent global helper during build/typegen. Keeping
// this route-local fallback lets the repository's plain `tsc --noEmit` script
// run before the first build in a clean checkout.
type RouteContext<Path extends "/api/clients/[id]"> = Path extends string
  ? { params: Promise<{ id: string }> }
  : never;

function errorResponse(code: string, message: string, status: number, detail?: Record<string, unknown>) {
  return Response.json({ error: { code, message, ...detail } }, { status, headers: privateHeaders });
}

function accessStatus(error: unknown): 401 | 402 | 403 | null {
  if (typeof error !== "object" || error === null || !("status" in error)) return null;
  return error.status === 401 || error.status === 402 || error.status === 403 ? error.status : null;
}

export function stageTransitionErrorResponse(error: unknown): Response | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  if (error.code !== "stage_transition_not_allowed") return null;
  return errorResponse(
    "stage_transition_not_allowed",
    "A stage can only move forward one step or back one step.",
    409,
  );
}

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/clients/[id]">,
) {
  if (!featureFlag("FEATURE_TRACKER")) {
    return errorResponse("tracker_disabled", "Funding readiness tracking is disabled.", 503);
  }
  const { id } = await context.params;
  if (!isTrackerUuid(id)) return errorResponse("invalid_request", "Client id must be a UUID.", 400);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_request", "The request body must be valid JSON.", 400);
  }
  const parsed = validateTrackerPatchInput(body);
  if (!parsed.ok) return errorResponse(parsed.code, parsed.message, 400);

  try {
    if ("stage" in parsed.value) {
      const [{ transitionClientStage }, { getSession }, { readTrackerClient }] = await Promise.all([
        import("@/lib/tracker/transition.server"),
        import("@/lib/auth/session"),
        import("@/lib/tracker/read.server"),
      ]);
      const result = await transitionClientStage({ clientId: id, stage: parsed.value.stage, expectedStage: parsed.value.expectedStage });
      if (result.outcome === "stale") return errorResponse("stale_stage", "The client stage changed before this request.", 409, { currentStage: result.currentStage });
      if (result.outcome === "not_found") return errorResponse("client_not_found", "The funding readiness client was not found.", 404);
      if (result.outcome === "disabled") return errorResponse("tracker_disabled", "Funding readiness tracking is disabled.", 503);
      const session = await getSession();
      if (!session) return errorResponse("session_required", "Sign in to update a funding readiness client.", 401);
      const client = await readTrackerClient(session, id);
      if (!client) return errorResponse("client_not_found", "The funding readiness client was not found.", 404);
      return Response.json({ outcome: result.outcome, client }, { status: 200, headers: privateHeaders });
    }

    if ("status" in parsed.value) {
      if (!featureFlag("FEATURE_CONSOLE_OPS")) {
        return errorResponse("console_ops_disabled", "Console operations are disabled.", 503);
      }
      const [{ requireOrgMember }, { assertTenantWriteAllowed }, { setTrackerClientStatus }] = await Promise.all([
        import("@/lib/auth/session"),
        import("@/lib/tenancy/wall"),
        import("@/lib/tracker/read.server"),
      ]);
      const session = await requireOrgMember();
      await assertTenantWriteAllowed(session);
      const client = await setTrackerClientStatus(session, id, parsed.value.status);
      if (!client) return errorResponse("client_not_found", "The funding readiness client was not found.", 404);
      return Response.json({ outcome: "updated", client }, { status: 200, headers: privateHeaders });
    }

    const [{ requireOrgMember }, { assertTenantWriteAllowed }, { updateTrackerClientMetadata }] = await Promise.all([
      import("@/lib/auth/session"),
      import("@/lib/tenancy/wall"),
      import("@/lib/tracker/read.server"),
    ]);
    const session = await requireOrgMember();
    await assertTenantWriteAllowed(session);
    const client = await updateTrackerClientMetadata(session, id, parsed.value);
    if (!client) return errorResponse("client_not_found", "The funding readiness client was not found.", 404);
    return Response.json({ outcome: "updated", client }, { status: 200, headers: privateHeaders });
  } catch (error) {
    const stageTransitionError = stageTransitionErrorResponse(error);
    if (stageTransitionError) return stageTransitionError;
    const status = accessStatus(error);
    if (status === 402) return errorResponse("ORG_DEACTIVATED", "This organization is deactivated.", 402);
    if (status) return errorResponse(status === 401 ? "session_required" : "role_forbidden", status === 401 ? "Sign in to update a funding readiness client." : "This account cannot update this funding readiness client.", status);
    if (typeof error === "object" && error !== null && "code" in error && error.code === "forbidden") {
      return errorResponse("role_forbidden", "This account cannot update this funding readiness client.", 403);
    }
    if (typeof error === "object" && error !== null && "code" in error && error.code === "invalid_assignee") {
      return errorResponse(
        "assignee_unavailable",
        "Choose an active team member from this workspace.",
        409,
      );
    }
    // R5B-04: the one arm that means the cause was not recognised, recorded and correlated.
    const correlationId = recordRouteFailure({
      cause: error,
      code: "tracker_unavailable",
      status: 500,
      surface: "api.clients.update",
    });
    return Response.json(
      withCorrelationId(
        {
          error: {
            code: "tracker_unavailable",
            message: "The funding readiness client could not be updated.",
          },
        },
        correlationId,
      ),
      { status: 500, headers: privateHeaders },
    );
  }
}
