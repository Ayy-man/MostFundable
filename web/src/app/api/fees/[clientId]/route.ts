import { readClientFees } from "@/lib/fees/handlers";
import { featureFlag } from "@/lib/env";

export const runtime = "nodejs";

// Next generates the equivalent global helper during build/typegen. Keeping
// this route-local fallback lets the repository's plain `tsc --noEmit` script
// run before the first build in a clean checkout, matching
// `web/src/app/api/clients/[id]/route.ts:12`.
type RouteContext<Path extends "/api/fees/[clientId]"> = Path extends string
  ? { params: Promise<{ clientId: string }> }
  : never;

/**
 * GET /api/fees/[clientId] — one client's agreement, ledger and payment
 * history in a single response, which is what the client-drawer Fees tab needs
 * to render without three round trips.
 *
 * A client in another organization reads as empty rather than as an error: the
 * RPC is security invoker, so RLS answers, and telling a caller that an id is
 * real would be the disclosure the policy exists to prevent.
 */
export async function GET(
  _request: Request,
  context: RouteContext<"/api/fees/[clientId]">,
): Promise<Response> {
  if (!featureFlag("FEATURE_FEES")) {
    return new Response(null, { status: 404 });
  }
  const { clientId } = await context.params;
  return readClientFees(clientId);
}
