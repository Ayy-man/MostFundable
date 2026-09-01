import { randomUUID } from "node:crypto";
import { recordMilestone } from "@/lib/enrollment/repository";
import { createSupabaseUploadRepository, type DocumentSection, type UploadedDocument, type UploadRepository } from "./upload-repository.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECTIONS: readonly DocumentSection[] = ["articles", "ein", "tax_returns", "bank_statements", "other"];
const MIMES = new Set(["application/pdf", "image/jpeg", "image/png", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
const MAX = 6 * 1024 * 1024;
export interface CompanyUploadInput { orgId: string; clientId: string; actorId: string; section: DocumentSection; fileName: string; mimeType: string; bytes: Uint8Array }
export interface CompanyUploadDependencies {
  repository: UploadRepository;
  milestone(clientId: string, kind: "documents_uploaded", actorId: string): Promise<void>;
  id(): string;
}
function safeName(value: string): string {
  const normalized = value.normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
  if (!normalized || normalized === "." || normalized === "..") throw new Error("UPLOAD_NAME_INVALID");
  return normalized;
}
function validate(input: CompanyUploadInput): string {
  if (![input.orgId, input.clientId, input.actorId].every((value) => UUID.test(value))) throw new Error("UPLOAD_SCOPE_INVALID");
  if (!SECTIONS.includes(input.section)) throw new Error("UPLOAD_SECTION_INVALID");
  if (!MIMES.has(input.mimeType)) throw new Error("UPLOAD_MIME_INVALID");
  if (input.bytes.byteLength < 1 || input.bytes.byteLength > MAX) throw new Error("UPLOAD_SIZE_INVALID");
  return safeName(input.fileName);
}
function productionDependencies(): CompanyUploadDependencies {
  return {
    repository: createSupabaseUploadRepository(), id: randomUUID,
    async milestone(clientId, kind, actorId) {
      const result = await recordMilestone(clientId, kind, actorId);
      if (!result.ok) throw new Error("UPLOAD_MILESTONE_FAILED");
    },
  };
}
export async function uploadCompanyDocument(input: CompanyUploadInput, overrides: Partial<CompanyUploadDependencies> = {}): Promise<UploadedDocument> {
  const fileName = validate(input); const deps = { ...productionDependencies(), ...overrides };
  const id = deps.id(); if (!UUID.test(id)) throw new Error("UPLOAD_ID_INVALID");
  const objectPath = `${input.orgId}/${input.clientId}/${id}/${fileName}`;
  const metadata = { id, orgId: input.orgId, clientId: input.clientId, kind: "company" as const, section: input.section,
    bucket: "client-documents" as const, objectPath, displayName: fileName, mimeType: input.mimeType,
    sizeBytes: input.bytes.byteLength, uploadedBy: input.actorId };
  try {
    await deps.repository.create(metadata);
    await deps.repository.store(metadata.bucket, objectPath, input.bytes, input.mimeType);
    await deps.repository.update(id, { lifecycle: "stored", failureCode: null });
    await deps.milestone(input.clientId, "documents_uploaded", input.actorId);
    const persisted = await deps.repository.get(id);
    if (!persisted || persisted.lifecycle !== "stored") throw new Error("UPLOAD_READBACK_FAILED");
    return persisted;
  } catch {
    await deps.repository.remove(metadata.bucket, objectPath).catch(() => undefined);
    await deps.repository.deleteRow(id).catch(() => undefined);
    throw new Error("COMPANY_UPLOAD_FAILED");
  }
}
export function listCompanyDocuments(clientId: string, repository: UploadRepository = createSupabaseUploadRepository()): Promise<UploadedDocument[]> {
  if (!UUID.test(clientId)) throw new Error("UPLOAD_SCOPE_INVALID");
  return repository.list(clientId, "company");
}
export async function deleteCompanyDocument(input: { uploadId: string; clientId: string }, repository: UploadRepository = createSupabaseUploadRepository()): Promise<void> {
  if (!UUID.test(input.uploadId) || !UUID.test(input.clientId)) throw new Error("UPLOAD_SCOPE_INVALID");
  const row = await repository.get(input.uploadId);
  if (!row || row.clientId !== input.clientId || row.kind !== "company") throw new Error("UPLOAD_NOT_FOUND");
  await repository.remove(row.bucket, row.objectPath);
  await repository.deleteRow(row.id);
}
export async function downloadCompanyDocument(input: { uploadId: string; clientId: string }, repository: UploadRepository = createSupabaseUploadRepository()): Promise<{ bytes: Uint8Array; mimeType: string; fileName: string }> {
  if (!UUID.test(input.uploadId) || !UUID.test(input.clientId)) throw new Error("UPLOAD_SCOPE_INVALID");
  const row = await repository.get(input.uploadId);
  if (!row || row.clientId !== input.clientId || row.kind !== "company" || row.lifecycle !== "stored") throw new Error("UPLOAD_NOT_FOUND");
  return { bytes: await repository.download(row.bucket, row.objectPath), mimeType: row.mimeType, fileName: row.displayName };
}
