import { featureFlag } from "@/lib/env";
import { postPaymentReversal } from "@/lib/fees/handlers";

export const runtime = "nodejs";

type RouteContext<Path extends "/api/fees/payments/[paymentId]/reverse"> =
  Path extends string ? { params: Promise<{ paymentId: string }> } : never;

export async function POST(
  _request: Request,
  context: RouteContext<"/api/fees/payments/[paymentId]/reverse">,
): Promise<Response> {
  if (!featureFlag("FEATURE_FEES")) return new Response(null, { status: 404 });
  const { paymentId } = await context.params;
  return postPaymentReversal(paymentId);
}
