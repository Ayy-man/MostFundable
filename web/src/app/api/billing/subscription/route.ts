// /api/billing/subscription — read an organization's billing state, or start it.
//
// 10-CONTEXT.md D-01: no route may write `orgs.membership`. The rung is derived
// from provider webhooks and written by exactly one security-definer function
// (`operator_billing_apply_event`, migration 071). Nothing reachable from this
// file can move it, and `POST` accepts no price, plan, quantity or membership
// field — every billable value is derived server-side from the session's own
// organization.
//
// D-12: the flag check is the first statement in both handlers and returns
// before any dynamic import, so with `FEATURE_BILLING` absent this route loads
// neither a session helper, nor a Supabase client, nor a billing driver. That
// is what keeps the no-environment build honest rather than accidental.

import {
  billingErrorFor,
  billingError,
  billingOk,
  disabledRead,
  disabledWrite,
  isUuid,
  validateStartSubscription,
} from "@/lib/billing/http";
import { featureFlag } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Owner and admin only, matching migration 070's scoped select policies exactly.
 * The route gate and the policy are deliberately the same rule in two places:
 * the policy is what actually holds, and the gate is what turns a silent empty
 * read into a 403 a caller can act on.
 */
function isBillingReader(role: string, orgRole: string | null): boolean {
  return role === "operator_member" && (orgRole === "owner" || orgRole === "admin");
}

export async function validateStartSubscriptionRequest(
  request: Request,
): Promise<ReturnType<typeof validateStartSubscription>> {
  try {
    return validateStartSubscription(await request.json());
  } catch {
    return { code: "invalid_request", ok: false };
  }
}

export async function GET(request: Request) {
  if (!featureFlag("FEATURE_BILLING")) return disabledRead();

  const params = new URL(request.url).searchParams;
  for (const key of params.keys()) {
    if (key !== "orgId") return billingError("invalid_request");
  }
  const requestedOrgId = params.get("orgId");

  try {
    const [{ getSession }, service] = await Promise.all([
      import("@/lib/auth/session"),
      import("@/lib/billing/service-operator"),
    ]);

    const session = await getSession();
    if (!session) return billingError("session_required");

    let orgId: string;
    if (requestedOrgId !== null) {
      // Only a platform admin may name an organization. Everyone else gets the
      // same 403 whether or not the id exists, so the parameter cannot be used
      // to enumerate tenants (T-10-21).
      if (session.role !== "platform_admin") return billingError("org_required");
      if (!isUuid(requestedOrgId)) return billingError("invalid_request");
      orgId = requestedOrgId;
    } else {
      // A platform admin has no organization of its own to fall back to, so it
      // must say which one it means rather than being handed an arbitrary row.
      if (session.role === "platform_admin") return billingError("invalid_request");
      if (!isBillingReader(session.role, session.orgRole) || !session.orgId) {
        return billingError("role_forbidden");
      }
      orgId = session.orgId;
    }

    // Read through the caller's session-scoped client, so migration 070's
    // policies decide the answer and an organization outside the caller's reach
    // comes back as nothing rather than as somebody else's billing state.
    const billing = await service.readOperatorBillingState(orgId);
    return billingOk({ billing });
  } catch (error) {
    return billingErrorFor(error);
  }
}

export async function POST(request: Request) {
  if (!featureFlag("FEATURE_BILLING")) return disabledWrite();

  try {
    const [{ requireOrgMember }, { assertTenantWriteAllowed }, service] = await Promise.all([
      import("@/lib/auth/session"),
      import("@/lib/tenancy/wall"),
      import("@/lib/billing/service-operator"),
    ]);

    const session = await requireOrgMember();
    await assertTenantWriteAllowed(session);
    if (!isBillingReader(session.role, session.orgRole)) {
      return billingError("role_forbidden");
    }

    const parsed = await validateStartSubscriptionRequest(request);
    if (!parsed.ok) return billingError(parsed.code);

    // The organization comes from the session and nowhere else. There is no
    // org parameter on this handler at all, so a caller cannot start a
    // subscription against a tenant it does not belong to.
    const outcome = await service.startOperatorSubscriptionForOrg(session.orgId);

    // Idempotent on the organization: a second call re-attaches the existing
    // subscription and answers 200, so a double submit does not open a second
    // subscription against the same tenant.
    return billingOk(
      {
        subscription: {
          seatQuantity: outcome.seatQuantity,
          status: outcome.status,
          subscriptionRef: outcome.subscriptionRef,
        },
      },
      outcome.created ? 201 : 200,
    );
  } catch (error) {
    return billingErrorFor(error);
  }
}
