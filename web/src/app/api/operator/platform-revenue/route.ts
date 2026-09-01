import { featureFlag } from "@/lib/env";

export async function GET(request: Request): Promise<Response> {
  if (!featureFlag("FEATURE_REVENUE")) return new Response(null, { status: 404 });
  const { handleOperatorPlatformRevenue } = await import("@/lib/operator/platform-revenue.server");
  return handleOperatorPlatformRevenue(request);
}
