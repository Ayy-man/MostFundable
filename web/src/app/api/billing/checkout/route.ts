import { recordRouteFailure, withCorrelationId } from "@/lib/diagnostics/route-failure";
import { featureFlag } from "@/lib/env";
import type { OperatorMembership } from "@/lib/billing/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type OrgActor = { id: string; orgId: string; orgMembership: OperatorMembership | null; orgRole: string | null; role: "affiliate" | "consumer" | "operator_member" | "platform_admin" };
type Dependencies = {
  assertTenantWriteAllowed(actor: OrgActor): Promise<void>;
  createCheckout(orgId: string, requestUrl: string): Promise<{ url: string }>;
  requireOrgMember(): Promise<OrgActor>;
};
const privateHeaders = { "Cache-Control": "private, no-store" };

function json(body: unknown, status = 200) {
  return Response.json(body, { headers: privateHeaders, status });
}

async function emptyRequest(request: Request): Promise<boolean> {
  if ([...new URL(request.url).searchParams.keys()].length > 0) return false;
  const text = await request.text();
  if (!text.trim()) return true;
  try {
    const body = JSON.parse(text) as unknown;
    return !!body && typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 0;
  } catch {
    return false;
  }
}

function failure(error: unknown): Response {
  if (error && typeof error === "object") {
    const value = error as { code?: unknown; name?: unknown; status?: unknown };
    if (value.name === "MisconfiguredDriverError") return json({ error: { code: "billing_unconfigured" } }, 503);
    if (value.name === "AuthError") return json({ error: { code: value.status === 401 ? "unauthenticated" : "forbidden" } }, value.status === 401 ? 401 : 403);
    if (value.code === "ORG_DEACTIVATED") return json({ error: { code: "ORG_DEACTIVATED" } }, 402);
    if (value.code === "BILLING_CUSTOMER_REQUIRED" && value.status === 409) return json({ error: { code: value.code } }, 409);
    if (value.code === "BILLING_SUBSCRIPTION_INTENT_CONFLICT" && value.status === 409) return json({ error: { code: value.code } }, 409);
    if (value.code === "BILLING_PROVIDER_UNAVAILABLE" && value.status === 502) return json({ error: { code: value.code } }, 502);
    if (value.code === "BILLING_OPERATION_INVALID" && value.status === 400) return json({ error: { code: value.code } }, 400);
  }
  // R5B-03. Every named provider and authority outcome above is an answer; this is the one that is
  // not, and it now carries a correlation id to the caller and a classification to the log stream.
  const correlationId = recordRouteFailure({
    cause: error,
    code: "billing_unavailable",
    status: 500,
    surface: "api.billing.checkout",
  });
  return json(withCorrelationId({ error: { code: "billing_unavailable" } }, correlationId), 500);
}

export async function handleCheckout(request: Request, dependencies: Dependencies): Promise<Response> {
  if (!await emptyRequest(request)) return json({ error: { code: "invalid_request" } }, 400);
  try {
    const actor = await dependencies.requireOrgMember();
    if (actor.orgRole !== "owner" && actor.orgRole !== "admin") return json({ error: { code: "forbidden" } }, 403);
    await dependencies.assertTenantWriteAllowed(actor);
    return json(await dependencies.createCheckout(actor.orgId, request.url));
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!featureFlag("FEATURE_BILLING_OPS")) return new Response(null, { status: 404 });
  const [{ requireOrgMember }, { assertTenantWriteAllowed }, { createHostedCheckout }] = await Promise.all([
    import("@/lib/auth/session"),
    import("@/lib/tenancy/wall"),
    import("@/lib/billing/service-operations"),
  ]);
  return handleCheckout(request, { assertTenantWriteAllowed, createCheckout: createHostedCheckout, requireOrgMember });
}
