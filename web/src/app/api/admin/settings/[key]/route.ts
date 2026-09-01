import { featureFlag } from "@/lib/env";

type Context = { params: Promise<{ key: string }> };

export async function GET(_request: Request, context: Context): Promise<Response> {
  if (!featureFlag("FEATURE_ADMIN")) return new Response(null, { status: 404 });
  const { handleGetSetting } = await import("@/lib/admin/handlers");
  const { key } = await context.params;
  return handleGetSetting(key);
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  if (!featureFlag("FEATURE_ADMIN")) return new Response(null, { status: 404 });
  const { handlePatchSetting } = await import("@/lib/admin/handlers");
  const { key } = await context.params;
  return handlePatchSetting(request, key);
}
