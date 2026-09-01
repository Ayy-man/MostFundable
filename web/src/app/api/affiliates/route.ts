import { affiliateFailure, disabledResponse, privateJson } from "@/lib/affiliates/http";
import { featureFlag } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  if (!featureFlag("FEATURE_AFFILIATES")) return disabledResponse();
  try {
    const [{ requireRole }, { assertTenantAccessAllowed }, { getOperatorAffiliateRoster }] = await Promise.all([
      import("@/lib/auth/session"),
      import("@/lib/tenancy/wall"),
      import("@/lib/affiliates"),
    ]);
    const session = await requireRole("operator_member");
    await assertTenantAccessAllowed(session, "own-book-read");
    return privateJson({ affiliates: await getOperatorAffiliateRoster() });
  } catch (error) {
    return affiliateFailure(error);
  }
}
