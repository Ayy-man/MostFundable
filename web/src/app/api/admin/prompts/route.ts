import { featureFlag } from "@/lib/env";

export async function GET(): Promise<Response> {
  if (!featureFlag("FEATURE_ADMIN")) return new Response(null, { status: 404 });
  const { handlePromptFamilies } = await import("@/lib/admin/handlers");
  return handlePromptFamilies();
}
