"use client";

import {
  TRAINING_SOURCE_MAX_BYTES,
  TRAINING_SOURCE_MIME_TYPES,
} from "@/lib/ancillary/training-source-contract";

export type AdminTrainingAudience = "client" | "operator";
export type AdminTrainingSource = "operator" | "platform";

export type AdminTrainingSourceFile = Readonly<{
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
}>;

export type AdminTraining = Readonly<{
  attestationText: string | null;
  attested: boolean;
  attestedAt: string | null;
  audience: AdminTrainingAudience;
  body: string;
  createdAt: string;
  createdBy: string;
  id: string;
  orgId: string | null;
  published: boolean;
  publishedAt: string | null;
  publishedBy: string | null;
  source: AdminTrainingSource;
  sourceFile: AdminTrainingSourceFile | null;
  takedownReason: string | null;
  takenDownAt: string | null;
  takenDownBy: string | null;
  title: string;
  updatedAt: string;
  videoUrl: string;
}>;

export type AdminTrainingInput = Readonly<{
  audience: AdminTrainingAudience;
  body: string;
  title: string;
  videoUrl: string;
}>;

export type AdminTrainingCreateInput = AdminTrainingInput & Readonly<{
  sourceFile: File;
}>;

export type AdminTrainingUpdateInput = AdminTrainingInput & Readonly<{
  sourceFile?: File;
}>;

export type AdminTrainingConfig = Readonly<{
  attestationAvailable: boolean;
  attestationText: string | null;
  consoleOpsEnabled: boolean;
  enabled: boolean;
  platformTrainingsUrl: string | null;
}>;

