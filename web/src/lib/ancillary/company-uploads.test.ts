import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { uploadCompanyDocument } from "./company-uploads.ts";
import type { CreateUploadMetadata, DocumentSection, UploadedDocument, UploadRepository } from "./upload-repository.ts";

const ORG = "17000000-0000-4000-8000-000000000301", CLIENT = "17000000-0000-4000-8000-000000000302", ACTOR = "17000000-0000-4000-8000-000000000303", ID = "17000000-0000-4000-8000-000000000304";
function row(section: DocumentSection): UploadedDocument { return { id: ID, orgId: ORG, clientId: CLIENT, kind: "company", section, bucket: "client-documents", objectPath: `${ORG}/${CLIENT}/${ID}/file.pdf`, displayName: "file.pdf", mimeType: "application/pdf", sizeBytes: 3, lifecycle: "stored", derivedFeatures: null, uploadedBy: ACTOR, createdAt: "x", updatedAt: "x", purgedAt: null, failureCode: null }; }
function repository(events: string[], section: DocumentSection, fail = ""): UploadRepository {
  const stored = row(section);
  return {
    async create(input: CreateUploadMetadata) { events.push("metadata"); stored.objectPath = input.objectPath; stored.displayName = input.displayName; return { ...stored, lifecycle: "pending" }; },
    async store() { events.push("storage"); if (fail === "storage") throw new Error("x"); },
    async update() { events.push("finalize"); if (fail === "finalize") throw new Error("x"); return stored; },
    async get() { events.push("readback"); return stored; },
    async remove() { events.push("compensate-object"); }, async deleteRow() { events.push("compensate-row"); },
  } as unknown as UploadRepository;
}
const base = (section: DocumentSection) => ({ orgId: ORG, clientId: CLIENT, actorId: ACTOR, section, fileName: " My file.pdf ", mimeType: "application/pdf", bytes: new Uint8Array([1, 2, 3]) });

describe("company upload", () => {
  it("accepts all five sections and keeps repeated section uploads unbounded", async () => {
    for (const section of ["articles", "ein", "tax_returns", "bank_statements", "other"] satisfies DocumentSection[]) {
      for (let index = 0; index < 2; index += 1) {
        const events: string[] = [];
        await uploadCompanyDocument(base(section), { repository: repository(events, section), id: () => ID, async milestone(clientId, kind, actorId) { assert.deepEqual([clientId, kind, actorId], [CLIENT, "documents_uploaded", ACTOR]); events.push("milestone"); } });
        assert.deepEqual(events, ["metadata", "storage", "finalize", "milestone", "readback"]);
      }
    }
  });

  it("refuses MIME and size before any write", async () => {
    let calls = 0; const repo = new Proxy({} as UploadRepository, { get() { calls += 1; throw new Error("touched"); } });
    await assert.rejects(() => uploadCompanyDocument({ ...base("ein"), mimeType: "text/html" }, { repository: repo }), /UPLOAD_MIME_INVALID/);
    await assert.rejects(() => uploadCompanyDocument({ ...base("ein"), bytes: new Uint8Array(6 * 1024 * 1024 + 1) }, { repository: repo }), /UPLOAD_SIZE_INVALID/);
    assert.equal(calls, 0);
  });

  it("compensates storage, finalize, and milestone failures and returns no row", async () => {
    for (const fail of ["storage", "finalize", "milestone"]) {
      const events: string[] = [];
      await assert.rejects(() => uploadCompanyDocument(base("other"), { repository: repository(events, "other", fail), id: () => ID, async milestone() { events.push("milestone"); if (fail === "milestone") throw new Error("x"); } }), /COMPANY_UPLOAD_FAILED/);
      assert.deepEqual(events.slice(-2), ["compensate-object", "compensate-row"]);
    }
  });
});
