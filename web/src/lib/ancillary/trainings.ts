import { randomUUID } from "node:crypto";

import { trainingAttestationText } from "./config.ts";
import {
  createSupabaseAncillaryRepository,
  type AncillaryRepository,
  type Training,
  type TrainingAudience,
  type TrainingSourceFile,
} from "./repository.ts";
import {
  TRAINING_SOURCE_MIME_TYPES,
  validateTrainingSource,
  type TrainingSourceInput,
  type TrainingSourceMimeType,
  type ValidatedTrainingSource,
} from "./training-source-contract.ts";
import {
  createSupabaseTrainingSourceStorage,
  type TrainingSourceStorage,
} from "./training-source-storage.ts";
import { featureFlag, type EnvSource } from "@/lib/env";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIDEO_HOSTS = new Set(["youtube.com", "www.youtube.com", "youtu.be", "vimeo.com", "www.vimeo.com", "loom.com", "www.loom.com"]);

export interface TrainingActor { id: string; role: "platform_admin" | "operator_member" | "consumer" | "affiliate"; orgId: string | null }
export interface TrainingInput { audience: TrainingAudience; title: string; videoUrl: string; body: string }
export const TRAINING_TAKEDOWN_REASON_MAX = 1000;
export type PublicTrainingSourceFile = Readonly<Omit<TrainingSourceFile, "objectPath">>;
export type TrainingResponse = Readonly<Omit<Training, "sourceFile"> & {
  sourceFile: PublicTrainingSourceFile | null;
}>;

interface TrainingSourceDependencies {
  id(): string;
  now(): Date;
  storage: TrainingSourceStorage;
}

function fail(code: string): never { throw new Error(code); }
function clean(value: string, max: number, code: string): string {
  const result = value.trim();
  if (!result || result.length > max) fail(code);
  return result;
}
function input(value: TrainingInput): TrainingInput {
  if (value.audience !== "client" && value.audience !== "operator") fail("TRAINING_AUDIENCE_INVALID");
  const videoUrl = clean(value.videoUrl, 2048, "TRAINING_VIDEO_INVALID");
  try {
    const parsed = new URL(videoUrl);
    if (parsed.protocol !== "https:" || !VIDEO_HOSTS.has(parsed.hostname.toLowerCase())) fail("TRAINING_VIDEO_INVALID");
  } catch { fail("TRAINING_VIDEO_INVALID"); }
  return { audience: value.audience, title: clean(value.title, 200, "TRAINING_TITLE_INVALID"), videoUrl, body: clean(value.body, 20_000, "TRAINING_BODY_INVALID") };
}
function mutationActor(actor: TrainingActor): void {
  if (!UUID.test(actor.id) || (actor.role !== "platform_admin" && actor.role !== "operator_member")) fail("TRAINING_FORBIDDEN");
  if (actor.role === "operator_member" && (!actor.orgId || !UUID.test(actor.orgId))) fail("TRAINING_FORBIDDEN");
}
function owns(actor: TrainingActor, row: Training): boolean {
  return actor.role === "platform_admin" || (actor.role === "operator_member" && row.source === "operator" && row.orgId === actor.orgId);
}

function sourceDependencies(overrides: Partial<TrainingSourceDependencies>): TrainingSourceDependencies {
  return {
    id: randomUUID,
    now: () => new Date(),
    storage: createSupabaseTrainingSourceStorage(),
    ...overrides,
  };
}

function sourceObjectPath(trainingId: string): string {
  return `${trainingId}/source`;
}

function sourceMetadata(
  trainingId: string,
  source: ValidatedTrainingSource,
  uploadedAt: string,
): TrainingSourceFile {
  return {
    fileName: source.fileName,
    mimeType: source.mimeType,
    objectPath: sourceObjectPath(trainingId),
    sizeBytes: source.sizeBytes,
    uploadedAt,
  };
}

