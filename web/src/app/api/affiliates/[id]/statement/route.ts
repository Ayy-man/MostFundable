import { affiliateFailure, disabledResponse, privateJson } from "@/lib/affiliates/http";
import { featureFlag } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context): Promise<Response> {
  if (!featureFlag("FEATURE_AFFILIATES")) return disabledResponse();
  try {
    const [{ requireRole }, { assertTenantAccessAllowed }, affiliates] = await Promise.all([
      import("@/lib/auth/session"),
      import("@/lib/tenancy/wall"),
      import("@/lib/affiliates"),
    ]);
    const session = await requireRole("operator_member");
    await assertTenantAccessAllowed(session, "own-book-read");
    const { id } = await context.params;
    const affiliateId = affiliates.parseAffiliateId(id);
    return privateJson({ statement: await affiliates.getOperatorAffiliateStatement(affiliateId) });
  } catch (error) {
    return affiliateFailure(error);
  }
}
