import type { SessionProfile } from "@/lib/auth/session";
import type { createInviteService } from "@/lib/tenancy/invites";
import { tenancyFeatureEnabled } from "@/lib/tenancy/config";
import {
  noStore,
  tenantDisabledResponse,
  tenantRouteFailure,
  toInviteActor,
} from "@/lib/tenancy/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };
type Service = ReturnType<typeof createInviteService>;
type Dependencies = {
  enabled(): boolean;
  requireOperator(): Promise<SessionProfile>;
  service(): Promise<Service>;
};

export async function handleDeactivateMember(
  context: Context,
  dependencies: Dependencies,
): Promise<Response> {
  if (!dependencies.enabled()) return tenantDisabledResponse();
  try {
    const session = await dependencies.requireOperator();
    const { id } = await context.params;
    const result = await (await dependencies.service()).deactivate({
      actor: toInviteActor(session),
      targetId: id,
    });
    return noStore(Response.json({ member: result }));
  } catch (error) {
    return tenantRouteFailure(error);
  }
}

export async function POST(_request: Request, context: Context): Promise<Response> {
  return handleDeactivateMember(context, {
    enabled: tenancyFeatureEnabled,
    async requireOperator() {
      const { requireRole } = await import("@/lib/auth/session");
      return requireRole("operator_member");
    },
    async service() {
      const { productionInviteService } = await import("@/lib/tenancy/invites");
      return productionInviteService();
    },
  });
}
