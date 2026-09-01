import { featureFlag } from "@/lib/env";

const headers = { "Cache-Control": "private, no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalid() {
  return Response.json({ error: "TIMELINE_REQUEST_INVALID" }, { status: 400, headers });
}

export async function POST(request: Request) {
  if (!featureFlag("FEATURE_TIMELINE")) return new Response(null, { status: 404, headers });
  const [{ getSession }, { assertTenantWriteAllowed }, { clientReachable }, { createDocumentRequest }] = await Promise.all([
    import("@/lib/auth/session"),
    import("@/lib/tenancy/wall"),
    import("@/lib/applications/access"),
    import("@/lib/timeline/write.server"),
  ]);
  const session = await getSession();
  if (!session) return Response.json({ error: "TIMELINE_ACTOR_REQUIRED" }, { status: 401, headers });
  if (session.role !== "operator_member" || session.orgId === null) {
    return Response.json({ error: "TIMELINE_FORBIDDEN" }, { status: 403, headers });
  }
  await assertTenantWriteAllowed(session);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalid();
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) return invalid();
  const { clientId, name, why } = body as Record<string, unknown>;
  if (typeof clientId !== "string" || !UUID.test(clientId) || typeof name !== "string" || typeof why !== "string") return invalid();
  const cleanName = name.trim();
  const cleanWhy = why.trim();
  if (cleanName.length < 2 || cleanName.length > 120 || cleanWhy.length < 2 || cleanWhy.length > 500) return invalid();
  if (!(await clientReachable(session, clientId))) {
    return Response.json({ error: "TIMELINE_FORBIDDEN" }, { status: 403, headers });
  }

  try {
    const documentRequest = await createDocumentRequest({
      orgId: session.orgId,
      clientId,
      actorId: session.id,
      name: cleanName,
      why: cleanWhy,
    });
    return Response.json({ documentRequest }, { status: 201, headers });
  } catch {
    return Response.json({ error: "TIMELINE_WRITE_FAILED" }, { status: 500, headers });
  }
}

