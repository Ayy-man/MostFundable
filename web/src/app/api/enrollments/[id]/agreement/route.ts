import { featureFlag } from "@/lib/env";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context): Promise<Response> {
  if (!featureFlag("FEATURE_ENROLLMENT")) return new Response(null, { status: 404 });
  const { handleAgreementDownload } = await import("@/lib/enrollment/agreement-download.server");
  return handleAgreementDownload((await context.params).id);
}
