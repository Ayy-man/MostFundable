import { recordRouteFailure, withCorrelationId } from "@/lib/diagnostics/route-failure";
import { featureFlag } from "@/lib/env";
import {
  isTrackerClientStatus,
  isTrackerStage,
  isTrackerUuid,
  validateTrackerCreateInput,
  type TrackerReadFilters,
} from "@/lib/tracker/types";
import { orderTrackerClientsByHealth } from "@/lib/tracker/health";
import type { SessionProfile } from "@/lib/auth/session";
import type { TrackerClientCreateInput, TrackerCreateResult } from "@/lib/tracker/types";

const privateHeaders = { "Cache-Control": "private, no-store" };

function errorResponse(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status, headers: privateHeaders });
}

/**
 * The tracker's "we do not know why" answer. R5B-04: the caller keeps the same redacted sentence and
 * gains the correlation id that ties it to the one recorded line naming the throw's class and code.
 */
function trackerUnavailable(error: unknown, message: string, surface: string): Response {
  const correlationId = recordRouteFailure({
    cause: error,
    code: "tracker_unavailable",
    status: 500,
    surface,
  });
  return Response.json(
    withCorrelationId({ error: { code: "tracker_unavailable", message } }, correlationId),
    { status: 500, headers: privateHeaders },
  );
}

function accessStatus(error: unknown): 401 | 402 | 403 | null {
  if (typeof error !== "object" || error === null || !("status" in error)) return null;
  return error.status === 401 || error.status === 402 || error.status === 403 ? error.status : null;
}

type OrgSession = SessionProfile & { orgId: string };
type ClientCapModule = {
  assertClientCap(orgId: string): Promise<unknown>;
  isClientCapError(error: unknown): boolean;
};
type ClientPostDependencies = {
  billingOpsEnabled(): boolean;
  createTrackerClient(session: OrgSession, input: TrackerClientCreateInput): Promise<TrackerCreateResult>;
  isTrackerDataError(error: unknown): boolean;
  loadClientCap(): Promise<ClientCapModule>;
  requireOrgMember(): Promise<OrgSession>;
  assertTenantWriteAllowed(session: SessionProfile): Promise<void>;
  trackerEnabled(): boolean;
};

function clientCapResponse() {
  return errorResponse(
    "CLIENT_CAP_REACHED",
    "This organization has reached its active client cap.",
    409,
  );
}

export async function GET(request: Request) {
  if (!featureFlag("FEATURE_TRACKER")) {
    return Response.json({ enabled: false, clients: [] }, { status: 200, headers: privateHeaders });
  }

  try {
    const [{ getSession }, { listTrackerAssignableMembers, listTrackerClients }] = await Promise.all([
      import("@/lib/auth/session"),
      import("@/lib/tracker/read.server"),
    ]);
    const session = await getSession();
    if (!session) return errorResponse("session_required", "Sign in to view funding readiness clients.", 401);
    if (session.role !== "operator_member" && session.role !== "consumer") {
      return errorResponse("role_forbidden", "This account cannot view funding readiness clients.", 403);
    }

    let filters: TrackerReadFilters = { scope: "all" };
    if (session.role === "operator_member") {
      const params = new URL(request.url).searchParams;
      const allowed = new Set(["scope", "stage", "member", "affiliate", "status"]);
      if ([...params.keys()].some((key) => !allowed.has(key))) {
        return errorResponse("invalid_request", "The client filter is not supported.", 400);
      }
      const scope = params.get("scope") ?? "all";
      const stage = params.get("stage");
      const member = params.get("member");
      const affiliate = params.get("affiliate");
      const status = params.get("status");
      if (scope !== "mine" && scope !== "all") return errorResponse("invalid_request", "scope must be mine or all.", 400);
      if (stage !== null && !isTrackerStage(stage)) return errorResponse("invalid_request", "stage is not a tracker stage.", 400);
      if (member !== null && !isTrackerUuid(member)) return errorResponse("invalid_request", "member must be a UUID.", 400);
      if (affiliate !== null && affiliate !== "none" && !isTrackerUuid(affiliate)) return errorResponse("invalid_request", "affiliate must be a UUID or none.", 400);
      if (status !== null && status !== "all" && !isTrackerClientStatus(status)) return errorResponse("invalid_request", "status must be active, archived, or all.", 400);
      filters = {
        scope,
        ...(stage ? { stage } : {}),
        ...(member ? { member } : {}),
        ...(affiliate ? { affiliate } : {}),
        ...(status ? { status } : {}),
      };
    }

    const consoleOpsEnabled = featureFlag("FEATURE_CONSOLE_OPS");
    const [clients, assignableMembers] = await Promise.all([
      listTrackerClients(session, filters),
      listTrackerAssignableMembers(session),
    ]);
    const ordered = consoleOpsEnabled ? orderTrackerClientsByHealth(clients) : clients;
    return Response.json({
      enabled: true,
      assignableMembers,
      consoleOpsEnabled,
      currentProfileId: session.id,
      clients: ordered,
    }, { status: 200, headers: privateHeaders });
  } catch (error) {
    const status = accessStatus(error);
    if (status) return errorResponse(status === 401 ? "session_required" : "role_forbidden", status === 401 ? "Sign in to view funding readiness clients." : "This account cannot view funding readiness clients.", status);
    return trackerUnavailable(error, "Funding readiness clients are temporarily unavailable.", "api.clients.list");
  }
}

