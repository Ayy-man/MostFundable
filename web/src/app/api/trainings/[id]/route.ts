import { featureFlag } from "@/lib/env";
import { disabled, failure, hasKeys, invalid, isRecord, json, UUID } from "@/lib/ancillary/http";
type Context = { params: Promise<{ id: string }> }; const KEYS = ["audience", "title", "videoUrl", "body"] as const;
export async function PATCH(request: Request, context: Context) {
  if (!featureFlag("FEATURE_ANCILLARY")) return disabled(); const { id } = await context.params; if (!UUID.test(id)) return invalid();
  try { const [{ requireRole }, { assertTenantWriteAllowed }, { trainingResponse, updatePlatformTrainingWithSource, updateTraining }] = await Promise.all([import("@/lib/auth/session"), import("@/lib/tenancy/wall"), import("@/lib/ancillary/trainings")]); const session = await requireRole("operator_member", "platform_admin"); await assertTenantWriteAllowed(session);
    if (session.role === "platform_admin") {
      if (!request.headers.get("content-type")?.startsWith("multipart/form-data;")) return invalid();
      const { parsePlatformTrainingForm, trainingSourceInputFromFile } = await import("@/lib/ancillary/training-request");
      let form: FormData; try { form = await request.formData(); } catch { return invalid(); }
      const parsed = parsePlatformTrainingForm(form, false);
      if (!parsed) return invalid();
      const row = parsed.sourceFile
        ? await updatePlatformTrainingWithSource(session, id, parsed.input, await trainingSourceInputFromFile(parsed.sourceFile))
        : await updateTraining(session, id, parsed.input);
      return json(trainingResponse(row, true), 200, { "Cache-Control": "private, no-store" });
    }
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return invalid();
    let value: unknown; try { value = await request.json(); } catch { return invalid(); }
    if (!isRecord(value) || !hasKeys(value, KEYS) || typeof value.audience !== "string" || typeof value.title !== "string" || typeof value.videoUrl !== "string" || typeof value.body !== "string") return invalid();
    return json(trainingResponse(await updateTraining(session, id, { audience: value.audience as "client" | "operator", title: value.title, videoUrl: value.videoUrl, body: value.body }), false), 200, { "Cache-Control": "private, no-store" });
  } catch (error) { return failure(error); }
}
export async function DELETE(_request: Request, context: Context) {
  if (!featureFlag("FEATURE_ANCILLARY")) return disabled(); const { id } = await context.params; if (!UUID.test(id)) return invalid();
  try { const [{ requireRole }, { assertTenantWriteAllowed }, { deleteTraining }] = await Promise.all([import("@/lib/auth/session"), import("@/lib/tenancy/wall"), import("@/lib/ancillary/trainings")]); const session = await requireRole("operator_member", "platform_admin"); await assertTenantWriteAllowed(session); await deleteTraining(session, id); return new Response(null, { status: 204 }); } catch (error) { return failure(error); }
}
