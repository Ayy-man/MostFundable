import { featureFlag } from "@/lib/env";

export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  if (!featureFlag("FEATURE_TIMELINE")) return new Response(null, { status: 404, headers });
  const { id } = await context.params;
  if (!UUID.test(id)) return Response.json({ error: "TIMELINE_REQUEST_INVALID" }, { status: 400, headers });

  const [{ getSession }, { getThread }] = await Promise.all([
    import("@/lib/auth/session"),
    import("@/lib/support"),
  ]);
  const session = await getSession();
  if (!session) return Response.json({ error: "TIMELINE_ACTOR_REQUIRED" }, { status: 401, headers });

  const payload = await getThread(id, { profileId: session.id, role: session.role });
  if (payload === null) return Response.json({ error: "TIMELINE_FORBIDDEN" }, { status: 403, headers });
  return Response.json(payload.timeline ?? { events: [], readFailed: true }, { status: 200, headers });
}

