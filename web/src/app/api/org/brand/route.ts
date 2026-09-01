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

export async function handlePatchBrand(
  request: Request,
  dependencies: Dependencies,
): Promise<Response> {
  if (!dependencies.enabled()) return tenantDisabledResponse();
  try {
    const session = await dependencies.requireOperator();
    const service = await dependencies.service();
    let brand;
    if (request.headers.get("content-type")?.startsWith("multipart/form-data")) {
      const form = await request.formData();
      if ([...form.keys()].some((key) => key !== "logo")) throw new Error("TENANT_BRAND_FORM_INVALID");
      const logo = form.get("logo");
      if (!(logo instanceof File)) throw new Error("TENANT_BRAND_FORM_INVALID");
      brand = await service.uploadLogo(toInviteActor(session), {
        bytes: new Uint8Array(await logo.arrayBuffer()),
        mimeType: logo.type,
      });
    } else {
      let body: unknown;
      try { body = await request.json(); } catch { body = null; }
      brand = await service.update(toInviteActor(session), body);
    }
    return noStore(Response.json({ brand }));
  } catch (error) {
    return tenantRouteFailure(error);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  return handlePatchBrand(request, {
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

