import { featureFlag } from "@/lib/env";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!featureFlag("FEATURE_KB")) return Response.json({ enabled: false }, { status: 200 });
  const { operatorKbHandler } = await import("@/lib/kb/handlers");
  return operatorKbHandler(request, "GET");
}

export async function POST(request: Request) {
  if (!featureFlag("FEATURE_KB")) return new Response(null, { status: 404 });
  const { operatorKbHandler } = await import("@/lib/kb/handlers");
  return operatorKbHandler(request, "POST");
}
