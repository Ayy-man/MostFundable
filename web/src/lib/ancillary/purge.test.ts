import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listUploadedReportPurgeTargets, runUploadedReportPurge } from "./purge.ts";
import type { UploadedDocument, UploadRepository } from "./upload-repository.ts";
const ID = "17000000-0000-4000-8000-000000000501", CLIENT = "17000000-0000-4000-8000-000000000502";
const pending = { id: ID, clientId: CLIENT, kind: "credit_report", lifecycle: "delete_pending", bucket: "credit-reports", objectPath: `o/c/${ID}/x`, derivedFeatures: { schemaVersion: 1 }, failureCode: "source_delete_pending" } as unknown as UploadedDocument;
function repo(overrides: Partial<UploadRepository>): UploadRepository { return overrides as UploadRepository; }
describe("uploaded report purge", () => {
  it("reconciles a pending raw source without enqueuing analysis", async () => {
    const events: string[] = [];
    const row = { ...pending, lifecycle: "pending" as const, derivedFeatures: null };
    const result = await runUploadedReportPurge(`upload:${ID}`, "2026-08-16", { repository: repo({
      async get() { return row; }, async remove() { events.push("delete"); }, async exists() { events.push("absence"); return false; },
      async update(_id, changes) { events.push(`state:${changes.lifecycle}`); return { ...row, ...changes } as UploadedDocument; },
      async markPurgedAndEnqueue() { events.push("atomic"); return row; },
    }) });
    assert.deepEqual(result, { status: "ok", rows: 1 });
    assert.deepEqual(events, ["delete", "absence", "state:failed"]);
  });
  it("rejects invalid keys and skips terminal rows", async () => {
    assert.deepEqual(await runUploadedReportPurge("bad", "2026-08-16", { repository: repo({}) }), { status: "failed" });
    assert.deepEqual(await runUploadedReportPurge(`upload:${ID}`, "2026-08-16", { repository: repo({ async get() { return { ...pending, lifecycle: "failed" }; } }) }), { status: "skipped", rows: 0 });
  });
  it("clears, confirms, marks, and enqueues once", async () => {
    const events: string[] = [];
    const result = await runUploadedReportPurge(`upload:${ID}`, "2026-08-16", { repository: repo({ async get() { return pending; }, async remove() { events.push("delete"); }, async exists() { events.push("absence"); return false; }, async markPurgedAndEnqueue() { events.push("atomic"); return { ...pending, lifecycle: "purged" }; } }) });
    assert.deepEqual(result, { status: "ok", rows: 1 }); assert.deepEqual(events, ["delete", "absence", "atomic"]);
  });
  it("clears a parser-failure source without enqueuing analysis", async () => {
    const events: string[] = [];
    const row = { ...pending, derivedFeatures: null, failureCode: "parse_source_delete_pending" };
    const result = await runUploadedReportPurge(`upload:${ID}`, "2026-08-16", { repository: repo({
      async get() { return row; },
      async remove() { events.push("delete"); },
      async exists() { events.push("absence"); return false; },
      async update(_id, changes) { events.push(`state:${changes.lifecycle}`); return { ...row, ...changes } as UploadedDocument; },
      async markPurgedAndEnqueue() { events.push("atomic"); throw new Error("unreachable"); },
    }) });
    assert.deepEqual(result, { status: "ok", rows: 1 });
    assert.deepEqual(events, ["delete", "absence", "state:failed"]);
  });
  it("repairs a purged row by verifying the analysis tuple", async () => {
    const events: string[] = [];
    const result = await runUploadedReportPurge(`upload:${ID}`, "2026-08-16", { repository: repo({ async get() { return { ...pending, lifecycle: "purged" }; }, async markPurgedAndEnqueue() { events.push("atomic"); return { ...pending, lifecycle: "purged" }; } }) });
    assert.deepEqual(result, { status: "ok", rows: 1 }); assert.deepEqual(events, ["atomic"]);
  });
  it("provides only retryable canonical targets without enqueue", async () => {
    const pendingRow = { ...pending, id: "17000000-0000-4000-8000-000000000504", lifecycle: "pending" as const };
    const rows = [pending, pendingRow, { ...pending, id: "17000000-0000-4000-8000-000000000503", lifecycle: "purged" as const }];
    assert.deepEqual(await listUploadedReportPurgeTargets("2026-08-16", repo({ async listPurgeTargets() { return rows; } })), [
      { subject: `upload:${ID}`, window: "2026-08-16" }, { subject: `upload:${pendingRow.id}`, window: "2026-08-16" },
    ]);
  });
});
