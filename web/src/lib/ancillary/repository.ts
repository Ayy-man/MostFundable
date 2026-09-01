import "server-only";
import { randomUUID } from "node:crypto";

export type TrainingAudience = "client" | "operator";
export type TrainingSource = "operator" | "platform";

export interface TrainingSourceFile {
  fileName: string;
  mimeType: string;
  objectPath: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface Training {
  id: string;
  orgId: string | null;
  audience: TrainingAudience;
  source: TrainingSource;
  sourceFile: TrainingSourceFile | null;
  title: string;
  videoUrl: string;
  body: string;
  published: boolean;
  publishedAt: string | null;
  publishedBy: string | null;
  attested: boolean;
  attestedAt: string | null;
  attestationText: string | null;
  takedownReason: string | null;
  takenDownBy: string | null;
  takenDownAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TrainingWrite {
  id?: string;
  orgId: string | null;
  audience: TrainingAudience;
  source: TrainingSource;
  title: string;
  videoUrl: string;
  body: string;
  createdBy: string;
  sourceFile?: TrainingSourceFile;
}

export interface PullCap {
  clientId: string;
  orgId: string;
  minIntervalSeconds: number | null;
  maxCount: number | null;
  countWindowSeconds: number | null;
  updatedBy: string;
  updatedAt: string;
}

export interface ExportPageRequest {
  table: string;
  columns: string;
  order: string;
  filters: Readonly<Record<string, string>>;
  offset: number;
  limit: number;
}

export interface AncillaryRepository {
  listTrainings(): Promise<Training[]>;
  getTraining(id: string): Promise<Training | null>;
  createTraining(input: TrainingWrite): Promise<Training>;
  updateTraining(id: string, input: Pick<TrainingWrite, "audience" | "title" | "videoUrl" | "body">): Promise<Training>;
  updateTrainingWithReattestation(id: string, actorId: string, input: Pick<TrainingWrite, "audience" | "title" | "videoUrl" | "body">): Promise<Training>;
  updatePlatformTrainingWithSource(
    id: string,
    actorId: string,
    input: Pick<TrainingWrite, "audience" | "title" | "videoUrl" | "body">,
    sourceFile: Pick<TrainingSourceFile, "fileName" | "mimeType" | "sizeBytes">,
  ): Promise<Training>;
  deleteTraining(id: string): Promise<void>;
  publishTraining(id: string, actorId: string, attestationText: string): Promise<Training>;
  unpublishTraining(id: string, actorId: string, reason: string | null): Promise<Training>;
  getPullCap(clientId: string): Promise<PullCap | null>;
  setPullCap(input: Omit<PullCap, "orgId" | "updatedAt">): Promise<PullCap>;
  clearPullCap(clientId: string, actorId: string): Promise<boolean>;
  assertPullAllowed(clientId: string, cause: string, sourceId: string): Promise<{ allowed: boolean; reason: string | null }>;
  readExportPage(request: ExportPageRequest): Promise<Record<string, unknown>[]>;
  auditExport(input: { actorId: string; dataset: string; format: string; filters: Readonly<Record<string, string>>; rowCount: number; status: "complete" | "partial" }): Promise<void>;
}

interface Result<T> { data: T | null; error: { code?: string } | null }
interface Query<T> extends PromiseLike<Result<T[]>> {
  eq(column: string, value: unknown): Query<T>;
  order(column: string, options: { ascending: boolean }): Query<T>;
  range(from: number, to: number): Query<T>;
  maybeSingle(): PromiseLike<Result<T>>;
}
interface Table<T> {
  select(columns: string): Query<T>;
  insert(values: Record<string, unknown>): { select(columns: string): Query<T> };
  update(values: Record<string, unknown>): { eq(column: string, value: unknown): { select(columns: string): Query<T> } };
  delete(): { eq(column: string, value: unknown): PromiseLike<Result<unknown>> };
}
interface Db {
  from<T>(table: string): Table<T>;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<Result<unknown>>;
}

interface TrainingRow {
  id: string; org_id: string | null; audience: TrainingAudience; source: TrainingSource;
  title: string; video_url: string; body: string; published: boolean;
  published_at: string | null; published_by: string | null; attested: boolean;
  attested_at: string | null; attestation_text: string | null;
  takedown_reason: string | null; taken_down_by: string | null; taken_down_at: string | null;
  source_object_path: string | null; source_file_name: string | null; source_mime_type: string | null;
  source_size_bytes: number | null; source_uploaded_at: string | null;
  created_by: string; created_at: string; updated_at: string;
}
interface PullCapRow {
  client_id: string; org_id: string; min_interval_seconds: number | null;
  max_count: number | null; count_window_seconds: number | null;
  updated_by: string; updated_at: string;
}

const TRAINING_COLUMNS = "id,org_id,audience,source,title,video_url,body,published,published_at,published_by,attested,attested_at,attestation_text,takedown_reason,taken_down_by,taken_down_at,source_object_path,source_file_name,source_mime_type,source_size_bytes,source_uploaded_at,created_by,created_at,updated_at";
const CAP_COLUMNS = "client_id,org_id,min_interval_seconds,max_count,count_window_seconds,updated_by,updated_at";

function training(row: TrainingRow): Training {
  const sourceValues = [row.source_object_path, row.source_file_name, row.source_mime_type,
    row.source_size_bytes, row.source_uploaded_at];
  const sourceCount = sourceValues.filter((value) => value !== null).length;
  if (sourceCount !== 0 && sourceCount !== sourceValues.length) throw new Error("TRAINING_READ_FAILED");
  const sourceFile = sourceCount === 0 ? null : {
    fileName: row.source_file_name as string,
    mimeType: row.source_mime_type as string,
    objectPath: row.source_object_path as string,
    sizeBytes: row.source_size_bytes as number,
    uploadedAt: row.source_uploaded_at as string,
  };
  return { id: row.id, orgId: row.org_id, audience: row.audience, source: row.source,
    sourceFile,
    title: row.title, videoUrl: row.video_url, body: row.body, published: row.published,
    publishedAt: row.published_at, publishedBy: row.published_by, attested: row.attested,
    attestedAt: row.attested_at, attestationText: row.attestation_text,
    takedownReason: row.takedown_reason, takenDownBy: row.taken_down_by, takenDownAt: row.taken_down_at,
    createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at };
}
function cap(row: PullCapRow): PullCap {
  return { clientId: row.client_id, orgId: row.org_id, minIntervalSeconds: row.min_interval_seconds,
    maxCount: row.max_count, countWindowSeconds: row.count_window_seconds,
    updatedBy: row.updated_by, updatedAt: row.updated_at };
}
function one<T>(result: Result<T[]>, code: string): T {
  if (result.error || !result.data || result.data.length !== 1) throw new Error(code);
  return result.data[0];
}
async function admin(): Promise<Db> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient() as unknown as Db;
}

export function createSupabaseAncillaryRepository(): AncillaryRepository {
  return {
    async listTrainings() {
      const result = await (await admin()).from<TrainingRow>("trainings").select(TRAINING_COLUMNS).order("updated_at", { ascending: false });
      if (result.error || !result.data) throw new Error("TRAINING_READ_FAILED");
      return result.data.map(training);
    },
    async getTraining(id) {
      const result = await (await admin()).from<TrainingRow>("trainings").select(TRAINING_COLUMNS).eq("id", id).maybeSingle();
      if (result.error) throw new Error("TRAINING_READ_FAILED");
      return result.data ? training(result.data) : null;
    },
    async createTraining(input) {
      const result = await (await admin()).from<TrainingRow>("trainings").insert({
        ...(input.id ? { id: input.id } : {}),
        org_id: input.orgId, audience: input.audience, source: input.source, title: input.title,
        video_url: input.videoUrl, body: input.body, created_by: input.createdBy,
        ...(input.sourceFile ? {
          source_file_name: input.sourceFile.fileName,
          source_mime_type: input.sourceFile.mimeType,
          source_object_path: input.sourceFile.objectPath,
          source_size_bytes: input.sourceFile.sizeBytes,
          source_uploaded_at: input.sourceFile.uploadedAt,
        } : {}),
      }).select(TRAINING_COLUMNS);
      return training(one(result, "TRAINING_WRITE_FAILED"));
    },
    async updateTraining(id, input) {
      const result = await (await admin()).from<TrainingRow>("trainings").update({
        audience: input.audience, title: input.title, video_url: input.videoUrl, body: input.body,
      }).eq("id", id).select(TRAINING_COLUMNS);
      return training(one(result, "TRAINING_WRITE_FAILED"));
    },
    async updateTrainingWithReattestation(id, actorId, input) {
      const result = await (await admin()).rpc("update_training", {
        p_id: id, p_actor: actorId, p_audience: input.audience, p_title: input.title,
        p_video_url: input.videoUrl, p_body: input.body,
      }) as Result<TrainingRow[]>;
      return training(one(result, "TRAINING_WRITE_FAILED"));
    },
    async updatePlatformTrainingWithSource(id, actorId, input, sourceFile) {
      const result = await (await admin()).rpc("update_platform_training", {
        p_actor: actorId,
        p_audience: input.audience,
        p_body: input.body,
        p_id: id,
        p_source_file_name: sourceFile.fileName,
        p_source_mime_type: sourceFile.mimeType,
        p_source_size_bytes: sourceFile.sizeBytes,
        p_title: input.title,
        p_video_url: input.videoUrl,
      }) as Result<TrainingRow[]>;
      return training(one(result, "TRAINING_WRITE_FAILED"));
    },
    async deleteTraining(id) {
      const result = await (await admin()).from("trainings").delete().eq("id", id);
      if (result.error) throw new Error("TRAINING_WRITE_FAILED");
    },
    async publishTraining(id, actorId, attestationText) {
      const result = await (await admin()).rpc("publish_training", { p_id: id, p_actor: actorId, p_attested: true, p_attestation_text: attestationText }) as Result<TrainingRow[]>;
      return training(one(result, "TRAINING_PUBLISH_FAILED"));
    },
    async unpublishTraining(id, actorId, reason) {
      const result = await (await admin()).rpc("unpublish_training", { p_id: id, p_actor: actorId, p_reason: reason }) as Result<TrainingRow[]>;
      return training(one(result, "TRAINING_PUBLISH_FAILED"));
    },
    async getPullCap(clientId) {
      const result = await (await admin()).from<PullCapRow>("pull_caps").select(CAP_COLUMNS).eq("client_id", clientId).maybeSingle();
      if (result.error) throw new Error("PULL_CAP_READ_FAILED");
      return result.data ? cap(result.data) : null;
    },
    async setPullCap(input) {
      const result = await (await admin()).rpc("set_pull_cap", {
        p_client_id: input.clientId, p_min_interval_seconds: input.minIntervalSeconds,
        p_max_count: input.maxCount, p_count_window_seconds: input.countWindowSeconds,
        p_actor: input.updatedBy,
      }) as Result<PullCapRow[]>;
      return cap(one(result, "PULL_CAP_WRITE_FAILED"));
    },
    async clearPullCap(clientId, actorId) {
      const result = await (await admin()).rpc("clear_pull_cap", { p_client_id: clientId, p_actor: actorId }) as Result<boolean>;
      if (result.error || result.data === null) throw new Error("PULL_CAP_WRITE_FAILED");
      return result.data;
    },
    async assertPullAllowed(clientId, cause, sourceId) {
      const result = await (await admin()).rpc("assert_pull_allowed", { p_client_id: clientId, p_cause: cause, p_source_id: sourceId }) as Result<Array<{ allowed: boolean; reason: string | null }>>;
      return one(result, "PULL_CAP_CHECK_FAILED");
    },
    async readExportPage(request) {
      let query = (await admin()).from<Record<string, unknown>>(request.table).select(request.columns);
      for (const [key, value] of Object.entries(request.filters)) query = query.eq(key, value);
      const result = await query.order(request.order, { ascending: true }).range(request.offset, request.offset + request.limit - 1);
      if (result.error || !result.data) throw new Error("EXPORT_READ_FAILED");
      return result.data;
    },
    async auditExport(input) {
      const result = await (await admin()).from("audit_log").insert({
        actor_profile_id: input.actorId, action: "export.completed", subject_type: "derived_export",
        subject_id: randomUUID(),
        meta: { dataset: input.dataset, format: input.format, filters: input.filters, row_count: input.rowCount, status: input.status },
      }).select("id");
      if (result.error) throw new Error("EXPORT_AUDIT_FAILED");
    },
  };
}
