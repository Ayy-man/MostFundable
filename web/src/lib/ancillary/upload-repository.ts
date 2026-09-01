import "server-only";

import type { DerivedFeatures } from "@/lib/analysis/features";

export type DocumentSection = "articles" | "ein" | "tax_returns" | "bank_statements" | "other";
export type UploadKind = "company" | "credit_report";
export type UploadLifecycle = "pending" | "stored" | "parsed" | "delete_pending" | "purged" | "failed";
export interface UploadedDocument {
  id: string; orgId: string; clientId: string; kind: UploadKind; section: DocumentSection | null;
  bucket: "client-documents" | "credit-reports"; objectPath: string; displayName: string;
  mimeType: string; sizeBytes: number; lifecycle: UploadLifecycle;
  derivedFeatures: DerivedFeatures | null; uploadedBy: string; createdAt: string; updatedAt: string;
  purgedAt: string | null; failureCode: string | null;
}
export interface CreateUploadMetadata {
  id: string; orgId: string; clientId: string; kind: UploadKind; section: DocumentSection | null;
  bucket: UploadedDocument["bucket"]; objectPath: string; displayName: string; mimeType: string;
  sizeBytes: number; uploadedBy: string;
}
export interface UploadRepository {
  create(input: CreateUploadMetadata): Promise<UploadedDocument>;
  update(id: string, changes: { lifecycle: UploadLifecycle; derivedFeatures?: DerivedFeatures | null; failureCode?: string | null; purgedAt?: string | null }): Promise<UploadedDocument>;
  get(id: string): Promise<UploadedDocument | null>;
  list(clientId: string, kind?: UploadKind): Promise<UploadedDocument[]>;
  listPurgeTargets(staleBefore: string): Promise<UploadedDocument[]>;
  deleteRow(id: string): Promise<void>;
  store(bucket: UploadedDocument["bucket"], objectPath: string, bytes: Uint8Array, mimeType: string): Promise<void>;
  download(bucket: UploadedDocument["bucket"], objectPath: string): Promise<Uint8Array>;
  remove(bucket: UploadedDocument["bucket"], objectPath: string): Promise<void>;
  exists(bucket: UploadedDocument["bucket"], objectPath: string): Promise<boolean>;
  markPurgedAndEnqueue(id: string): Promise<UploadedDocument>;
}

