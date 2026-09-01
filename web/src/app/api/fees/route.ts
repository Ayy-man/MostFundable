import { listReceivables } from "@/lib/fees/handlers";
import { featureFlag } from "@/lib/env";

export const runtime = "nodejs";

/**
 * GET /api/fees — the org's receivables, one row per client that has a fee
 * agreement or a ledger row: display name, model, status, total, paid, balance
 * and the date of the last payment that still counts.
 *
 * Scoped by RLS rather than by a filter in this handler. The RPC underneath is
 * security invoker, so a caller asking for another organization's id gets an
 * empty list rather than a refusal, which is the same answer an organization
 * with no fees would get.
 */
export async function GET(request: Request): Promise<Response> {
  if (!featureFlag("FEATURE_FEES")) {
    return new Response(null, { status: 404 });
  }
  return listReceivables(request);
}
