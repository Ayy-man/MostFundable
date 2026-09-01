import { featureFlag } from "@/lib/env";

const headers = { "Cache-Control": "private, no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Context = { params: Promise<{ uploadId: string }> };

interface AdminReader {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: unknown): {
        maybeSingle(): Promise<{ data: unknown; error: unknown }>;
      };
    };
  };
}

export async function POST(_request: Request, context: Context) {
  if (!featureFlag("FEATURE_TIMELINE")) return new Response(null, { status: 404, headers });
  const { uploadId } = await context.params;
  if (!UUID.test(uploadId)) return Response.json({ error: "TIMELINE_REQUEST_INVALID" }, { status: 400, headers });

  const [{ getSession }, { assertTenantWriteAllowed }, { clientReachable }, { createAdminClient }, { recordDocumentReview }] = await Promise.all([
    import("@/lib/auth/session"),
    import("@/lib/tenancy/wall"),
    import("@/lib/applications/access"),
    import("@/lib/supabase/admin"),
    import("@/lib/timeline/write.server"),
  ]);
  const session = await getSession();
  if (!session) return Response.json({ error: "TIMELINE_ACTOR_REQUIRED" }, { status: 401, headers });
  if (session.role !== "operator_member" || session.orgId === null) {
    return Response.json({ error: "TIMELINE_FORBIDDEN" }, { status: 403, headers });
  }
  await assertTenantWriteAllowed(session);

  const db = createAdminClient() as unknown as AdminReader;
  const result = await db.from("document_uploads").select("client_id, org_id, kind, lifecycle").eq("id", uploadId).maybeSingle();
  if (result.error || result.data === null || typeof result.data !== "object") {
    return Response.json({ error: "TIMELINE_FORBIDDEN" }, { status: 403, headers });
  }
  const upload = result.data as Record<string, unknown>;
  const clientId = upload.client_id;
  if (typeof clientId !== "string" || upload.org_id !== session.orgId || upload.kind !== "company" || upload.lifecycle !== "stored" || !(await clientReachable(session, clientId))) {
    return Response.json({ error: "TIMELINE_FORBIDDEN" }, { status: 403, headers });
  }

  try {
    const review = await recordDocumentReview({ orgId: session.orgId, uploadId, actorId: session.id });
    return Response.json({ review }, { status: 201, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("duplicate key")) return Response.json({ error: "TIMELINE_REVIEW_EXISTS" }, { status: 409, headers });
    return Response.json({ error: "TIMELINE_WRITE_FAILED" }, { status: 500, headers });
  }
}

