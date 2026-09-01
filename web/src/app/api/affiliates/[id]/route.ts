import { affiliateFailure, disabledResponse, privateJson } from "@/lib/affiliates/http";
import { featureFlag } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context): Promise<Response> {
  if (!featureFlag("FEATURE_AFFILIATES")) return disabledResponse();
  try {
    const [{ requireRole }, { assertTenantWriteAllowed }, affiliates] = await Promise.all([
      import("@/lib/auth/session"),
      import("@/lib/tenancy/wall"),
      import("@/lib/affiliates"),
    ]);
    const session = await requireRole("operator_member");
    await assertTenantWriteAllowed(session);
    if (session.orgRole !== "owner" && session.orgRole !== "admin") {
      throw new affiliates.AffiliateError("forbidden", "Only workspace owners and admins can change affiliate settings.");
    }
    const { id } = await context.params;
    const affiliateId = affiliates.parseAffiliateId(id);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new affiliates.AffiliateError("invalid_payload", "The request payload is invalid.");
    }
    const patch = affiliates.parseAffiliateLifecyclePatch(body);
    return privateJson({ affiliate: await affiliates.updateOperatorAffiliate(affiliateId, patch) });
  } catch (error) {
    return affiliateFailure(error);
  }
}
