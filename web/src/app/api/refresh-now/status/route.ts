import { handlePaidRefreshStatusGet } from "./handler.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only, consumer-scoped status for the durable request/payment/job chain.
 * Purchase flags and provider readiness govern new money only; they must never
 * hide payment history that already exists.
 */
export async function GET(): Promise<Response> {
  const [{ requireRole }, { readConsumerPaidRefreshHistory }, { recordRouteFailure }] =
    await Promise.all([
      import("@/lib/auth/session"),
      import("@/lib/pricing/paid-refresh-read.server"),
      import("@/lib/diagnostics/route-failure"),
    ]);

  return handlePaidRefreshStatusGet({
    read: readConsumerPaidRefreshHistory,
    recordFailure: recordRouteFailure,
    requireConsumer: () => requireRole("consumer"),
  });
}
