import { tenancyFeatureEnabled } from "@/lib/tenancy/config";
import { tenantErrorResponse } from "@/lib/tenancy/errors";
import type { SessionProfile } from "@/lib/auth/session";
import type { createTenantAdminService } from "@/lib/tenancy/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };
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

export async function handlePatchTenant(
  request: Request,
  context: Context,
  dependencies: Dependencies,
): Promise<Response> {
  if (!dependencies.enabled()) return disabled();
  try {
    const actor = await dependencies.requirePlatformAdmin();
    const { id } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const result = await (await dependencies.service()).act({ actor, body, orgId: id });
    return noStore(Response.json({ tenant: result }));
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  return handlePatchTenant(request, context, {
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
