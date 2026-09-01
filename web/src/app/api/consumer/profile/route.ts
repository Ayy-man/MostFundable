import { featureFlag } from "@/lib/env";
import { sameOrigin } from "@/lib/pricing/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  if (!featureFlag("FEATURE_REAL_AUTH")) return new Response(null, { status: 404 });
  if ([...new URL(request.url).searchParams.keys()].length > 0) {
    return Response.json(
      { error: { code: "invalid_request" } },
      { headers: { "Cache-Control": "private, no-store" }, status: 400 },
    );
  }
  const { handleConsumerProfileRead } = await import("@/lib/profile/consumer-profile.server");
  return handleConsumerProfileRead();
}

export async function PATCH(request: Request): Promise<Response> {
  if (!featureFlag("FEATURE_REAL_AUTH")) return new Response(null, { status: 404 });
  if (!sameOrigin(request)) {
    return Response.json(
      { error: { code: "same_origin_required" } },
      { headers: { "Cache-Control": "private, no-store" }, status: 403 },
    );
  }
  const { handleConsumerProfileUpdate } = await import("@/lib/profile/consumer-profile.server");
  return handleConsumerProfileUpdate(request);
}
