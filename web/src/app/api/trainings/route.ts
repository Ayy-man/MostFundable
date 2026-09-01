import { featureFlag } from "@/lib/env";
import { disabled, failure, hasKeys, invalid, isRecord, json } from "@/lib/ancillary/http";
const KEYS = ["audience", "title", "videoUrl", "body"] as const;
export async function GET() {
  if (!featureFlag("FEATURE_ANCILLARY")) return disabled();
  try { const [{ getSession }, { listTrainings, trainingResponse }, { readPortalPreferencesForOrg }] = await Promise.all([import("@/lib/auth/session"), import("@/lib/ancillary/trainings"), import("@/lib/portal/preferences.server")]); const session = await getSession(); if (!session) return json({ error: "authentication_required" }, 401); if (session.role === "consumer" && session.orgId && !(await readPortalPreferencesForOrg(session.orgId)).portal.showTrainings) return json({ trainings: [], hiddenByWorkspace: true }, 200, { "Cache-Control": "private, no-store" }); const rows = await listTrainings(session); return json({ trainings: rows.map((row) => trainingResponse(row, session.role === "platform_admin")) }, 200, { "Cache-Control": "private, no-store" }); } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  if (!featureFlag("FEATURE_ANCILLARY")) return disabled();
  try {
    const [{ requireRole }, { assertTenantWriteAllowed }, { createTraining }] = await Promise.all([import("@/lib/auth/session"), import("@/lib/tenancy/wall"), import("@/lib/ancillary/trainings")]);
    const session = await requireRole("operator_member", "platform_admin");
    await assertTenantWriteAllowed(session);
    if (session.role === "platform_admin") {
      if (!request.headers.get("content-type")?.startsWith("multipart/form-data;")) return invalid();
      const [{ parsePlatformTrainingForm, trainingSourceInputFromFile }, { trainingResponse }] = await Promise.all([import("@/lib/ancillary/training-request"), import("@/lib/ancillary/trainings")]);
      let form: FormData; try { form = await request.formData(); } catch { return invalid(); }
      const parsed = parsePlatformTrainingForm(form, true);
      if (!parsed?.sourceFile) return invalid();
      return json(trainingResponse(await createTraining(session, parsed.input, undefined, await trainingSourceInputFromFile(parsed.sourceFile)), true), 201, { "Cache-Control": "private, no-store" });
    }
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return invalid();
    let value: unknown; try { value = await request.json(); } catch { return invalid(); }
    if (!isRecord(value) || !hasKeys(value, KEYS) || typeof value.audience !== "string" || typeof value.title !== "string" || typeof value.videoUrl !== "string" || typeof value.body !== "string") return invalid();
    const { trainingResponse } = await import("@/lib/ancillary/trainings");
    return json(trainingResponse(await createTraining(session, { audience: value.audience as "client" | "operator", title: value.title, videoUrl: value.videoUrl, body: value.body }), false), 201, { "Cache-Control": "private, no-store" });
  } catch (error) { return failure(error); }
}
