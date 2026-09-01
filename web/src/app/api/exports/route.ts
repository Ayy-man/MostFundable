import { featureFlag } from "@/lib/env";
import { disabled, failure, invalid } from "@/lib/ancillary/http";
const FILTERS = new Set(["client_id", "analysis_run_id", "bank_ref", "state", "kind", "from", "to", "status"]);
export async function GET(request: Request) {
  if (!featureFlag("FEATURE_ANCILLARY")) return disabled();
  try { const [{ requireRole }, { createDerivedExport }] = await Promise.all([import("@/lib/auth/session"), import("@/lib/ancillary/exports")]); const session = await requireRole("platform_admin"); const params = new URL(request.url).searchParams; const dataset = params.get("dataset"); const format = params.get("format"); if (!dataset || !format) return invalid(); const filters: Record<string, string> = {}; for (const [key, value] of params) { if (key === "dataset" || key === "format") continue; if (!FILTERS.has(key) || key in filters) return invalid(); filters[key] = value; }
    const descriptor = createDerivedExport({ actor: session, dataset, format, filters }); return new Response(descriptor.stream, { headers: { "content-type": descriptor.contentType, "content-disposition": `attachment; filename="${descriptor.fileName}"` } });
  } catch (error) { return failure(error); }
}
