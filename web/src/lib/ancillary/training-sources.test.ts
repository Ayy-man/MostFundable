import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createTraining,
  deleteTraining,
  downloadPlatformTrainingSource,
  publishTraining,
  trainingResponse,
  updatePlatformTrainingWithSource,
} from "./trainings.ts";
import type { AncillaryRepository, Training } from "./repository.ts";
import type { TrainingSourceStorage } from "./training-source-storage.ts";

const ADMIN = { id: "17000000-0000-4000-8000-000000000001", role: "platform_admin" as const, orgId: null };
const OPERATOR = { id: "17000000-0000-4000-8000-000000000002", role: "operator_member" as const, orgId: "17000000-0000-4000-8000-000000000010" };
const TRAINING_ID = "17000000-0000-4000-8000-000000000020";
const INPUT = { audience: "operator" as const, title: "Platform lesson", videoUrl: "https://youtu.be/source", body: "Lesson body" };
const SOURCE = { bytes: new Uint8Array([1, 2, 3]), fileName: "source.pdf", mimeType: "application/pdf" };
const UPLOADED_AT = "2026-09-01T00:00:00.000Z";
const SOURCE_FILE = { fileName: "source.pdf", mimeType: "application/pdf", objectPath: `${TRAINING_ID}/source`, sizeBytes: 3, uploadedAt: UPLOADED_AT };
const PLATFORM_ROW: Training = {
  attestationText: null,
  attested: false,
  attestedAt: null,
  audience: "operator",
  body: INPUT.body,
  createdAt: UPLOADED_AT,
  createdBy: ADMIN.id,
  id: TRAINING_ID,
  orgId: null,
  published: false,
  publishedAt: null,
  publishedBy: null,
  source: "platform",
  sourceFile: SOURCE_FILE,
  takedownReason: null,
  takenDownAt: null,
  takenDownBy: null,
  title: INPUT.title,
  updatedAt: UPLOADED_AT,
  videoUrl: INPUT.videoUrl,
};

function repo(overrides: Partial<AncillaryRepository>): AncillaryRepository {
  return overrides as AncillaryRepository;
}

function storage(overrides: Partial<TrainingSourceStorage> = {}): TrainingSourceStorage {
  return {
    async download() { return SOURCE.bytes; },
    async exists() { return true; },
    async remove() {},
    async replace() {},
    async store() {},
    ...overrides,
  };
}

