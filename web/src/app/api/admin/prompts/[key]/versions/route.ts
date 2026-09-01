import { featureFlag } from "@/lib/env";

type Context = { params: Promise<{ key: string }> };

export async function GET(_request: Request, context: Context): Promise<Response> {
  if (!featureFlag("FEATURE_ADMIN")) return new Response(null, { status: 404 });
  const { handlePromptVersions } = await import("@/lib/admin/handlers");
  const { key } = await context.params;
  return handlePromptVersions(key);
}

export async function POST(request: Request, context: Context): Promise<Response> {
  if (!featureFlag("FEATURE_ADMIN")) return new Response(null, { status: 404 });
  const { handleCreatePromptVersion } = await import("@/lib/admin/handlers");
  const { key } = await context.params;
  return handleCreatePromptVersion(request, key);
}
