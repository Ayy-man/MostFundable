import { featureFlag } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ ref: string }> },
): Promise<Response> {
  if (!featureFlag("FEATURE_ADMIN") || !featureFlag("FEATURE_VAULT")) {
    return new Response(null, { status: 404 });
  }
  const { ref } = await params;
  const { handleAdminBankCatalogMutation } = await import("@/lib/admin/bank-catalog-handler");
  return handleAdminBankCatalogMutation(request, ref);
}
