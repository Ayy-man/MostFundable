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

type Service = ReturnType<typeof createInviteService>;
type Dependencies = {
  enabled(): boolean;
  requireOperator(): Promise<SessionProfile>;
  service(): Promise<Service>;
};

export async function handleCreateInvite(
  request: Request,
  dependencies: Dependencies,
): Promise<Response> {
  if (!dependencies.enabled()) return tenantDisabledResponse();
  try {
    const session = await dependencies.requireOperator();
    let body: unknown;
    try { body = await request.json(); } catch { body = null; }
    const result = await (await dependencies.service()).create({
      actor: toInviteActor(session),
      body,
      idempotencyKey: request.headers.get("Idempotency-Key")?.trim() ?? "",
    });
    return noStore(Response.json({
      invite: { inviteId: result.inviteId, orgId: result.orgId },
    }, { status: 201 }));
  } catch (error) {
    return tenantRouteFailure(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  return handleCreateInvite(request, {
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
