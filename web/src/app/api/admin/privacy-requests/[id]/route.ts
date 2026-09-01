import { featureFlag } from "@/lib/env";
import { sameOrigin } from "@/lib/pricing/http";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Context = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request: Request, context: Context): Promise<Response> {
  if (!featureFlag("FEATURE_ADMIN") || !featureFlag("FEATURE_REAL_AUTH")) {
    return new Response(null, { status: 404 });
  }
  if (!sameOrigin(request)) return Response.json(
    { error: { code: "same_origin_required" } },
    { headers: { "Cache-Control": "private, no-store" }, status: 403 },
  );
  const { id } = await context.params;
  if (!UUID.test(id)) return Response.json(
    { error: { code: "invalid_request" } },
    { headers: { "Cache-Control": "private, no-store" }, status: 400 },
  );
  const { handleAdminPrivacyRequestAction } = await import("@/lib/privacy/http");
  return handleAdminPrivacyRequestAction(request, id);
}