export class AdminTrainingClientError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string) {
    super(code);
    this.name = "AdminTrainingClientError";
    this.code = code;
    this.status = status;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIDEO_HOSTS = new Set([
  "loom.com",
  "vimeo.com",
  "www.loom.com",
  "www.vimeo.com",
  "www.youtube.com",
  "youtu.be",
  "youtube.com",
]);
const TRAINING_KEYS = [
  "attestationText",
  "attested",
  "attestedAt",
  "audience",
  "body",
  "createdAt",
  "createdBy",
  "id",
  "orgId",
  "published",
  "publishedAt",
  "publishedBy",
  "source",
  "sourceFile",
  "takedownReason",
  "takenDownAt",
  "takenDownBy",
  "title",
  "updatedAt",
  "videoUrl",
] as const;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return record(value) && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function nullableText(value: unknown, max: number): value is string | null {
  return value === null || boundedText(value, max);
}

function instant(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function nullableInstant(value: unknown): value is string | null {
  return value === null || instant(value);
}

function nullableUuid(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && UUID.test(value));
}

function httpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function nullableHttpsUrl(value: unknown): value is string | null {
  return value === null || httpsUrl(value);
}

function hostedVideoUrl(value: unknown): value is string {
  if (!httpsUrl(value)) return false;
  return VIDEO_HOSTS.has(new URL(value).hostname.toLowerCase());
}

function sourceFile(value: unknown): value is AdminTrainingSourceFile | null {
  if (value === null) return true;
  if (!exactRecord(value, ["fileName", "mimeType", "sizeBytes", "uploadedAt"])
      || !boundedText(value.fileName, 120)
      || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:pdf|doc|docx|txt)$/.test(value.fileName)
      || typeof value.mimeType !== "string"
      || !TRAINING_SOURCE_MIME_TYPES.includes(value.mimeType as (typeof TRAINING_SOURCE_MIME_TYPES)[number])
      || typeof value.sizeBytes !== "number"
      || !Number.isSafeInteger(value.sizeBytes)
      || value.sizeBytes < 1
      || value.sizeBytes > TRAINING_SOURCE_MAX_BYTES
      || !instant(value.uploadedAt)) return false;
  const suffix = value.fileName.slice(value.fileName.lastIndexOf(".") + 1);
  return (value.mimeType === "application/pdf" && suffix === "pdf")
    || (value.mimeType === "application/msword" && suffix === "doc")
    || (value.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" && suffix === "docx")
    || (value.mimeType === "text/plain" && suffix === "txt");
}

export function parseAdminTraining(value: unknown): AdminTraining | null {
  if (!exactRecord(value, TRAINING_KEYS)
      || typeof value.id !== "string" || !UUID.test(value.id)
      || !nullableUuid(value.orgId)
      || (value.audience !== "client" && value.audience !== "operator")
      || (value.source !== "operator" && value.source !== "platform")
      || !sourceFile(value.sourceFile)
      || !boundedText(value.title, 200) || !hostedVideoUrl(value.videoUrl)
      || !boundedText(value.body, 20_000) || typeof value.published !== "boolean"
      || !nullableInstant(value.publishedAt) || !nullableUuid(value.publishedBy)
      || typeof value.attested !== "boolean" || !nullableInstant(value.attestedAt)
      || !nullableText(value.attestationText, 2000) || !nullableText(value.takedownReason, 1000)
      || !nullableUuid(value.takenDownBy) || !nullableInstant(value.takenDownAt)
      || typeof value.createdBy !== "string" || !UUID.test(value.createdBy)
      || !instant(value.createdAt) || !instant(value.updatedAt)) return null;
  if ((value.source === "platform") !== (value.orgId === null)) return null;
  if (value.source === "operator" && value.sourceFile !== null) return null;
  if (value.published && (!value.publishedAt || !value.publishedBy || !value.attested
      || !value.attestedAt || !value.attestationText)) return null;
  if ((value.takedownReason === null) !== (value.takenDownBy === null)
      || (value.takedownReason === null) !== (value.takenDownAt === null)) return null;
  return Object.freeze({
    attestationText: value.attestationText,
    attested: value.attested,
    attestedAt: value.attestedAt,
    audience: value.audience,
    body: value.body,
    createdAt: value.createdAt,
    createdBy: value.createdBy,
    id: value.id,
    orgId: value.orgId,
    published: value.published,
    publishedAt: value.publishedAt,
    publishedBy: value.publishedBy,
    source: value.source,
    sourceFile: value.sourceFile,
    takedownReason: value.takedownReason,
    takenDownAt: value.takenDownAt,
    takenDownBy: value.takenDownBy,
    title: value.title,
    updatedAt: value.updatedAt,
    videoUrl: value.videoUrl,
  });
}

export function parseAdminTrainingConfig(value: unknown): AdminTrainingConfig | null {
  if (!record(value) || typeof value.enabled !== "boolean"
      || typeof value.attestationAvailable !== "boolean"
      || !nullableHttpsUrl(value.platformTrainingsUrl)
      || !nullableHttpsUrl(value.northwestPartnerUrl)) return null;
  const allowed = value.enabled
    ? ["attestationAvailable", "attestationText", "consoleOpsEnabled", "enabled", "northwestPartnerUrl", "platformTrainingsUrl"]
    : ["attestationAvailable", "enabled", "northwestPartnerUrl", "platformTrainingsUrl"];
  const expected = value.enabled && value.attestationText === undefined
    ? allowed.filter((key) => key !== "attestationText")
    : allowed;
  if (!exactRecord(value, expected) || (value.enabled && typeof value.consoleOpsEnabled !== "boolean")) return null;
  if (!(value.attestationText === undefined || boundedText(value.attestationText, 2000))) return null;
  if (value.enabled && value.attestationAvailable !== boundedText(value.attestationText, 2000)) return null;
  return Object.freeze({
    attestationAvailable: value.attestationAvailable,
    attestationText: typeof value.attestationText === "string" ? value.attestationText : null,
    consoleOpsEnabled: value.enabled ? value.consoleOpsEnabled as boolean : false,
    enabled: value.enabled,
    platformTrainingsUrl: value.platformTrainingsUrl,
  });
}

async function errorFor(response: Response): Promise<AdminTrainingClientError> {
  let code = `training_http_${response.status}`;
  try {
    const value: unknown = await response.json();
    if (record(value) && typeof value.error === "string" && value.error.trim()) code = value.error;
  } catch {
    // A non-JSON failure still retains its status-specific fallback code.
  }
  return new AdminTrainingClientError(response.status, code);
}

async function requestJson(path: string, init: RequestInit, fetcher: typeof fetch): Promise<unknown> {
  const response = await fetcher(path, { ...init, cache: "no-store", credentials: "same-origin" });
  if (!response.ok) throw await errorFor(response);
  try {
    return await response.json();
  } catch {
    throw new AdminTrainingClientError(response.status, "training_response_invalid");
  }
}

async function requestTrainingMutation(
  path: string,
  init: RequestInit,
  expectedStatus: number,
  fetcher: typeof fetch,
): Promise<AdminTraining> {
  const response = await fetcher(path, { ...init, cache: "no-store", credentials: "same-origin" });
  if (!response.ok) throw await errorFor(response);
  if (response.status !== expectedStatus) {
    throw new AdminTrainingClientError(response.status, "training_response_invalid");
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new AdminTrainingClientError(response.status, "training_response_invalid");
  }
  const training = parseAdminTraining(value);
  if (training === null) {
    throw new AdminTrainingClientError(response.status, "training_response_invalid");
  }
  return training;
}

export async function loadAdminTrainingConfig(fetcher: typeof fetch = fetch): Promise<AdminTrainingConfig> {
  const value = await requestJson("/api/trainings/config", {}, fetcher);
  const config = parseAdminTrainingConfig(value);
  if (config === null) throw new AdminTrainingClientError(200, "training_config_invalid");
  return config;
}

export async function loadAdminTrainings(fetcher: typeof fetch = fetch): Promise<readonly AdminTraining[]> {
  const value = await requestJson("/api/trainings", {}, fetcher);
  if (!exactRecord(value, ["trainings"]) || !Array.isArray(value.trainings)) {
    throw new AdminTrainingClientError(200, "training_response_invalid");
  }
  const trainings = value.trainings.map(parseAdminTraining);
  if (trainings.some((training) => training === null)) {
    throw new AdminTrainingClientError(200, "training_response_invalid");
  }
  return Object.freeze(trainings as AdminTraining[]);
}

export async function createAdminTraining(
  input: AdminTrainingCreateInput,
  fetcher: typeof fetch = fetch,
): Promise<AdminTraining> {
  const form = trainingForm(input, input.sourceFile);
  return requestTrainingMutation("/api/trainings", {
    body: form,
    method: "POST",
  }, 201, fetcher);
}

export async function updateAdminTraining(
  id: string,
  input: AdminTrainingUpdateInput,
  fetcher: typeof fetch = fetch,
): Promise<AdminTraining> {
  const form = trainingForm(input, input.sourceFile);
  return requestTrainingMutation(`/api/trainings/${encodeURIComponent(id)}`, {
    body: form,
    method: "PATCH",
  }, 200, fetcher);
}

function trainingForm(input: AdminTrainingInput, source: File | undefined): FormData {
  const form = new FormData();
  form.set("audience", input.audience);
  form.set("body", input.body);
  form.set("title", input.title);
  form.set("videoUrl", input.videoUrl);
  if (source) form.set("sourceFile", source);
  return form;
}

export function adminTrainingSourcePath(id: string): string {
  if (!UUID.test(id)) throw new AdminTrainingClientError(400, "training_id_invalid");
  return `/api/trainings/${encodeURIComponent(id)}/source`;
}

export async function publishAdminTraining(
  id: string,
  fetcher: typeof fetch = fetch,
): Promise<AdminTraining> {
  return requestTrainingMutation(`/api/trainings/${encodeURIComponent(id)}/publication`, {
    body: JSON.stringify({ attested: true }),
    headers: { "content-type": "application/json" },
    method: "POST",
  }, 200, fetcher);
}

export async function unpublishAdminTraining(
  id: string,
  reason: string,
  fetcher: typeof fetch = fetch,
): Promise<AdminTraining> {
  return requestTrainingMutation(`/api/trainings/${encodeURIComponent(id)}/publication`, {
    body: JSON.stringify({ reason }),
    headers: { "content-type": "application/json" },
    method: "DELETE",
  }, 200, fetcher);
}

export async function deleteAdminTraining(id: string, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher(`/api/trainings/${encodeURIComponent(id)}`, {
    cache: "no-store",
    credentials: "same-origin",
    method: "DELETE",
  });
  if (!response.ok) throw await errorFor(response);
  if (response.status !== 204) throw new AdminTrainingClientError(response.status, "training_response_invalid");
}
