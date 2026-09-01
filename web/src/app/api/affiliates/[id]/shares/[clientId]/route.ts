import { affiliateFailure, disabledResponse, privateJson } from "@/lib/affiliates/http";
import { featureFlag } from "@/lib/env";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string; clientId: string }> };

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
    const { id, clientId } = await context.params;
    const affiliateId = affiliates.parseAffiliateId(id);
    const parsedClientId = affiliates.parseAffiliateId(clientId);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new affiliates.AffiliateError("invalid_payload", "The request payload is invalid.");
    }
    const patch = affiliates.parseUpdateShareBody(body);
    return privateJson(await affiliates.updateShare(affiliateId, parsedClientId, patch));
  } catch (error) {
    return affiliateFailure(error);
  }
}