function sourceMatches(row: Training | null, expected: TrainingSourceFile): row is Training {
  const actual = row?.sourceFile;
  return actual !== null && actual !== undefined
    && actual.fileName === expected.fileName
    && actual.mimeType === expected.mimeType
    && actual.objectPath === expected.objectPath
    && actual.sizeBytes === expected.sizeBytes
    && Number.isFinite(Date.parse(actual.uploadedAt));
}

function storedMimeType(sourceFile: TrainingSourceFile): TrainingSourceMimeType {
  if (!TRAINING_SOURCE_MIME_TYPES.includes(sourceFile.mimeType as TrainingSourceMimeType)) {
    fail("TRAINING_SOURCE_READ_FAILED");
  }
  return sourceFile.mimeType as TrainingSourceMimeType;
}

async function removeAndVerify(storage: TrainingSourceStorage, objectPath: string): Promise<void> {
  try { await storage.remove(objectPath); } catch { /* absence below is authoritative */ }
  let present: boolean;
  try { present = await storage.exists(objectPath); } catch { fail("TRAINING_SOURCE_VERIFY_FAILED"); }
  if (present) fail("TRAINING_SOURCE_DELETE_FAILED");
}

async function confirmSource(
  repository: AncillaryRepository,
  storage: TrainingSourceStorage,
  trainingId: string,
  expected: TrainingSourceFile,
): Promise<Training> {
  const row = await repository.getTraining(trainingId);
  if (!sourceMatches(row, expected) || !(await storage.exists(expected.objectPath))) {
    fail("TRAINING_SOURCE_READBACK_FAILED");
  }
  return row;
}

export function trainingResponse(row: Training, includeSourceFile: boolean): TrainingResponse {
  const { sourceFile, ...training } = row;
  return Object.freeze({
    ...training,
    sourceFile: includeSourceFile && sourceFile ? Object.freeze({
      fileName: sourceFile.fileName,
      mimeType: sourceFile.mimeType,
      sizeBytes: sourceFile.sizeBytes,
      uploadedAt: sourceFile.uploadedAt,
    }) : null,
  });
}

export async function listTrainings(actor: TrainingActor, repository: AncillaryRepository = createSupabaseAncillaryRepository()): Promise<Training[]> {
  const rows = await repository.listTrainings();
  if (actor.role === "platform_admin") return rows;
  if (!actor.orgId) return [];
  if (actor.role === "operator_member") return rows.filter((row) => row.source === "platform" || row.orgId === actor.orgId);
  if (actor.role === "consumer") return rows.filter((row) => row.orgId === actor.orgId && row.audience === "client" && row.published);
  return [];
}

export async function createTraining(
  actor: TrainingActor,
  value: TrainingInput,
  repository: AncillaryRepository = createSupabaseAncillaryRepository(),
  source?: TrainingSourceInput,
  sourceOverrides: Partial<TrainingSourceDependencies> = {},
): Promise<Training> {
  mutationActor(actor);
  const checked = input(value);
  if (actor.role === "platform_admin") {
    if (!source) fail("TRAINING_SOURCE_REQUIRED");
    const validated = validateTrainingSource(source);
    const dependencies = sourceDependencies(sourceOverrides);
    const trainingId = dependencies.id();
    if (!UUID.test(trainingId)) fail("TRAINING_ID_INVALID");
    const uploadedAt = dependencies.now().toISOString();
    if (!Number.isFinite(Date.parse(uploadedAt))) fail("TRAINING_SOURCE_INVALID");
    const metadata = sourceMetadata(trainingId, validated, uploadedAt);
    try {
      await dependencies.storage.store(metadata.objectPath, validated.bytes, validated.mimeType);
      await repository.createTraining({
        ...checked,
        createdBy: actor.id,
        id: trainingId,
        orgId: null,
        source: "platform",
        sourceFile: metadata,
      });
      return await confirmSource(repository, dependencies.storage, trainingId, metadata);
    } catch {
      await repository.deleteTraining(trainingId).catch(() => undefined);
      await removeAndVerify(dependencies.storage, metadata.objectPath).catch(() => undefined);
      fail("TRAINING_SOURCE_WRITE_FAILED");
    }
  }
  return repository.createTraining({ ...checked, orgId: actor.orgId, source: "operator", createdBy: actor.id });
}

