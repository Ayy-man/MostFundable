import { featureFlag } from "@/lib/env";
import { disabled, failure, invalid, UUID } from "@/lib/ancillary/http";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  if (!featureFlag("FEATURE_ANCILLARY")) return disabled();
  const { id } = await context.params;
  if (!UUID.test(id)) return invalid();
  try {
    const [{ requireRole }, { downloadPlatformTrainingSource }] = await Promise.all([
      import("@/lib/auth/session"),
      import("@/lib/ancillary/trainings"),
    ]);
    const session = await requireRole("platform_admin");
    const source = await downloadPlatformTrainingSource(session, id);
    return new Response(source.bytes as BodyInit, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${source.fileName}"`,
        "Content-Length": String(source.bytes.byteLength),
        "Content-Type": source.mimeType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
