import type { createInviteService } from "@/lib/tenancy/invites";
import { recordRouteFailure } from "@/lib/diagnostics/route-failure";
import { tenancyFeatureEnabled } from "@/lib/tenancy/config";
import { TenantError } from "@/lib/tenancy/errors";
import { tenantDisabledResponse, tenantRouteFailure } from "@/lib/tenancy/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Service = ReturnType<typeof createInviteService>;
type Dependencies = {
  enabled(): boolean;
  service(): Promise<Service>;
};

function redirect(request: Request, path: string): Response {
  return Response.redirect(new URL(path, request.url), 303);
}

export async function handleAcceptInvite(
  request: Request,
  dependencies: Dependencies,
): Promise<Response> {
  if (!dependencies.enabled()) return tenantDisabledResponse();
  const url = new URL(request.url);
  const failure = "/sign-in?error=link_invalid";
  if (url.searchParams.get("type") !== "invite") return redirect(request, failure);
  try {
    const accepted = await (await dependencies.service()).accept({
      tokenHash: url.searchParams.get("token_hash") ?? "",
      tokenId: url.searchParams.get("invite_id") ?? "",
    });
    const destination = accepted.kind === "team"
      ? "/operator"
      : accepted.kind === "affiliate"
        ? "/affiliate"
        : "/consumer";
    return redirect(request, destination);
  } catch (error) {
    if (error instanceof TenantError && error.code === "TENANT_SEAT_SYNC_FAILED") {
      return tenantRouteFailure(error);
    }
    // R5B-04. A `TenantError` naming a bad or spent link is a real answer and keeps the
    // `link_invalid` redirect. Anything else — a session store outage, a database refusal, a driver
    // throw — used to take the same redirect, so an operator whose invite worked fine was told the
    // link was bad and nothing was written down. The unknown cause is recorded, and it lands on its
    // own opaque marker so the two are distinguishable in a support report. Neither value is read by
    // any surface: `/sign-in` never looks at the `error` parameter, so no client-facing copy moves.
    if (error instanceof TenantError) return redirect(request, failure);
    recordRouteFailure({
      cause: error,
      code: "invite_accept_unavailable",
      status: 303,
      surface: "api.invites.accept",
    });
    return redirect(request, "/sign-in?error=link_unavailable");
  }
}

export async function GET(request: Request): Promise<Response> {
  return handleAcceptInvite(request, {
    enabled: tenancyFeatureEnabled,
    async service() {
      const { productionInviteService } = await import("@/lib/tenancy/invites");
      return productionInviteService();
    },
  });
}
