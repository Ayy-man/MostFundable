import { featureFlag } from "@/lib/env";

export async function GET(request: Request): Promise<Response> {
  if (!featureFlag("FEATURE_ADMIN")) return new Response(null, { status: 404 });
  const { handleEvalHistory } = await import("@/lib/admin/handlers");
  return handleEvalHistory(request);
}
