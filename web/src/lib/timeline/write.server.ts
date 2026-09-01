import "server-only";

interface WriteResult {
  readonly data: unknown;
  readonly error: { readonly message?: string } | null;
}

interface WriteBuilder extends PromiseLike<WriteResult> {
  select(columns: string): WriteBuilder;
  single(): Promise<WriteResult>;
}

interface AdminWriter {
  from(table: string): {
    insert(values: Record<string, unknown>): WriteBuilder;
  };
}

function row(result: WriteResult): Record<string, unknown> {
  if (result.error) throw new Error(result.error.message ?? "TIMELINE_WRITE_FAILED");
  if (result.data === null || typeof result.data !== "object" || Array.isArray(result.data)) {
    throw new Error("TIMELINE_WRITE_FAILED");
  }
  return result.data as Record<string, unknown>;
}

export async function createDocumentRequest(input: {
  readonly orgId: string;
  readonly clientId: string;
  readonly actorId: string;
  readonly name: string;
  readonly why: string;
}): Promise<Record<string, unknown>> {
  const { createAdminClient } = await import("../supabase/admin");
  const db = createAdminClient() as unknown as AdminWriter;
  return row(await db.from("document_requests").insert({
    org_id: input.orgId,
    client_id: input.clientId,
    requested_by: input.actorId,
    name: input.name,
    why: input.why,
  }).select("id, client_id, name, why, fulfilled_at, fulfilled_upload_id, created_at").single());
}

export async function recordDocumentReview(input: {
  readonly orgId: string;
  readonly uploadId: string;
  readonly actorId: string;
}): Promise<Record<string, unknown>> {
  const { createAdminClient } = await import("../supabase/admin");
  const db = createAdminClient() as unknown as AdminWriter;
  return row(await db.from("document_reviews").insert({
    org_id: input.orgId,
    upload_id: input.uploadId,
    reviewed_by: input.actorId,
  }).select("id, upload_id, reviewed_by, reviewed_at").single());
}

