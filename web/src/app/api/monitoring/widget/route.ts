import { featureFlag } from "@/lib/env";
import { buildCrsWidgetEmbedConfig } from "@/lib/crs/widget-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where the browser loads the bureau's monitoring widget from, and the `WIDGET_CONFIGS` payload it
 * must post back when the frame asks for one.
 *
 * This is the static half of the embed. The moving half — the 30-second preauth token — stays on
 * `GET /api/monitoring/token`, whose 200 body is fixed at three fields on purpose, and the two are
 * fetched separately by `credit-widget.tsx`.
 *
 * 404 is the answer for both "the analysis flag is off" and "no host key is configured", matching
 * the token endpoint's rule that a route which cannot do its job does not exist. Nothing in the
 * body identifies a consumer, so there is nothing to leak on the way out; the read is still behind
 * the consumer session because our account's host key is nobody else's business.
 */
export async function GET(): Promise<Response> {
  if (!featureFlag("FEATURE_ANALYSIS")) return new Response(null, { status: 404 });

  const config = buildCrsWidgetEmbedConfig(process.env);
  if (config === null) return new Response(null, { status: 404 });

  const { requireRole } = await import("@/lib/auth/session");
  try {
    await requireRole("consumer");
  } catch {
    return new Response(null, { status: 401 });
  }

  return Response.json(config, {
    headers: { "Cache-Control": "private, no-store" },
    status: 200,
  });
}