interface DbResult<T> { data: T | null; error: unknown }
interface Query<T> extends PromiseLike<DbResult<T[]>> {
  eq(column: string, value: unknown): Query<T>;
  lt(column: string, value: unknown): Query<T>;
  order(column: string, options: { ascending: boolean }): Query<T>;
  maybeSingle(): PromiseLike<DbResult<T>>;
}
interface Db {
  rpc(name: string, args: Record<string, unknown>): Promise<DbResult<boolean>>;
  from<T>(table: string): {
    select(columns: string): Query<T>;
    insert(values: Record<string, unknown>): { select(columns: string): Query<T> };
    update(values: Record<string, unknown>): { eq(column: string, value: unknown): { select(columns: string): Query<T> } };
    delete(): { eq(column: string, value: unknown): PromiseLike<DbResult<unknown>> };
  };
  storage: { from(bucket: string): {
    upload(path: string, data: Uint8Array, options: { contentType: string; upsert: boolean }): Promise<DbResult<unknown>>;
    download(path: string): Promise<DbResult<Blob>>;
    remove(paths: string[]): Promise<DbResult<unknown>>;
    list(path: string, options: { search: string; limit: number }): Promise<DbResult<Array<{ name: string }>>>;
  } };
}
interface Row {
  id: string; org_id: string; client_id: string; kind: UploadKind; section: DocumentSection | null;
  bucket: UploadedDocument["bucket"]; object_path: string; display_name: string; mime_type: string;
  size_bytes: number; lifecycle: UploadLifecycle; derived_features: DerivedFeatures | null;
  uploaded_by: string; created_at: string; updated_at: string; purged_at: string | null; failure_code: string | null;
}
const COLUMNS = "id,org_id,client_id,kind,section,bucket,object_path,display_name,mime_type,size_bytes,lifecycle,derived_features,uploaded_by,created_at,updated_at,purged_at,failure_code";
function map(row: Row): UploadedDocument {
  return { id: row.id, orgId: row.org_id, clientId: row.client_id, kind: row.kind, section: row.section,
    bucket: row.bucket, objectPath: row.object_path, displayName: row.display_name, mimeType: row.mime_type,
    sizeBytes: row.size_bytes, lifecycle: row.lifecycle, derivedFeatures: row.derived_features,
    uploadedBy: row.uploaded_by, createdAt: row.created_at, updatedAt: row.updated_at,
    purgedAt: row.purged_at, failureCode: row.failure_code };
}
function one(result: DbResult<Row[]>, code: string): UploadedDocument {
  if (result.error || !result.data || result.data.length !== 1) throw new Error(code);
  return map(result.data[0]);
}
async function client(): Promise<Db> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient() as unknown as Db;
}
export function createSupabaseUploadRepository(): UploadRepository {
  return {
    async create(input) {
      const values = { id: input.id, org_id: input.orgId, client_id: input.clientId, kind: input.kind,
        section: input.section, bucket: input.bucket, object_path: input.objectPath, display_name: input.displayName,
        mime_type: input.mimeType, size_bytes: input.sizeBytes, uploaded_by: input.uploadedBy };
      return one(await (await client()).from<Row>("document_uploads").insert(values).select(COLUMNS), "UPLOAD_CREATE_FAILED");
    },
    async update(id, changes) {
      const values: Record<string, unknown> = { lifecycle: changes.lifecycle, updated_at: new Date().toISOString() };
      if ("derivedFeatures" in changes) values.derived_features = changes.derivedFeatures;
      if ("failureCode" in changes) values.failure_code = changes.failureCode;
      if ("purgedAt" in changes) values.purged_at = changes.purgedAt;
      return one(await (await client()).from<Row>("document_uploads").update(values).eq("id", id).select(COLUMNS), "UPLOAD_UPDATE_FAILED");
    },
    async get(id) {
      const result = await (await client()).from<Row>("document_uploads").select(COLUMNS).eq("id", id).maybeSingle();
      if (result.error) throw new Error("UPLOAD_READ_FAILED");
      return result.data ? map(result.data) : null;
    },
    async list(clientId, kind) {
      let query = (await client()).from<Row>("document_uploads").select(COLUMNS).eq("client_id", clientId);
      if (kind) query = query.eq("kind", kind);
      const result = await query.order("created_at", { ascending: false });
      if (result.error || !result.data) throw new Error("UPLOAD_READ_FAILED");
      return result.data.map(map);
    },
    async listPurgeTargets(staleBefore) {
      const db = await client();
      const results = await Promise.all(["pending", "stored", "parsed", "delete_pending"].map((lifecycle) =>
        db.from<Row>("document_uploads").select(COLUMNS).eq("kind", "credit_report").eq("lifecycle", lifecycle)
          .lt("updated_at", staleBefore).order("updated_at", { ascending: true })));
      if (results.some((result) => result.error || !result.data)) throw new Error("UPLOAD_READ_FAILED");
      return results.flatMap((result) => result.data ?? []).map(map).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    },
    async deleteRow(id) { const result = await (await client()).from("document_uploads").delete().eq("id", id); if (result.error) throw new Error("UPLOAD_DELETE_FAILED"); },
    async store(bucket, objectPath, bytes, mimeType) { const result = await (await client()).storage.from(bucket).upload(objectPath, bytes, { contentType: mimeType, upsert: false }); if (result.error) throw new Error("UPLOAD_STORAGE_FAILED"); },
    async download(bucket, objectPath) { const result = await (await client()).storage.from(bucket).download(objectPath); if (result.error || !result.data) throw new Error("UPLOAD_DOWNLOAD_FAILED"); return new Uint8Array(await result.data.arrayBuffer()); },
    async remove(bucket, objectPath) { const result = await (await client()).storage.from(bucket).remove([objectPath]); if (result.error) throw new Error("UPLOAD_DELETE_FAILED"); },
    async exists(bucket, objectPath) {
      const slash = objectPath.lastIndexOf("/"); const folder = objectPath.slice(0, slash); const name = objectPath.slice(slash + 1);
      const result = await (await client()).storage.from(bucket).list(folder, { search: name, limit: 2 });
      if (result.error || !result.data) throw new Error("UPLOAD_VERIFY_FAILED");
      return result.data.some((item) => item.name === name);
    },
    async markPurgedAndEnqueue(id) {
      const db = await client();
      const result = await db.rpc("mark_purged_and_enqueue_analysis", { p_upload_id: id });
      if (result.error || result.data !== true) throw new Error("UPLOAD_PURGE_ENQUEUE_FAILED");
      const refreshed = await db.from<Row>("document_uploads").select(COLUMNS).eq("id", id).maybeSingle();
      if (refreshed.error || !refreshed.data) throw new Error("UPLOAD_READ_FAILED");
      return map(refreshed.data);
    },
  };
}
