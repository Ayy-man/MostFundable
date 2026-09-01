import { featureFlag } from "@/lib/env";

export async function GET(): Promise<Response> {
  if (!featureFlag("FEATURE_ADMIN")) return new Response(null, { status: 404 });
  const { handleOverview } = await import("@/lib/admin/handlers");
  return handleOverview({
    applications: featureFlag("FEATURE_APPLICATIONS"),
    fees: featureFlag("FEATURE_FEES"),
  });
}
