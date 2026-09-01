import { featureFlag } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function enabled(): boolean {
  return featureFlag("FEATURE_ADMIN") && featureFlag("FEATURE_VAULT");
}

export async function GET(): Promise<Response> {
  if (!enabled()) return new Response(null, { status: 404 });
  const { handleAdminBankCatalogList } = await import("@/lib/admin/bank-catalog-handler");
  return handleAdminBankCatalogList();
}

export async function POST(request: Request): Promise<Response> {
  if (!enabled()) return new Response(null, { status: 404 });
  const { handleAdminBankCatalogCreate } = await import("@/lib/admin/bank-catalog-handler");
  return handleAdminBankCatalogCreate(request);
}
