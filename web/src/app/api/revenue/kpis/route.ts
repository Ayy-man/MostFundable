import { featureFlag } from "@/lib/env";
import { handleRevenueKpis, revenueFeatureOffResponse } from "@/lib/revenue/handlers";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  if (!featureFlag("FEATURE_REVENUE")) return revenueFeatureOffResponse();
  return handleRevenueKpis(request);
}
