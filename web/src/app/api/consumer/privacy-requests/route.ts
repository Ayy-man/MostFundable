import { featureFlag } from "@/lib/env";
import { sameOrigin } from "@/lib/pricing/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function enabled(): boolean {
  return featureFlag("FEATURE_REAL_AUTH");
}

export async function GET(request: Request): Promise<Response> {
  if (!enabled()) return new Response(null, { status: 404 });
  const { handleConsumerPrivacyRequests } = await import("@/lib/privacy/http");
  return handleConsumerPrivacyRequests(request);
}

export async function POST(request: Request): Promise<Response> {
  if (!enabled()) return new Response(null, { status: 404 });
  if (!sameOrigin(request)) return Response.json(
    { error: { code: "same_origin_required" } },
    { headers: { "Cache-Control": "private, no-store" }, status: 403 },
  );
  const { handleConsumerPrivacyRequests } = await import("@/lib/privacy/http");
  return handleConsumerPrivacyRequests(request);
}
