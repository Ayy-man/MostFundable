import { featureFlag } from "@/lib/env";
import { sameOrigin } from "@/lib/pricing/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (!featureFlag("FEATURE_ENROLLMENT")) return new Response(null, { status: 404 });
  if (!sameOrigin(request)) {
    return Response.json(
      { error: { code: "same_origin_required" } },
      { headers: { "Cache-Control": "private, no-store" }, status: 403 },
    );
  }
  const { handleConsumerBillingPortal } = await import("@/lib/billing/consumer-portal.server");
  return handleConsumerBillingPortal(request);
}
