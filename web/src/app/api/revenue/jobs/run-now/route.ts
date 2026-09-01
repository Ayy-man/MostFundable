import { featureFlag } from "@/lib/env";
import { handleRevenueRunNow, revenueFeatureOffResponse } from "@/lib/revenue/handlers";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (!featureFlag("FEATURE_REVENUE")) return revenueFeatureOffResponse();
  return handleRevenueRunNow(request);
}
