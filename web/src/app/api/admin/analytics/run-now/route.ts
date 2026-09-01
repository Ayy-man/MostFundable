import { featureFlag } from "@/lib/env";

export async function POST(request: Request): Promise<Response> {
  if (!featureFlag("FEATURE_ADMIN")) return new Response(null, { status: 404 });
  const { handleAnalyticsRunNow } = await import("@/lib/admin/handlers");
  return handleAnalyticsRunNow(request);
}