describe("platform training source lifecycle", () => {
  it("requires a source for admin creation while leaving operator creation unchanged", async () => {
    let adminWrites = 0;
    await assert.rejects(
      () => createTraining(ADMIN, INPUT, repo({ async createTraining() { adminWrites += 1; return PLATFORM_ROW; } })),
      /TRAINING_SOURCE_REQUIRED/,
    );
    assert.equal(adminWrites, 0);

    let operatorWrite: unknown;
    const operatorRow = { ...PLATFORM_ROW, orgId: OPERATOR.orgId, source: "operator" as const, sourceFile: null };
    assert.equal(await createTraining(OPERATOR, INPUT, repo({ async createTraining(input) { operatorWrite = input; return operatorRow; } })), operatorRow);
    assert.deepEqual(operatorWrite, { ...INPUT, createdBy: OPERATOR.id, orgId: OPERATOR.orgId, source: "operator" });
  });

  it("stores at a server-derived private path and confirms metadata plus object read-back", async () => {
    const events: unknown[] = [];
    let persisted = PLATFORM_ROW;
    const repository = repo({
      async createTraining(input) { events.push(["create", input]); persisted = { ...PLATFORM_ROW, sourceFile: input.sourceFile ?? null }; return persisted; },
      async deleteTraining() { events.push(["delete-row"]); },
      async getTraining() { events.push(["read-row"]); return persisted; },
    });
    const sourceStorage = storage({
      async exists(path) { events.push(["exists", path]); return true; },
      async store(path, bytes, mimeType) { events.push(["store", path, bytes.byteLength, mimeType]); },
    });
    const result = await createTraining(ADMIN, { ...INPUT, title: " Platform lesson " }, repository, {
      ...SOURCE,
      fileName: "../../policy source.PDF",
    }, { id: () => TRAINING_ID, now: () => new Date(UPLOADED_AT), storage: sourceStorage });

    assert.equal(result.sourceFile?.fileName, "policy-source.pdf");
    assert.deepEqual(events[0], ["store", `${TRAINING_ID}/source`, 3, "application/pdf"]);
    assert.deepEqual(events.at(-1), ["exists", `${TRAINING_ID}/source`]);
    const serialized = trainingResponse(result, true);
    assert.deepEqual(serialized.sourceFile, {
      fileName: "policy-source.pdf",
      mimeType: "application/pdf",
      sizeBytes: 3,
      uploadedAt: UPLOADED_AT,
    });
    assert.doesNotMatch(JSON.stringify(serialized), /objectPath|platform-training-sources/);
  });

  it("removes a newly stored object when database read-back cannot confirm it", async () => {
    const events: string[] = [];
    let present = false;
    await assert.rejects(
      () => createTraining(ADMIN, INPUT, repo({
        async createTraining() { events.push("create"); return PLATFORM_ROW; },
        async deleteTraining() { events.push("delete-row"); },
        async getTraining() { events.push("read-row"); return null; },
      }), SOURCE, { id: () => TRAINING_ID, now: () => new Date(UPLOADED_AT), storage: storage({
        async exists() { events.push("verify-absence"); return present; },
        async remove() { events.push("remove"); present = false; },
        async store() { events.push("store"); present = true; },
      }) }),
      /TRAINING_SOURCE_WRITE_FAILED/,
    );
    assert.deepEqual(events, ["store", "create", "read-row", "delete-row", "remove", "verify-absence"]);
  });

  it("replaces bytes and metadata together, restoring old bytes when the database refuses", async () => {
    const events: string[] = [];
    await assert.rejects(
      () => updatePlatformTrainingWithSource(ADMIN, TRAINING_ID, INPUT, { ...SOURCE, fileName: "replacement.pdf" }, repo({
        async getTraining() { return PLATFORM_ROW; },
        async updatePlatformTrainingWithSource() { events.push("database-failed"); throw new Error("provider detail"); },
      }), { now: () => new Date(UPLOADED_AT), storage: storage({
        async download() { events.push("download-old"); return new Uint8Array([9]); },
        async replace(_path, bytes) { events.push(bytes[0] === 9 ? "restore-old" : "replace-new"); },
      }) }),
      /TRAINING_SOURCE_WRITE_FAILED/,
    );
    assert.deepEqual(events, ["download-old", "replace-new", "database-failed", "restore-old"]);
  });

  it("blocks publication without metadata and never calls the publish RPC", async () => {
    let published = 0;
    const legacy = { ...PLATFORM_ROW, sourceFile: null };
    await assert.rejects(
      () => publishTraining(ADMIN, TRAINING_ID, true, { TRAINING_ATTESTATION_TEXT: "Approved" }, repo({
        async listTrainings() { return [legacy]; },
        async publishTraining() { published += 1; return legacy; },
      })),
      /TRAINING_SOURCE_REQUIRED/,
    );
    assert.equal(published, 0);
  });

  it("downloads only an admin-scoped platform source and returns no storage coordinates", async () => {
    const repository = repo({ async getTraining() { return PLATFORM_ROW; } });
    await assert.rejects(() => downloadPlatformTrainingSource(OPERATOR, TRAINING_ID, repository, storage()), /TRAINING_FORBIDDEN/);
    const downloaded = await downloadPlatformTrainingSource(ADMIN, TRAINING_ID, repository, storage({ async download() { return new Uint8Array([7, 8]); } }));
    assert.deepEqual(downloaded, { bytes: new Uint8Array([7, 8]), fileName: "source.pdf", mimeType: "application/pdf" });
    assert.doesNotMatch(JSON.stringify(downloaded), /objectPath|bucket/);
  });

  it("deletes private bytes, verifies absence, then confirms the draft row is gone", async () => {
    const events: string[] = [];
    let row: Training | null = PLATFORM_ROW;
    let present = true;
    await deleteTraining(ADMIN, TRAINING_ID, repo({
      async deleteTraining() { events.push("delete-row"); row = null; },
      async getTraining() { events.push("read-row"); return row; },
      async listTrainings() { return row ? [row] : []; },
    }), { storage: storage({
      async download() { events.push("download"); return SOURCE.bytes; },
      async exists() { events.push("verify-absence"); return present; },
      async remove() { events.push("remove"); present = false; },
    }) });
    assert.deepEqual(events, ["download", "remove", "verify-absence", "delete-row", "read-row"]);
  });
});
