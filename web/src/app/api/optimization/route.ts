import { notFound } from "next/navigation";

import { featureFlag } from "@/lib/env";

import { handleOptimizationGet } from "./handler.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The consumer Optimization view's durable read.
 *
 * Consumer-only, and only ever their own client record: the role guard below admits nothing else,
 * and the read behind it refuses again and then scopes every query to the single client the
 * session resolves to, under that session's own RLS. This route never touches the service-role
 * client.
 *
 * Behind `FEATURE_ANALYSIS` because there is nothing derived to show until the analysis pipeline
 * has run; with the flag off the route does not exist and the surface keeps its fixture.
 */
export async function GET(): Promise<Response> {
  if (!featureFlag("FEATURE_ANALYSIS")) notFound();

  const [{ requireRole }, { readConsumerOptimization }, { recordRouteFailure }] = await Promise.all([
    import("@/lib/auth/session"),
    import("@/lib/optimization/read.server"),
    import("@/lib/diagnostics/route-failure"),
  ]);

  return handleOptimizationGet({
    readConsumerOptimization,
    recordFailure: recordRouteFailure,
    requireConsumer: () => requireRole("consumer"),
  });
}
