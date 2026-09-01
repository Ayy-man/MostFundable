import { featureFlag } from "@/lib/env";
import { disabled, failure, invalid, json, UUID } from "@/lib/ancillary/http";
type Context = { params: Promise<{ id: string }> };
export async function POST(_request: Request, context: Context) { if (!featureFlag("FEATURE_ANCILLARY")) return disabled(); const { id } = await context.params; if (!UUID.test(id)) return invalid(); try { const [{ requireRole }, { runUploadedReportPurge }] = await Promise.all([import("@/lib/auth/session"), import("@/lib/ancillary/purge")]); await requireRole("platform_admin"); const window = new Date().toISOString().slice(0, 10); const result = await runUploadedReportPurge(`upload:${id}`, window); return json(result, result.status === "failed" ? 500 : 200); } catch (error) { return failure(error); } }
