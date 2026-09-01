import { featureFlag } from "@/lib/env";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context): Promise<Response> {
  if (!featureFlag("FEATURE_ADMIN")) return new Response(null, { status: 404 });
  const { handleEvalDetail } = await import("@/lib/admin/handlers");
  const { id } = await context.params;
  return handleEvalDetail(id);
}
