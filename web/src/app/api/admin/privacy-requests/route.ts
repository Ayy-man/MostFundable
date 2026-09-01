import { featureFlag } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  if (!featureFlag("FEATURE_ADMIN") || !featureFlag("FEATURE_REAL_AUTH")) {
    return new Response(null, { status: 404 });
  }
  const { handleAdminPrivacyRequests } = await import("@/lib/privacy/http");
  return handleAdminPrivacyRequests();
}
