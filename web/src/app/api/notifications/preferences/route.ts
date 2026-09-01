import { disabled } from "@/lib/ancillary/http";
import { featureFlag } from "@/lib/env";
import { sameOrigin } from "@/lib/pricing/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  if (!featureFlag("FEATURE_ANCILLARY")) return disabled();
  const { handleConsumerNotificationPreferencesGet } = await import(
    "@/lib/notifications/preferences.server"
  );
  return handleConsumerNotificationPreferencesGet();
}

export async function PATCH(request: Request): Promise<Response> {
  if (!featureFlag("FEATURE_ANCILLARY")) return disabled();
  if (!sameOrigin(request)) {
    return Response.json(
      { error: { code: "same_origin_required" } },
      { headers: { "Cache-Control": "private, no-store" }, status: 403 },
    );
  }
  const { handleConsumerNotificationPreferencesPatch } = await import(
    "@/lib/notifications/preferences.server"
  );
  return handleConsumerNotificationPreferencesPatch(request);
}
