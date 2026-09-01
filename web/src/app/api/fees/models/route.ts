import { listModels } from "@/lib/fees/handlers";
import { featureFlag } from "@/lib/env";

export const runtime = "nodejs";

/**
 * GET /api/fees/models — which fee arrangements this organization may use, and
 * why not, when it may not.
 *
 * The gated entries come back as `available: false` with `reason: "legal_gate"`
 * so the surface renders its pending-legal-review state from this response
 * rather than from a condition it would have to keep in step with the database
 * by hand.
 */
export async function GET(request: Request): Promise<Response> {
  if (!featureFlag("FEATURE_FEES")) {
    return new Response(null, { status: 404 });
  }
  return listModels(request);
}
