import { recordRouteFailure, withCorrelationId } from "@/lib/diagnostics/route-failure";
import { featureFlag, type EnvSource } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Dependencies = {
  env: EnvSource;
  requirePlatformAdmin(): Promise<unknown>;
};
const privateHeaders = { "Cache-Control": "private, no-store" };

function json(body: unknown, status = 200): Response {
  return Response.json(body, { headers: privateHeaders, status });
}

/**
 * The 401/403 an authority decision carries, and null for anything else. `AuthError` is matched by
 * name as well as by status because the session helpers reach this route through a dynamic import,
 * where `instanceof` on a duplicated module is quietly false.
 */
function authorityStatus(error: unknown): 401 | 403 | null {
  if (typeof error !== "object" || error === null) return null;
  const thrown = error as { name?: unknown; status?: unknown };
  if (thrown.status === 401) return 401;
  if (thrown.status === 403) return 403;
  return thrown.name === "AuthError" ? 403 : null;
}

export async function handleBillingConfig(dependencies: Dependencies): Promise<Response> {
  try {
    await dependencies.requirePlatformAdmin();
  } catch (error) {
    // R5B-04. This used to answer 403 for anything that was not a 401 — so a session store outage,
    // a database refusal or a driver misconfiguration was told to the caller as "you are not
    // allowed", indistinguishable from a genuine refusal in the response and absent from the log
    // stream entirely. Only an authority answer maps to an authority status now; everything else is
    // a server failure, recorded and correlated.
    const status = authorityStatus(error);
    if (status !== null) {
      return json({ error: { code: status === 401 ? "unauthenticated" : "forbidden" } }, status);
    }
    const correlationId = recordRouteFailure({
      cause: error,
      code: "billing_config_unavailable",
      status: 500,
      surface: "api.billing.config",
    });
    return json(
      withCorrelationId({ error: { code: "billing_config_unavailable" } }, correlationId),
      500,
    );
  }
  const testMode = dependencies.env.STRIPE_SECRET_KEY?.startsWith("sk_test_") === true;
  return json({ testMode });
}

export async function GET(): Promise<Response> {
  if (!featureFlag("FEATURE_BILLING_OPS")) return new Response(null, { status: 404 });
  const { requireRole } = await import("@/lib/auth/session");
  return handleBillingConfig({
    env: process.env,
    requirePlatformAdmin: () => requireRole("platform_admin"),
  });
}
