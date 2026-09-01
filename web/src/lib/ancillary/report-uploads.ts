import { randomUUID } from "node:crypto";
import { extractFeatures, type DerivedFeatures } from "@/lib/analysis/features";
import { sealReport } from "@/lib/crs/report";
import { creditReportParser, type CreditReportParser } from "./parser.ts";
import { createSupabaseUploadRepository, type UploadedDocument, type UploadRepository } from "./upload-repository.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX = 6 * 1024 * 1024;
const MIMES = new Set(["application/pdf", "application/octet-stream"]);
export interface CreditUploadInput { orgId: string; clientId: string; actorId: string; fileName: string; mimeType: string; bytes: Uint8Array }
export interface CreditUploadDependencies {
  repository: UploadRepository; parser: CreditReportParser; id(): string;
}
export type CreditUploadResult = { status: "queued" | "blocked"; upload: UploadedDocument } | { status: "delete_pending"; upload: UploadedDocument };
function name(value: string): string {
  const result = value.normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
  if (!result) throw new Error("UPLOAD_NAME_INVALID"); return result;
}
function production(): CreditUploadDependencies {
  return { repository: createSupabaseUploadRepository(), parser: creditReportParser, id: randomUUID };
}
function validDerived(value: unknown): value is DerivedFeatures {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return row.schemaVersion === 1 && Array.isArray(row.bureausPulled) && Array.isArray(row.accounts) && typeof row.computedAt === "string";
}
async function removeAndVerify(repository: UploadRepository, bucket: UploadedDocument["bucket"], objectPath: string): Promise<void> {
  try { await repository.remove(bucket, objectPath); } catch { /* verified absence below is authoritative */ }
  let present: boolean;
  try { present = await repository.exists(bucket, objectPath); } catch { throw new Error("UPLOAD_SOURCE_VERIFY_FAILED"); }
  if (present) throw new Error("UPLOAD_SOURCE_DELETE_FAILED");
}
export async function loadParsedUploadFeatures(clientId: string, uploadId: string, repository: UploadRepository = createSupabaseUploadRepository()): Promise<DerivedFeatures | null> {
  if (!UUID.test(clientId) || !UUID.test(uploadId)) return null;
  const row = await repository.get(uploadId);
  return row && row.clientId === clientId && row.kind === "credit_report" && row.lifecycle === "purged" && validDerived(row.derivedFeatures) ? row.derivedFeatures : null;
}
export async function uploadCreditReport(input: CreditUploadInput, overrides: Partial<CreditUploadDependencies> = {}): Promise<CreditUploadResult> {
  const deps = { ...production(), ...overrides };
  deps.parser.assertAvailable();
  if (![input.orgId, input.clientId, input.actorId].every((value) => UUID.test(value))) throw new Error("UPLOAD_SCOPE_INVALID");
  if (!MIMES.has(input.mimeType)) throw new Error("UPLOAD_MIME_INVALID");
  if (input.bytes.byteLength < 1 || input.bytes.byteLength > MAX) throw new Error("UPLOAD_SIZE_INVALID");
  const displayName = name(input.fileName); const id = deps.id();
  if (!UUID.test(id)) throw new Error("UPLOAD_ID_INVALID");
  const bucket = "credit-reports" as const; const objectPath = `${input.orgId}/${input.clientId}/${id}/${displayName}`;
  await deps.repository.create({ id, orgId: input.orgId, clientId: input.clientId, kind: "credit_report", section: null,
    bucket, objectPath, displayName, mimeType: input.mimeType, sizeBytes: input.bytes.byteLength, uploadedBy: input.actorId });
  await deps.repository.store(bucket, objectPath, input.bytes, input.mimeType);
  try {
    await deps.repository.update(id, { lifecycle: "stored", failureCode: null });
  } catch {
    try {
      await removeAndVerify(deps.repository, bucket, objectPath);
      try { await deps.repository.update(id, { lifecycle: "failed", derivedFeatures: null, failureCode: "lifecycle_write_failed" }); } catch { /* raw absence is the safety boundary */ }
    } catch {
      try { await deps.repository.update(id, { lifecycle: "delete_pending", derivedFeatures: null, failureCode: "parse_source_delete_pending" }); } catch { /* pending metadata remains discoverable */ }
    }
    throw new Error("CREDIT_REPORT_LIFECYCLE_FAILED");
  }
  let derived: DerivedFeatures;
  try {
    const sourceBytes = await deps.repository.download(bucket, objectPath);
    const envelope = await deps.parser.parse(sourceBytes);
    derived = extractFeatures(sealReport(envelope));
    await deps.repository.update(id, { lifecycle: "parsed", derivedFeatures: derived, failureCode: null });
  } catch {
    try {
      await removeAndVerify(deps.repository, bucket, objectPath);
      await deps.repository.update(id, { lifecycle: "failed", derivedFeatures: null, failureCode: "parse_failed" });
    } catch {
      await deps.repository.update(id, {
        lifecycle: "delete_pending",
        derivedFeatures: null,
        failureCode: "parse_source_delete_pending",
      });
    }
    throw new Error("CREDIT_REPORT_PARSE_FAILED");
  }
  try {
    await removeAndVerify(deps.repository, bucket, objectPath);
  } catch {
    const pending = await deps.repository.update(id, { lifecycle: "delete_pending", derivedFeatures: derived, failureCode: "source_delete_pending" });
    return { status: "delete_pending", upload: pending };
  }
  const purged = await deps.repository.markPurgedAndEnqueue(id);
  return { status: "queued", upload: purged };
}
