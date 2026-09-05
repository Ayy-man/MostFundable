import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCreditReportParser } from "./parser.ts";
import { listUploadedReportPurgeTargets, runUploadedReportPurge } from "./purge.ts";
import { loadParsedUploadFeatures, uploadCreditReport } from "./report-uploads.ts";
import type { CreateUploadMetadata, UploadedDocument, UploadRepository } from "./upload-repository.ts";

const ORG = "17000000-0000-4000-8000-000000000401", CLIENT = "17000000-0000-4000-8000-000000000402", ACTOR = "17000000-0000-4000-8000-000000000403", ID = "17000000-0000-4000-8000-000000000404";
const bytes = new TextEncoder().encode("MOSTFUNDABLE_FIXTURE_CREDIT_V1");
function harness(deleteFails = false) {
  const events: string[] = []; let current: UploadedDocument | null = null;
  const repository = {
    async create(input: CreateUploadMetadata) { events.push("metadata"); current = { ...input, lifecycle: "pending", derivedFeatures: null, createdAt: "x", updatedAt: "x", purgedAt: null, failureCode: null }; return current; },
    async store() { events.push("storage"); }, async download() { events.push("download"); return bytes; },
    async update(_id: string, changes: Parameters<UploadRepository["update"]>[1]) { events.push(changes.lifecycle); if (!current) throw new Error("missing"); current = { ...current, lifecycle: changes.lifecycle, derivedFeatures: changes.derivedFeatures === undefined ? current.derivedFeatures : changes.derivedFeatures, failureCode: changes.failureCode === undefined ? current.failureCode : changes.failureCode, purgedAt: changes.purgedAt === undefined ? current.purgedAt : changes.purgedAt }; return current; },
    async remove() { events.push("delete"); if (deleteFails) throw new Error("x"); }, async exists() { events.push("absence"); return deleteFails; },
    async get() { return current; },
    async markPurgedAndEnqueue() { events.push("atomic"); if (!current) throw new Error("missing"); current = { ...current, lifecycle: "purged", failureCode: null, purgedAt: "now" }; return current; },
  } as unknown as UploadRepository;
  return { events, repository, get: () => current };
}
const input = { orgId: ORG, clientId: CLIENT, actorId: ACTOR, fileName: "credit.pdf", mimeType: "application/pdf", bytes };

function pairedFailureHarness() {
  const old = "2026-08-01T00:00:00.000Z";
  let current: UploadedDocument | null = null;
  let rawPresent = false;
  let initialDeleteFailed = false;
  let pendingWriteFailed = false;
  const repository = {
    async create(value: CreateUploadMetadata) {
      current = { ...value, lifecycle: "pending", derivedFeatures: null, createdAt: old, updatedAt: old, purgedAt: null, failureCode: null };
      return current;
    },
    async store() { rawPresent = true; },
    async download() { return bytes; },
    async update(_id: string, changes: Parameters<UploadRepository["update"]>[1]) {
      if (changes.lifecycle === "delete_pending" && !pendingWriteFailed) {
        pendingWriteFailed = true;
        throw new Error("cleanup state unavailable");
      }
      if (!current) throw new Error("missing");
      current = { ...current, lifecycle: changes.lifecycle,
        derivedFeatures: changes.derivedFeatures === undefined ? current.derivedFeatures : changes.derivedFeatures,
        failureCode: changes.failureCode === undefined ? current.failureCode : changes.failureCode };
      return current;
    },
    async remove() {
      if (!initialDeleteFailed) { initialDeleteFailed = true; throw new Error("storage unavailable"); }
      rawPresent = false;
    },
    async exists() { return rawPresent; },
    async get() { return current; },
    async listPurgeTargets(staleBefore: string) {
      return current && current.updatedAt < staleBefore ? [current] : [];
    },
    async markPurgedAndEnqueue() {
      if (!current) throw new Error("missing");
      current = { ...current, lifecycle: "purged", purgedAt: "now", failureCode: null };
      return current;
    },
  } as unknown as UploadRepository;
  return { repository, get: () => current, rawPresent: () => rawPresent };
}

