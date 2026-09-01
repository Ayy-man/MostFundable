import { affiliateFailure, disabledResponse, privateJson } from "@/lib/affiliates/http";
import { getAffiliatePortal } from "@/lib/affiliates/service";
import type { AffiliatePortal } from "@/lib/affiliates/types";
import type { OperatorMembership } from "@/lib/billing/types";
import { requireRole } from "@/lib/auth/session";
import { featureFlag } from "@/lib/env";
import { TenantBillingWallError } from "@/lib/tenancy/errors";
import { assertTenantWriteAllowed } from "@/lib/tenancy/wall";

export const runtime = "nodejs";

type AffiliateSession = {
  id: string;
  orgMembership: OperatorMembership | null;
  role: "affiliate";
};

export type AffiliatePortalDependencies = {
  now(): Date;
  read(now: Date): Promise<AffiliatePortal>;
  requireAffiliate(): Promise<AffiliateSession>;
  wall(session: AffiliateSession): Promise<void>;
};

export async function runAffiliatePortal(
  dependencies: AffiliatePortalDependencies,
): Promise<Response> {
  try {
    const session = await dependencies.requireAffiliate();
    await dependencies.wall(session);
    return privateJson(await dependencies.read(dependencies.now()));
  } catch (error) {
    if (error instanceof TenantBillingWallError) {
      return privateJson({ error: error.code }, error.status);
    }
    return affiliateFailure(error);
  }
}

export async function GET(): Promise<Response> {
  if (!featureFlag("FEATURE_AFFILIATES")) return disabledResponse();

  return runAffiliatePortal({
    now: () => new Date(),
    read: (now) => getAffiliatePortal(now),
    async requireAffiliate() {
      const session = await requireRole("affiliate");
      return { id: session.id, orgMembership: session.orgMembership, role: "affiliate" };
    },
    wall: (session) => assertTenantWriteAllowed(session),
  });
}