export async function updateTraining(actor: TrainingActor, id: string, value: TrainingInput, repository: AncillaryRepository = createSupabaseAncillaryRepository(), env: EnvSource = process.env): Promise<Training> {
  mutationActor(actor); if (!UUID.test(id)) fail("TRAINING_ID_INVALID");
  const existing = (await repository.listTrainings()).find((row) => row.id === id);
  if (!existing || !owns(actor, existing)) fail("TRAINING_NOT_FOUND");
  const checked = input(value);
  return featureFlag("FEATURE_CONSOLE_OPS", env)
    ? repository.updateTrainingWithReattestation(id, actor.id, checked)
    : repository.updateTraining(id, checked);
}

export async function updatePlatformTrainingWithSource(
  actor: TrainingActor,
  id: string,
  value: TrainingInput,
  source: TrainingSourceInput,
  repository: AncillaryRepository = createSupabaseAncillaryRepository(),
  sourceOverrides: Partial<TrainingSourceDependencies> = {},
): Promise<Training> {
  mutationActor(actor);
  if (actor.role !== "platform_admin") fail("TRAINING_FORBIDDEN");
  if (!UUID.test(id)) fail("TRAINING_ID_INVALID");
  const existing = await repository.getTraining(id);
  if (!existing || existing.source !== "platform" || existing.orgId !== null) fail("TRAINING_NOT_FOUND");

  const checked = input(value);
  const validated = validateTrainingSource(source);
  const dependencies = sourceDependencies(sourceOverrides);
  const metadata = sourceMetadata(id, validated, dependencies.now().toISOString());
  const previous = existing.sourceFile;
  let previousBytes: Uint8Array | null = null;
  let wrote = false;
  let metadataCommitted = false;

  try {
    if (previous) {
      if (previous.objectPath !== metadata.objectPath) fail("TRAINING_SOURCE_READ_FAILED");
      previousBytes = await dependencies.storage.download(previous.objectPath);
      await dependencies.storage.replace(metadata.objectPath, validated.bytes, validated.mimeType);
    } else {
      await dependencies.storage.store(metadata.objectPath, validated.bytes, validated.mimeType);
    }
    wrote = true;
    const updated = await repository.updatePlatformTrainingWithSource(id, actor.id, checked, metadata);
    metadataCommitted = true;
    const confirmed = await confirmSource(repository, dependencies.storage, id, {
      ...metadata,
      uploadedAt: updated.sourceFile?.uploadedAt ?? metadata.uploadedAt,
    });
    return confirmed;
  } catch {
    if (wrote && !metadataCommitted) {
      if (previous && previousBytes) {
        await dependencies.storage.replace(previous.objectPath, previousBytes, storedMimeType(previous)).catch(() => undefined);
      } else {
        await removeAndVerify(dependencies.storage, metadata.objectPath).catch(() => undefined);
      }
    }
    fail("TRAINING_SOURCE_WRITE_FAILED");
  }
}