export async function handlePostClient(
  request: Request,
  dependencies: ClientPostDependencies,
) {
  if (!dependencies.trackerEnabled()) {
    return errorResponse("tracker_disabled", "Funding readiness tracking is disabled.", 503);
  }

  try {
    const session = await dependencies.requireOrgMember();
    await dependencies.assertTenantWriteAllowed(session);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse("invalid_request", "The request body must be valid JSON.", 400);
    }
    const parsed = validateTrackerCreateInput(body);
    if (!parsed.ok) return errorResponse(parsed.code, parsed.message, 400);
    const cap = dependencies.billingOpsEnabled()
      ? await dependencies.loadClientCap()
      : null;
    if (cap) {
      try {
        await cap.assertClientCap(session.orgId);
      } catch (error) {
        if (cap.isClientCapError(error)) return clientCapResponse();
        throw error;
      }
    }

    let result: TrackerCreateResult;
    try {
      result = await dependencies.createTrackerClient(session, parsed.value);
    } catch (error) {
      if (cap && dependencies.isTrackerDataError(error)) {
        try {
          await cap.assertClientCap(session.orgId);
        } catch (capError) {
          if (cap.isClientCapError(capError)) return clientCapResponse();
          throw capError;
        }
      }
      throw error;
    }
    if (result.outcome === "invalid_profile") return errorResponse("invalid_consumer_profile", "The consumer profile cannot be used for this client.", 409);
    if (result.outcome === "conflict") return errorResponse("client_conflict", "The client could not be created because a conflicting record exists.", 409);
    return Response.json(result, {
      status: result.outcome === "created" ? 201 : 200,
      headers: privateHeaders,
    });
  } catch (error) {
    const status = accessStatus(error);
    if (status === 402) return errorResponse("ORG_DEACTIVATED", "This organization is deactivated.", 402);
    if (status) return errorResponse(status === 401 ? "session_required" : "role_forbidden", status === 401 ? "Sign in to create a funding readiness client." : "This account cannot create funding readiness clients.", status);
    return trackerUnavailable(error, "The funding readiness client could not be created.", "api.clients.create");
  }
}

export async function POST(request: Request) {
  if (!featureFlag("FEATURE_TRACKER")) {
    return errorResponse("tracker_disabled", "Funding readiness tracking is disabled.", 503);
  }
  const [{ requireOrgMember }, tracker, { assertTenantWriteAllowed }] = await Promise.all([
    import("@/lib/auth/session"),
    import("@/lib/tracker/read.server"),
    import("@/lib/tenancy/wall"),
  ]);
  return handlePostClient(request, {
    billingOpsEnabled: () => featureFlag("FEATURE_BILLING_OPS"),
    createTrackerClient: tracker.createTrackerClient,
    isTrackerDataError: (error) => error instanceof tracker.TrackerDataError,
    async loadClientCap() {
      const billing = await import("@/lib/billing/client-cap");
      return {
        assertClientCap: billing.assertClientCap,
        isClientCapError: (error) => error instanceof billing.ClientCapError,
      };
    },
    requireOrgMember,
    assertTenantWriteAllowed,
    trackerEnabled: () => true,
  });
}
