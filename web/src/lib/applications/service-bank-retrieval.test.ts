import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { listBankRetrievalDocuments } from "./service.ts";

const DOCUMENT = {
  bankRef: "bank-a",
  statsVersion: 2,
  document: { bank_ref: "bank-a", heat_level: "warm" as const, windows: { d30: { approved: 1, denied: 0, withdrawn: 0, approvedAmountCents: 100 }, d60: { approved: 1, denied: 0, withdrawn: 0, approvedAmountCents: 100 }, d90: { approved: 1, denied: 0, withdrawn: 0, approvedAmountCents: 100 }, d183: { approved: 1, denied: 0, withdrawn: 0, approvedAmountCents: 100 }, d365: { approved: 1, denied: 0, withdrawn: 0, approvedAmountCents: 100 } } },
  documentFingerprint: "a".repeat(32),
  rebuiltAt: "2026-08-16T00:00:00.000Z",
};

describe("bank retrieval service", () => {
  it("passes undefined and a closed bank-ref set through the read-only seam", async () => {
    const calls: Array<readonly string[] | undefined> = [];
    const repository = { async listBankRetrievalDocuments(bankRefs?: readonly string[]) { calls.push(bankRefs); return [DOCUMENT]; } };
    assert.deepEqual(await listBankRetrievalDocuments(undefined, repository), [DOCUMENT]);
    assert.deepEqual(await listBankRetrievalDocuments(["bank-a"], repository), [DOCUMENT]);
    assert.deepEqual(calls, [undefined, ["bank-a"]]);
  });

  it("short-circuits an empty set and propagates a bounded repository failure", async () => {
    let calls = 0;
    assert.deepEqual(await listBankRetrievalDocuments([], { async listBankRetrievalDocuments() { calls += 1; return [DOCUMENT]; } }), []);
    assert.equal(calls, 0);
    await assert.rejects(listBankRetrievalDocuments(undefined, { async listBankRetrievalDocuments() { throw new Error("failed"); } }), /failed/);
  });
});
