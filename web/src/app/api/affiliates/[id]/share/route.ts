import { affiliateFailure, disabledResponse, privateJson } from "@/lib/affiliates/http";
import { featureFlag } from "@/lib/env";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  if (!featureFlag("FEATURE_AFFILIATES")) return disabledResponse();

  try {
    const [{ requireRole }, { assertTenantWriteAllowed }, affiliates] = await Promise.all([
      import("@/lib/auth/session"),
      import("@/lib/tenancy/wall"),
      import("@/lib/affiliates"),
    ]);
    const session = await requireRole("operator_member");
    await assertTenantWriteAllowed(session);
    const { id } = await context.params;
    const affiliateId = affiliates.parseAffiliateId(id);
    const { clientId } = affiliates.parseShareClientBody(await readBody(request));
    const result = await affiliates.shareClient(affiliateId, clientId);
    return privateJson(result, result.inserted ? 201 : 200);
  } catch (error) {
    return affiliateFailure(error);
  }
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  if (!featureFlag("FEATURE_AFFILIATES")) return disabledResponse();

  try {
    const [{ requireRole }, { assertTenantWriteAllowed }, affiliates] = await Promise.all([
      import("@/lib/auth/session"),
      import("@/lib/tenancy/wall"),
      import("@/lib/affiliates"),
    ]);
    const session = await requireRole("operator_member");
    await assertTenantWriteAllowed(session);
    const { id } = await context.params;
    const affiliateId = affiliates.parseAffiliateId(id);
    const { clientId } = affiliates.parseShareClientBody(await readBody(request));
    await affiliates.unshareClient(affiliateId, clientId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return affiliateFailure(error);
  }
}

async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    const { AffiliateError } = await import("@/lib/affiliates");
    throw new AffiliateError("invalid_payload", "The request payload is invalid.");
  }
}