describe("parse delete upload", () => {
  it("deletes and verifies raw storage when the first lifecycle write fails", async () => {
    const test = harness(); let first = true;
    const repository: UploadRepository = {
      ...test.repository,
      async update(id, changes) {
        if (first) { first = false; test.events.push("stored_failed"); throw new Error("db unavailable"); }
        return test.repository.update(id, changes);
      },
    };
    await assert.rejects(() => uploadCreditReport(input, { parser: createCreditReportParser("fixture"), repository, id: () => ID }), /CREDIT_REPORT_LIFECYCLE_FAILED/);
    assert.deepEqual(test.events, ["metadata", "storage", "stored_failed", "delete", "absence", "failed"]);
    assert.equal(test.events.includes("download"), false);
  });
  it("checks unavailable before metadata, Storage, or enqueue", async () => {
    let calls = 0; const repository = new Proxy({} as UploadRepository, { get() { calls += 1; throw new Error("touched"); } });
    await assert.rejects(() => uploadCreditReport(input, { parser: createCreditReportParser("unavailable"), repository, id: () => ID }), /CREDIT_REPORT_PARSER_UNAVAILABLE/);
    assert.equal(calls, 0);
  });

  it("persists derived values, confirms deletion, marks purged, then enqueues", async () => {
    const test = harness();
    const result = await uploadCreditReport(input, { parser: createCreditReportParser("fixture"), repository: test.repository, id: () => ID });
    assert.equal(result.status, "queued");
    assert.deepEqual(test.events, ["metadata", "storage", "stored", "download", "parsed", "delete", "absence", "atomic"]);
    assert.equal((await loadParsedUploadFeatures(CLIENT, ID, test.repository))?.schemaVersion, 2);
  });

  it("returns delete_pending with zero enqueue when source clearing fails", async () => {
    const test = harness(true);
    const result = await uploadCreditReport(input, { parser: createCreditReportParser("fixture"), repository: test.repository, id: () => ID });
    assert.equal(result.status, "delete_pending"); assert.equal(test.get()?.lifecycle, "delete_pending");
  });

  it("marks parse failures without derived values and never enqueues", async () => {
    const test = harness();
    await assert.rejects(() => uploadCreditReport({ ...input, bytes: new Uint8Array([1]) }, { parser: createCreditReportParser("fixture"), repository: { ...test.repository, async download() { return new Uint8Array([1]); } }, id: () => ID }), /CREDIT_REPORT_PARSE_FAILED/);
    assert.equal(test.get()?.lifecycle, "failed"); assert.equal(test.get()?.derivedFeatures, null);
    assert.deepEqual(test.events, ["metadata", "storage", "stored", "delete", "absence", "failed"]);
    assert.equal(test.events.includes("atomic"), false);
  });

  it("records a retryable source purge when parser-failure deletion is unavailable", async () => {
    const test = harness(true);
    await assert.rejects(() => uploadCreditReport({ ...input, bytes: new Uint8Array([1]) }, { parser: createCreditReportParser("fixture"), repository: { ...test.repository, async download() { return new Uint8Array([1]); } }, id: () => ID }), /CREDIT_REPORT_PARSE_FAILED/);
    assert.equal(test.get()?.lifecycle, "delete_pending");
    assert.equal(test.get()?.derivedFeatures, null);
    assert.equal(test.events.includes("atomic"), false);
  });

  it("recovers parser-failure paired delete and lifecycle-write failure", async () => {
    const test = pairedFailureHarness();
    await assert.rejects(() => uploadCreditReport(
      { ...input, bytes: new Uint8Array([1]) },
      { parser: createCreditReportParser("fixture"), repository: { ...test.repository, async download() { return new Uint8Array([1]); } }, id: () => ID },
    ));
    assert.equal(test.get()?.lifecycle, "stored");
    assert.deepEqual(await listUploadedReportPurgeTargets("2026-08-17", test.repository), [
      { subject: `upload:${ID}`, window: "2026-08-17" },
    ]);
    assert.deepEqual(await runUploadedReportPurge(`upload:${ID}`, "2026-08-17", { repository: test.repository }), { status: "ok", rows: 1 });
    assert.equal(test.rawPresent(), false, "paired parser-failure recovery removes the raw source");
  });

  it("recovers parsed paired delete and lifecycle-write failure", async () => {
    const test = pairedFailureHarness();
    await assert.rejects(() => uploadCreditReport(input, {
      parser: createCreditReportParser("fixture"), repository: test.repository, id: () => ID,
    }));
    assert.equal(test.get()?.lifecycle, "parsed");
    assert.deepEqual(await listUploadedReportPurgeTargets("2026-08-17", test.repository), [
      { subject: `upload:${ID}`, window: "2026-08-17" },
    ]);
    assert.deepEqual(await runUploadedReportPurge(`upload:${ID}`, "2026-08-17", { repository: test.repository }), { status: "ok", rows: 1 });
    assert.equal(test.rawPresent(), false, "paired parsed recovery removes the raw source before enqueue");
    assert.equal(test.get()?.lifecycle, "purged");
  });

  it("excludes a fresh in-flight pending upload from reconciliation targets", async () => {
    const fresh = { ...testDocument(), lifecycle: "pending" as const, updatedAt: new Date().toISOString() };
    const repository = { async listPurgeTargets(staleBefore: string) {
      return fresh.updatedAt < staleBefore ? [fresh] : [];
    } } as unknown as UploadRepository;
    assert.deepEqual(await listUploadedReportPurgeTargets("2026-08-17", repository), [],
      "fresh pending metadata is not selected while its Storage write may still be running");
  });
});

function testDocument(): UploadedDocument {
  return {
    id: ID, orgId: ORG, clientId: CLIENT, kind: "credit_report", section: null,
    bucket: "credit-reports", objectPath: `${ORG}/${CLIENT}/${ID}/credit.pdf`, displayName: "credit.pdf",
    mimeType: "application/pdf", sizeBytes: bytes.byteLength, lifecycle: "pending", derivedFeatures: null,
    uploadedBy: ACTOR, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    purgedAt: null, failureCode: null,
  };
}
