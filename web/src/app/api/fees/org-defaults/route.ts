import { getOrgDefaults, patchOrgDefaults } from "@/lib/fees/handlers";
import { featureFlag } from "@/lib/env";

export const runtime = "nodejs";

/**
 * GET|PATCH /api/fees/org-defaults — the workspace's default fee arrangement,
 * which every client created afterwards inherits as a draft.
 *
 * The PATCH meets the same legal gate a per-client write does. A default is the
 * scaled version of that write: pre-loading a gated arrangement here once would
 * otherwise hand it to every client created from then on.
 */
export async function GET(): Promise<Response> {
  if (!featureFlag("FEATURE_FEES")) {
    return new Response(null, { status: 404 });
  }
  return getOrgDefaults();
}

export async function PATCH(request: Request): Promise<Response> {
  if (!featureFlag("FEATURE_FEES")) {
    return new Response(null, { status: 404 });
  }
  return patchOrgDefaults(request);
}
