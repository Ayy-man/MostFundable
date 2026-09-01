import { handleRevenueTick, revenueFeatureOffResponse } from "@/lib/revenue/handlers";
import { schedulerEnabled } from "@/lib/jobs/scheduler";

export const runtime = "nodejs";
/**
 * Seconds. Next.js reads this out of the build output, so it has to be a literal
 * — `TICK_FUNCTION_LIMIT_MS` in `@/lib/revenue/handlers` is the same number in
 * the form the drain budget is computed from, and `routes.test.ts` asserts the
 * two agree. It was implicit before, inherited from the deployment plan's
 * default, which is how the drain came to have no relationship to it at all.
 */
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  if (!await schedulerEnabled()) return revenueFeatureOffResponse();
  return handleRevenueTick(request);
}
