// /api/billing/seats/sync — reconcile the caller's own seat count with the provider.
//
// 10-CONTEXT.md D-01: no route may write `orgs.membership`. This one writes no
// organization column at all — it drains the pending outbox row through the
// service, which asks the provider first and records the quantity only after
// the provider accepted it.
//
// There is no organization parameter on this handler, by design (T-10-22). The
// org comes from the session, so there is nothing for a caller to point at
// somebody else's tenant.
//
// D-12: the flag check precedes every dynamic import, so a flag-off request
// loads neither the admin client nor a driver.

import { billingErrorFor, billingError, billingOk, disabledWrite } from "@/lib/billing/http";
import { featureFlag } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  if (!featureFlag("FEATURE_BILLING")) return disabledWrite();

  try {
    const [{ requireOrgMember }, { assertTenantWriteAllowed }, service] = await Promise.all([
      import("@/lib/auth/session"),
      import("@/lib/tenancy/wall"),
      import("@/lib/billing/service-operator"),
    ]);

    const session = await requireOrgMember();
    await assertTenantWriteAllowed(session);
    if (session.orgRole !== "owner" && session.orgRole !== "admin") {
      return billingError("role_forbidden");
    }

    // A seat count increase and a seat count decrease take the same path: the
    // outbox holds one row per organization carrying the current desired
    // number, so whichever direction it moved, one drain settles it.
    const seats = await service.syncOperatorSeats(session.orgId);
    return billingOk({ seats });
  } catch (error) {
    return billingErrorFor(error);
  }
}
