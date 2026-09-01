import { postPayment } from "@/lib/fees/handlers";
import { featureFlag } from "@/lib/env";

export const runtime = "nodejs";

type RouteContext<Path extends "/api/fees/[clientId]/payments"> = Path extends string
  ? { params: Promise<{ clientId: string }> }
  : never;

/**
 * POST /api/fees/[clientId]/payments — a manual entry recording that money
 * moved somewhere else. Payouts happen off platform (BACKEND-SPEC §5), so this
 * is bookkeeping rather than a transfer, and the row it creates is durable:
 * `recordPayment` writes an append-only record that can be reversed but never
 * edited or deleted.
 *
 * A non-positive amount, a received-on date in the future and an over-long note
 * are all refused here with a sentence, so the caller gets something they can
 * act on instead of a constraint violation arriving as a 500. The database
 * constraints stay behind them as the backstop.
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/fees/[clientId]/payments">,
): Promise<Response> {
  if (!featureFlag("FEATURE_FEES")) {
    return new Response(null, { status: 404 });
  }
  const { clientId } = await context.params;
  return postPayment(request, clientId);
}
