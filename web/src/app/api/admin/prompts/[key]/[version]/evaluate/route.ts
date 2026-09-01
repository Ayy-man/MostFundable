import { featureFlag } from "@/lib/env";

type Context = { params: Promise<{ key: string; version: string }> };

export async function POST(_request: Request, context: Context): Promise<Response> {
  if (!featureFlag("FEATURE_ADMIN")) return new Response(null, { status: 404 });
  const { handleEvaluatePrompt } = await import("@/lib/admin/handlers");
  const { key, version } = await context.params;
  return handleEvaluatePrompt(key, version);
}
