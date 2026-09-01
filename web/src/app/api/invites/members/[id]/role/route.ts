import type { SessionProfile } from "@/lib/auth/session";
import { tenancyFeatureEnabled } from "@/lib/tenancy/config";
import type { createMemberRoleService } from "@/lib/tenancy/member-role";
import {
  noStore,
  tenantDisabledResponse,
  tenantRouteFailure,
} from "@/lib/tenancy/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };
type Service = ReturnType<typeof createMemberRoleService>;
type Dependencies = {
  enabled(): boolean;
  requireOperator(): Promise<SessionProfile>;
  service(): Promise<Service>;
  wall(session: SessionProfile): Promise<void>;
};

export async function handleMemberRoleUpdate(
  request: Request,
  context: Context,
  dependencies: Dependencies,
): Promise<Response> {
  if (!dependencies.enabled()) return tenantDisabledResponse();
  try {
    const session = await dependencies.requireOperator();
    await dependencies.wall(session);
    const { id } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const member = await (await dependencies.service()).update({ actor: session, body, targetId: id });
    return noStore(Response.json({ member }));
  } catch (error) {
    return tenantRouteFailure(error);
  }
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  return handleMemberRoleUpdate(request, context, {
    enabled: tenancyFeatureEnabled,
    async requireOperator() {
      const { requireRole } = await import("@/lib/auth/session");
      return requireRole("operator_member");
    },
    async service() {
      const { productionMemberRoleService } = await import("@/lib/tenancy/member-role");
      return productionMemberRoleService();
    },
    async wall(session) {
      const { assertTenantWriteAllowed } = await import("@/lib/tenancy/wall");
      await assertTenantWriteAllowed(session);
    },
  });
}
