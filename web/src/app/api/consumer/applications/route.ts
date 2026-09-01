import { featureFlag } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  if (!featureFlag("FEATURE_REAL_AUTH") || !featureFlag("FEATURE_APPLICATIONS")) {
    return new Response(null, { status: 404 });
  }
  if ([...new URL(request.url).searchParams.keys()].length > 0) {
    return Response.json({ error: { code: "invalid_request" } }, {
      headers: { "Cache-Control": "private, no-store" },
      status: 400,
    });
  }
  const { handleConsumerApplications } = await import("@/lib/applications/consumer.server");
  return handleConsumerApplications();
}
