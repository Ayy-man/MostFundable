import type { SessionProfile } from "@/lib/auth/session";
import type { createBrandService } from "@/lib/tenancy/brand";
import { tenancyFeatureEnabled } from "@/lib/tenancy/config";
import {
  noStore,
  tenantDisabledResponse,
  tenantRouteFailure,
  toInviteActor,
} from "@/lib/tenancy/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Service = ReturnType<typeof createBrandService>;
type Dependencies = {
  enabled(): boolean;
  requireOperator(): Promise<SessionProfile>;
  service(): Promise<Service>;
};

export async function handlePublishBrand(
  dependencies: Dependencies,
): Promise<Response> {
  if (!dependencies.enabled()) return tenantDisabledResponse();
  try {
    const session = await dependencies.requireOperator();
    const published = await (await dependencies.service()).publish(toInviteActor(session));
    return noStore(Response.json({ brand: published }));
  } catch (error) {
    return tenantRouteFailure(error);
  }
}

export async function POST(): Promise<Response> {
  return handlePublishBrand({
    enabled: tenancyFeatureEnabled,
    async requireOperator() {
      const { requireRole } = await import("@/lib/auth/session");
      return requireRole("operator_member");
    },
    async service() {
      const { productionBrandService } = await import("@/lib/tenancy/brand");
      return productionBrandService();
    },
  });
}
