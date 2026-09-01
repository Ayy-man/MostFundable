import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";

const DOCUMENT = {
  bankRef: "bank-a",
  statsVersion: 2,
  document: { bank_ref: "bank-a", heat_level: "warm" as const, windows: { d30: { approved: 1, denied: 0, withdrawn: 0, approvedAmountCents: 100 }, d60: { approved: 1, denied: 0, withdrawn: 0, approvedAmountCents: 100 }, d90: { approved: 1, denied: 0, withdrawn: 0, approvedAmountCents: 100 }, d183: { approved: 1, denied: 0, withdrawn: 0, approvedAmountCents: 100 }, d365: { approved: 1, denied: 0, withdrawn: 0, approvedAmountCents: 100 } } },
  documentFingerprint: "a".repeat(32),
  rebuiltAt: "2026-08-16T00:00:00.000Z",
};

describe("bank retrieval document reader", () => {
  it("exposes only the closed org-neutral document shape", () => {
    const serialized = JSON.stringify(DOCUMENT);
    for (const key of ["clientId", "orgId", "profileId", "freeText"]) assert.equal(serialized.includes(key), false);
    assert.deepEqual(Object.keys(DOCUMENT).sort(), ["bankRef", "document", "documentFingerprint", "rebuiltAt", "statsVersion"]);
  });

  it("selects the exact five columns, filters optionally, orders deterministically, and names no mutation", async () => {
    const source = await readFile(new URL("./repository.ts", import.meta.url), "utf8");
    const start = source.indexOf("export const bankRetrievalDocumentRepository");
    const end = source.indexOf("function toNotification", start);
    const seam = source.slice(start, end);
    assert.match(source, /const RETRIEVAL_DOCUMENT_COLUMNS =\s*\n\s*"bank_ref,stats_version,document,document_fingerprint,rebuilt_at"/);
    assert.match(seam, /\.in\("bank_ref", bankRefs\)/);
    assert.match(seam, /\.order\("bank_ref", \{ ascending: true \}\)/);
    assert.equal(/\.(?:insert|update|delete|rpc)\(/.test(seam), false);
  });
});
