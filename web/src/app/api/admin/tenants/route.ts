import { tenancyFeatureEnabled } from "@/lib/tenancy/config";
import { tenantErrorResponse } from "@/lib/tenancy/errors";
import type { SessionProfile } from "@/lib/auth/session";
import type { createTenantAdminService } from "@/lib/tenancy/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AdminService = ReturnType<typeof createTenantAdminService>;
type Dependencies = {
  enabled(): boolean;
  requirePlatformAdmin(): Promise<SessionProfile>;
  service(): Promise<AdminService>;
};

function noStore(response: Response): Response {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function disabled(): Response {
  return noStore(Response.json(
    { error: { code: "FEATURE_DISABLED", message: "The route is not available." } },
    { status: 404 },
  ));
}

function failure(error: unknown): Response {
  if (
    error instanceof Error &&
    error.name === "AuthError" &&
    "status" in error &&
    (error.status === 401 || error.status === 403)
  ) {
    return noStore(Response.json(
      {
        error: {
          code: error.status === 401 ? "unauthenticated" : "forbidden",
          message: error.status === 401 ? "Authentication is required." : "Access is denied.",
        },
      },
      { status: error.status },
    ));
  }
  return noStore(tenantErrorResponse(error));
}

export async function handlePostTenant(
  request: Request,
  dependencies: Dependencies,
): Promise<Response> {
  if (!dependencies.enabled()) return disabled();
  try {
    const actor = await dependencies.requirePlatformAdmin();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const result = await (await dependencies.service()).provision({
      actor,
      body,
      idempotencyKey: request.headers.get("Idempotency-Key")?.trim() ?? "",
    });
    return noStore(Response.json({
      tenant: {
        inviteId: result.inviteId,
        orgId: result.orgId,
        replayed: result.replayed,
      },
    }, { status: 201 }));
  } catch (error) {
    return failure(error);
  }
}

/**
 * The roster read, gated by `FEATURE_ADMIN` rather than by `FEATURE_TENANCY`.
 *
 * The two halves of this file answer to different flags on purpose: POST
 * provisions a workspace, which is the tenancy surface, while GET is an admin
 * analytics read like every other `/api/admin/*` route and must be readable
 * whenever the admin surface itself is. The listing carries no invite, no
 * credential and no consumer record — org name, plan, membership, client count
 * and recorded funded totals only.
 */
export async function GET(): Promise<Response> {
  const { featureFlag } = await import("@/lib/env");
  if (!featureFlag("FEATURE_ADMIN")) return new Response(null, { status: 404 });
  const { handleTenants } = await import("@/lib/admin/handlers");
  return handleTenants({ applications: featureFlag("FEATURE_APPLICATIONS") });
}

export async function POST(request: Request): Promise<Response> {
  return handlePostTenant(request, {
    enabled: tenancyFeatureEnabled,
    async requirePlatformAdmin() {
      const { requireRole } = await import("@/lib/auth/session");
      return requireRole("platform_admin");
    },
    async service() {
      const { productionTenantAdminService } = await import("@/lib/tenancy/admin");
      return productionTenantAdminService();
    },
  });
}
