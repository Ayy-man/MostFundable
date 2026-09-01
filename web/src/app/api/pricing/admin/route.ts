import { notFound } from "next/navigation";

import { featureFlag } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  if (!featureFlag("FEATURE_PAID_REFRESH")) notFound();
  const [{ requireRole }, pricing] = await Promise.all([
    import("@/lib/auth/session"),
    import("@/lib/pricing/http"),
  ]);
  return pricing.handlePricingCatalog("platform_admin", {
    requireRole,
    resolveCatalog: async () => {
      const { resolveGovernedForcePullPrice } = await import("@/lib/admin/settings");
      return pricing.resolveAdminPricingCatalog(await resolveGovernedForcePullPrice());
    },
  });
}
