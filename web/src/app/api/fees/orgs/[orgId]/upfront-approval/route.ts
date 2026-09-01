import { patchUpfrontApproval } from "@/lib/fees/handlers";
import { featureFlag } from "@/lib/env";

export const runtime = "nodejs";

type RouteContext<Path extends "/api/fees/orgs/[orgId]/upfront-approval"> = Path extends string
  ? { params: Promise<{ orgId: string }> }
  : never;

/**
 * PATCH /api/fees/orgs/[orgId]/upfront-approval — the only way the legal gate
 * opens, and the other half of ROADMAP criterion 2.
 *
 * Guarded by `requireRole("platform_admin")` at the route layer and by
 * `org_flags_platform_write` underneath it, because the party with the
 * commercial motive to approve their own organization is an authenticated
 * caller. A non-admin gets 403 rather than 404: the route's existence is not
 * the secret, the authority to use it is.
 *
 * The body carries `{ approved, signoffRef }` and no approver id. The RPC takes
 * `approved_by` from the session, which is what makes the attribution
 * unforgeable — a field for it here would let one platform admin file another's
 * sign-off.
 *
 * ask-12-2: this handler sits under `/api/fees/*` because INTERFACES §5 grants
 * that whole prefix to Phase 12. If integration would rather it lived under an
 * admin prefix, the handler moves and the RPC stays exactly as it is.
 */
export async function PATCH(
  request: Request,
  context: RouteContext<"/api/fees/orgs/[orgId]/upfront-approval">,
): Promise<Response> {
  if (!featureFlag("FEATURE_FEES")) {
    return new Response(null, { status: 404 });
  }
  const { orgId } = await context.params;
  return patchUpfrontApproval(request, orgId);
}
