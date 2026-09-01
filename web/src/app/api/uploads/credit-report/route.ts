import { featureFlag } from "@/lib/env";
import { disabled, failure, invalid, json, unavailable, UUID } from "@/lib/ancillary/http";
export async function POST(request: Request) {
  if (!featureFlag("FEATURE_ANCILLARY")) return disabled(); const clientId = new URL(request.url).searchParams.get("clientId"); if (!clientId || !UUID.test(clientId)) return invalid();
  try { const [{ getSession }, { assertTenantWriteAllowed }, { clientReachable }, parserModule, service] = await Promise.all([import("@/lib/auth/session"), import("@/lib/tenancy/wall"), import("@/lib/applications/access"), import("@/lib/ancillary/parser"), import("@/lib/ancillary/report-uploads")]); const session = await getSession(); if (!session) return json({ error: "authentication_required" }, 401); if ((session.role !== "consumer" && session.role !== "operator_member") || !session.orgId) return json({ error: "forbidden" }, 403); await assertTenantWriteAllowed(session); if (!(await clientReachable(session, clientId))) return json({ error: "not_found" }, 404);
    try { parserModule.creditReportParser.assertAvailable(); } catch { return unavailable("credit_report_parser_unavailable"); }
    const form = await request.formData(); const entry = form.get("file"); if (!(entry instanceof File) || form.getAll("file").length !== 1) return invalid(); const result = await service.uploadCreditReport({ orgId: session.orgId, clientId, actorId: session.id, fileName: entry.name, mimeType: entry.type, bytes: new Uint8Array(await entry.arrayBuffer()) }); return json(result, result.status === "queued" ? 201 : 202);
  } catch (error) {
    // R5B-05. The rewrite used to run the other way round: any 500 out of `failure` became a 422
    // `credit_report_invalid`, so a storage, database or runtime outage was reported to the consumer
    // as a fault in the file they uploaded, and the real cause was discarded on the way out. The
    // consumer-facing 422 is kept exactly where it was earned — `failure` answers 422 only for an
    // `*_INVALID` identifier the upload itself raised, and that arm keeps the single stable code the
    // caller already parses rather than leaking which check tripped. Anything the mapper cannot name
    // stays the recorded, correlated 500 `failure` now produces, and blames nobody.
    const response = failure(error);
    return response.status === 422 ? json({ error: "credit_report_invalid" }, 422) : response;
  }
}
