import { featureFlag } from "@/lib/env";
import { disabled, failure, hasKeys, invalid, isRecord, json, UUID } from "@/lib/ancillary/http";
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  if (!featureFlag("FEATURE_ANCILLARY")) return disabled(); const { id } = await context.params; if (!UUID.test(id)) return invalid();
  try { const [{ requireRole }, { assertTenantWriteAllowed }, { publishTraining, trainingResponse }] = await Promise.all([import("@/lib/auth/session"), import("@/lib/tenancy/wall"), import("@/lib/ancillary/trainings")]); const session = await requireRole("operator_member", "platform_admin"); await assertTenantWriteAllowed(session); let value: unknown; try { value = await request.json(); } catch { return invalid(); }
    if (!isRecord(value) || !hasKeys(value, ["attested"]) || value.attested !== true) return invalid(); return json(trainingResponse(await publishTraining(session, id, true), session.role === "platform_admin"), 200, { "Cache-Control": "private, no-store" });
  } catch (error) { return failure(error); }
}
export async function DELETE(request: Request, context: Context) {
  if (!featureFlag("FEATURE_ANCILLARY")) return disabled(); const { id } = await context.params; if (!UUID.test(id)) return invalid();
  try {
    const [{ requireRole }, { assertTenantWriteAllowed }, { trainingResponse, unpublishTraining }] = await Promise.all([import("@/lib/auth/session"), import("@/lib/tenancy/wall"), import("@/lib/ancillary/trainings")]);
    const session = await requireRole("operator_member", "platform_admin");
    await assertTenantWriteAllowed(session);
    if (session.role === "platform_admin") {
      if (!featureFlag("FEATURE_CONSOLE_OPS")) return json({ error: "console_ops_disabled" }, 503);
      let value: unknown; try { value = await request.json(); } catch { return invalid(); }
      if (!isRecord(value) || Object.keys(value).length !== 1 || !hasKeys(value, ["reason"]) || typeof value.reason !== "string") return invalid();
      return json(trainingResponse(await unpublishTraining(session, id, value.reason), true), 200, { "Cache-Control": "private, no-store" });
    }
    return json(trainingResponse(await unpublishTraining(session, id), false), 200, { "Cache-Control": "private, no-store" });
  } catch (error) { return failure(error); }
}
