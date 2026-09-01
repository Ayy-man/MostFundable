import { featureFlag } from "@/lib/env";

export async function GET(): Promise<Response> {
  if (!featureFlag("FEATURE_ADMIN")) return new Response(null, { status: 404 });
  const { handleGetLayout } = await import("@/lib/admin/handlers");
  return handleGetLayout();
}

export async function PATCH(request: Request): Promise<Response> {
  if (!featureFlag("FEATURE_ADMIN")) return new Response(null, { status: 404 });
  const { handlePatchLayout } = await import("@/lib/admin/handlers");
  return handlePatchLayout(request);
}
