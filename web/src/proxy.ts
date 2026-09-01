import { NextRequest, NextResponse } from "next/server";

import { updateSession } from "@/lib/auth/proxy-client";
import { guardDecision } from "@/lib/auth/route-guard";
import { featureFlag } from "@/lib/env";
import { sameOrigin } from "@/lib/pricing/http";
import type { TenantResolution } from "@/lib/tenancy/types";

const UNKNOWN_TENANT_HTML =
  "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Workspace not found</title></head><body><main><h1>Workspace not found</h1><p>This workspace is not available.</p></main></body></html>";

const UNSAFE_METHODS = new Set(["DELETE", "PATCH", "POST", "PUT"]);

export function sameOriginFailure(request: NextRequest): NextResponse | null {
  if (
    !request.nextUrl.pathname.startsWith("/api/")
    || request.nextUrl.pathname.startsWith("/api/webhooks/")
    || !UNSAFE_METHODS.has(request.method)
    || sameOrigin(request)
  ) {
    return null;
  }

  return NextResponse.json(
    { error: { code: "same_origin_required" } },
    { headers: { "Cache-Control": "private, no-store" }, status: 403 },
  );
}

type TenantProxyDependencies = {
  defaultOrgSlug?: string | null;
  resolveTenantHost(input: {
    defaultOrgSlug?: string | null;
    hostname: string;
  }): Promise<TenantResolution>;
  runLegacy(request: NextRequest): Promise<NextResponse>;
  writeContext(headers: Headers, resolution: TenantResolution): Headers;
};

export async function legacyProxy(request: NextRequest) {
  // FEATURE_REAL_AUTH off is the demo world: there is no Supabase session to
  // refresh and no sign-in route to send anyone to, so the guard steps aside
  // entirely rather than redirecting the fixture app to /sign-in (D-18, D-47).
  if (!featureFlag("FEATURE_REAL_AUTH")) {
    return NextResponse.next({ request });
  }

  const { hasSession, response, responseHeaders } =
    await updateSession(request);

  const decision = guardDecision({
    hasSession,
    pathname: request.nextUrl.pathname,
  });

  // IMPORTANT: return the supabaseResponse object as it is. It carries the
  // refreshed session cookies and the anti-cache headers that came with them.
  if (decision === null) {
    return response;
  }

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = decision.redirectTo;
  redirectUrl.search = "";

  const redirect = NextResponse.redirect(redirectUrl);

  // getClaims() may have rotated a single-use refresh token into `response`.
  // Any branch that returns a different object has to carry those cookies and
  // headers across, or the user is intermittently signed out with no error.
  response.cookies.getAll().forEach((cookie) => {
    redirect.cookies.set(cookie);
  });
  responseHeaders.forEach((value, key) => {
    redirect.headers.set(key, value);
  });

  return redirect;
}

export async function tenantProxy(
  request: NextRequest,
  dependencies: TenantProxyDependencies,
): Promise<NextResponse> {
  const resolution = await dependencies.resolveTenantHost({
    defaultOrgSlug: dependencies.defaultOrgSlug,
    hostname: request.nextUrl.hostname,
  });

  if (resolution.kind === "unknown") {
    return new NextResponse(UNKNOWN_TENANT_HTML, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/html; charset=utf-8",
      },
      status: 404,
    });
  }

  const requestWithTenantContext = new NextRequest(request, {
    headers: dependencies.writeContext(request.headers, resolution),
  });
  return dependencies.runLegacy(requestWithTenantContext);
}

export async function proxy(request: NextRequest) {
  const originFailure = sameOriginFailure(request);
  if (originFailure !== null) return originFailure;

  if (!featureFlag("FEATURE_TENANCY")) {
    return legacyProxy(request);
  }

  const [{ writeTenantRequestContext }, { resolveTenantHost }] =
    await Promise.all([
      import("@/lib/tenancy/context"),
      import("@/lib/tenancy/resolve"),
    ]);

  return tenantProxy(request, {
    defaultOrgSlug: process.env.DEFAULT_ORG_SLUG,
    resolveTenantHost,
    runLegacy: legacyProxy,
    writeContext: writeTenantRequestContext,
  });
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     *
     * /api is otherwise deliberately NOT excluded: /api/auth/* and PATCH
     * /api/org/settings both need the session-refresh pass.
     *
     * Three API exclusions are integration's ruling, DEC-OWN-PROXY-WEBHOOKS:
     *
     * - `api/webhooks` — Stripe and CRS verify a signature over the RAW body
     *   and carry no session. Anything this proxy does there is wrong: a
     *   redirect answers the provider instead of the handler, and touching the
     *   body at all breaks the signature the handler has to recompute. Prefix
     *   matching is safe because no other route starts with that path.
     *
     * - `api/enroll$` — the unauthenticated bootstrap. Inside the matcher it
     *   would be redirected to /sign-in by the guard, which is the whole
     *   failure the ruling exists to prevent. The `$` is load-bearing: a bare
     *   `api/enroll` prefix would also exclude lane B's `/api/enrollments/:id/*`
     *   routes, which are authenticated and do want the session pass.
     *
     * - `api/referrals/resolve/` — the public bearer landing. The trailing slash
     *   keeps referral creation and conversion inside the session pass.
     *
     * A Next matcher discriminates on path, never on method, so this excludes
     * POST /api/enroll as well as the GET the ruling names. That is a session
     * refresh the route does not get, not a gate it escapes — INTERFACES §3.1
     * already requires every handler to resolve its own session.
     */
    "/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/enroll$|api/referrals/resolve/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
