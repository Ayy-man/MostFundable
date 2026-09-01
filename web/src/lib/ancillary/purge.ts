import { createSupabaseUploadRepository, type UploadRepository } from "./upload-repository.ts";

const SUBJECT = /^upload:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const WINDOW = /^\d{4}-\d{2}-\d{2}$/;
const STALE_AFTER_MS = 15 * 60 * 1000;
export interface PurgeDependencies {
  repository: UploadRepository;
}
function production(): PurgeDependencies {
  return { repository: createSupabaseUploadRepository() };
}
export async function runUploadedReportPurge(subject: string, window: string, overrides: Partial<PurgeDependencies> = {}): Promise<{ status: string; rows?: number }> {
  const match = SUBJECT.exec(subject); if (!match || !WINDOW.test(window)) return { status: "failed" };
  const deps = { ...production(), ...overrides };
  try {
    const row = await deps.repository.get(match[1]);
    if (!row || row.kind !== "credit_report" || row.lifecycle === "failed") return { status: "skipped", rows: 0 };
    if (!["pending", "stored", "parsed", "delete_pending", "purged"].includes(row.lifecycle)) return { status: "skipped", rows: 0 };
    if (row.lifecycle === "pending" || row.lifecycle === "stored") {
      try { await deps.repository.remove(row.bucket, row.objectPath); } catch { /* verified below */ }
      if (await deps.repository.exists(row.bucket, row.objectPath)) return { status: "failed" };
      await deps.repository.update(row.id, {
        lifecycle: "failed",
        derivedFeatures: null,
        failureCode: row.lifecycle === "stored" ? "parse_failed" : "lifecycle_write_failed",
      });
      return { status: "ok", rows: 1 };
    }
    if (row.lifecycle === "parsed" || row.lifecycle === "delete_pending") {
      await deps.repository.remove(row.bucket, row.objectPath);
      if (await deps.repository.exists(row.bucket, row.objectPath)) return { status: "failed" };
      if (row.derivedFeatures === null) {
        await deps.repository.update(row.id, {
          lifecycle: "failed",
          derivedFeatures: null,
          failureCode: "parse_failed",
        });
        return { status: "ok", rows: 1 };
      }
    }
    await deps.repository.markPurgedAndEnqueue(row.id);
    return { status: "ok", rows: 1 };
  } catch { return { status: "failed" }; }
}
export async function listUploadedReportPurgeTargets(window: string, repository: UploadRepository = createSupabaseUploadRepository()): Promise<Array<{ subject: string; window: string }>> {
  if (!WINDOW.test(window)) throw new Error("PURGE_WINDOW_INVALID");
  const staleBefore = new Date(Date.now() - STALE_AFTER_MS).toISOString();
  const rows = await repository.listPurgeTargets(staleBefore);
  return rows.filter((row) => ["pending", "stored", "parsed", "delete_pending"].includes(row.lifecycle))
    .map((row) => ({ subject: `upload:${row.id}`, window }));
}
