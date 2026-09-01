import { notFound } from "next/navigation";

import { featureFlag } from "@/lib/env";

import { handleOptimizationReport } from "./handler.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The consumer Optimization view's durable write.
 *
 * Consumer-only, and only ever their own client record. The role guard below admits nothing else;
 * the RPC behind it takes no client identifier at all and resolves one from `auth.uid()`, so there
 * is no argument on this path that could name somebody else's file. This route never touches the
 * service-role client.
 *
 * Behind `FEATURE_ANALYSIS`, the same flag the read is behind, because reporting a factor is a
 * claim about an analysis this platform has not run yet when the flag is off.
 */
export async function POST(request: Request): Promise<Response> {
  if (!featureFlag("FEATURE_ANALYSIS")) notFound();

  const [{ requireRole }, { readConsumerOptimization }, report, { recordRouteFailure }] =
    await Promise.all([
      import("@/lib/auth/session"),
      import("@/lib/optimization/read.server"),
      import("@/lib/optimization/report.server"),
      import("@/lib/diagnostics/route-failure"),
    ]);

  return handleOptimizationReport({
    readBody: () => request.json(),
    readConsumerOptimization,
    recordFailure: recordRouteFailure,
    reportChecklistItem: report.reportChecklistItem,
    requireConsumer: () => requireRole("consumer"),
  });
}
