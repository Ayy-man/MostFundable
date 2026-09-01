import { featureFlag } from "@/lib/env";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!featureFlag("FEATURE_KB")) return new Response(null, { status: 404 });
  const { adminKbHandler } = await import("@/lib/kb/handlers");
  return adminKbHandler(request);
}
