import type { SessionProfile } from "@/lib/auth/session";
import type { DrainJobsResult } from "@/lib/jobs/drainer";
import { tenancyFeatureEnabled } from "@/lib/tenancy/config";
import {
  noStore,
  tenantDisabledResponse,
  tenantRouteFailure,
} from "@/lib/tenancy/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Dependencies = {
  enabled(): boolean;
  now(): Date;
  requirePlatformAdmin(): Promise<SessionProfile>;
  runNow(subject: string, window: string): Promise<DrainJobsResult>;
};

function utcDate(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
}

export async function handleTrialExpiryRunNow(
  dependencies: Dependencies,
): Promise<Response> {
  if (!dependencies.enabled()) return tenantDisabledResponse();
  try {
    await dependencies.requirePlatformAdmin();
    const result = await dependencies.runNow("global", utcDate(dependencies.now()));
    return noStore(Response.json({
      claimed: result.claimed,
      completed: result.succeeded + result.skipped,
      failed: result.failed,
      retried: result.retried,
      status: result.failed > 0 ? "failed" : result.retried > 0 ? "retrying" : "complete",
    }));
  } catch (error) {
    return tenantRouteFailure(error);
  }
}

export async function POST(): Promise<Response> {
  return handleTrialExpiryRunNow({
    enabled: tenancyFeatureEnabled,
    now: () => new Date(),
    async requirePlatformAdmin() {
      const { requireRole } = await import("@/lib/auth/session");
      return requireRole("platform_admin");
    },
    async runNow(subject, window) {
      await import("@/lib/tenancy/jobs/register");
      const { runNow } = await import("@/lib/jobs/run-now");
      return runNow("tenancy.trial_expiry", subject, window);
    },
  });
}