export async function deleteTraining(
  actor: TrainingActor,
  id: string,
  repository: AncillaryRepository = createSupabaseAncillaryRepository(),
  sourceOverrides: Partial<TrainingSourceDependencies> = {},
): Promise<void> {
  mutationActor(actor); if (!UUID.test(id)) fail("TRAINING_ID_INVALID");
  const row = (await repository.listTrainings()).find((item) => item.id === id);
  if (!row || !owns(actor, row)) fail("TRAINING_NOT_FOUND");
  if (row.published) fail("TRAINING_PUBLISHED");
  if (row.source === "platform") {
    if (actor.role !== "platform_admin") fail("TRAINING_NOT_FOUND");
    if (!row.sourceFile) {
      await repository.deleteTraining(id);
      if (await repository.getTraining(id)) fail("TRAINING_DELETE_READBACK_FAILED");
      return;
    }
    const dependencies = sourceDependencies(sourceOverrides);
    const previousBytes = await dependencies.storage.download(row.sourceFile.objectPath)
      .catch(() => fail("TRAINING_SOURCE_DELETE_FAILED"));
    let rowDeleted = false;
    try {
      await removeAndVerify(dependencies.storage, row.sourceFile.objectPath);
      await repository.deleteTraining(id);
      rowDeleted = true;
      if (await repository.getTraining(id)) {
        rowDeleted = false;
        fail("TRAINING_DELETE_READBACK_FAILED");
      }
      return;
    } catch {
      if (!rowDeleted) {
        await dependencies.storage.store(
          row.sourceFile.objectPath,
          previousBytes,
          storedMimeType(row.sourceFile),
        ).catch(() => undefined);
      }
      fail("TRAINING_SOURCE_DELETE_FAILED");
    }
  }
  await repository.deleteTraining(id);
}

export async function downloadPlatformTrainingSource(
  actor: TrainingActor,
  id: string,
  repository: AncillaryRepository = createSupabaseAncillaryRepository(),
  storage: TrainingSourceStorage = createSupabaseTrainingSourceStorage(),
): Promise<{ bytes: Uint8Array; fileName: string; mimeType: string }> {
  if (actor.role !== "platform_admin" || !UUID.test(actor.id)) fail("TRAINING_FORBIDDEN");
  if (!UUID.test(id)) fail("TRAINING_ID_INVALID");
  const row = await repository.getTraining(id);
  if (!row || row.source !== "platform" || row.orgId !== null || !row.sourceFile) fail("TRAINING_NOT_FOUND");
  if (row.sourceFile.objectPath !== sourceObjectPath(row.id)) fail("TRAINING_NOT_FOUND");
  try {
    return {
      bytes: await storage.download(row.sourceFile.objectPath),
      fileName: row.sourceFile.fileName,
      mimeType: row.sourceFile.mimeType,
    };
  } catch {
    fail("TRAINING_SOURCE_DOWNLOAD_FAILED");
  }
}

export async function publishTraining(actor: TrainingActor, id: string, attested: boolean, env: EnvSource = process.env, repository: AncillaryRepository = createSupabaseAncillaryRepository()): Promise<Training> {
  mutationActor(actor); if (!UUID.test(id)) fail("TRAINING_ID_INVALID");
  const copy = trainingAttestationText(env);
  if (!attested || copy === null) fail("TRAINING_ATTESTATION_REQUIRED");
  const existing = (await repository.listTrainings()).find((row) => row.id === id);
  if (!existing || !owns(actor, existing)) fail("TRAINING_NOT_FOUND");
  if (existing.source === "platform" && !existing.sourceFile) fail("TRAINING_SOURCE_REQUIRED");
  return repository.publishTraining(id, actor.id, copy);
}

export async function unpublishTraining(actor: TrainingActor, id: string, reason?: string, repository: AncillaryRepository = createSupabaseAncillaryRepository()): Promise<Training> {
  mutationActor(actor); if (!UUID.test(id)) fail("TRAINING_ID_INVALID");
  const existing = (await repository.listTrainings()).find((row) => row.id === id);
  if (!existing || !owns(actor, existing)) fail("TRAINING_NOT_FOUND");
  let normalized: string | null = null;
  if (actor.role === "platform_admin") {
    normalized = typeof reason === "string" ? reason.trim() : "";
    if (!normalized || normalized.length > TRAINING_TAKEDOWN_REASON_MAX) fail("TRAINING_TAKEDOWN_REASON_REQUIRED");
  }
  return repository.unpublishTraining(id, actor.id, normalized);
}
