import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDerivedExport, DERIVED_EXPORTS } from "./exports.ts";
import type { AncillaryRepository } from "./repository.ts";

const ACTOR = { id: "17000000-0000-4000-8000-000000000201", role: "platform_admin" };
function repo(overrides: Partial<AncillaryRepository>): AncillaryRepository { return overrides as AncillaryRepository; }
async function consume(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader(); const decoder = new TextDecoder(); let output = "";
  for (;;) { const next = await reader.read(); if (next.done) return output; output += decoder.decode(next.value, { stream: true }); }
}

describe("derived export", () => {
  it("has exactly the seven contracted datasets", () => {
    assert.deepEqual(Object.keys(DERIVED_EXPORTS), ["analysis_runs", "plans", "checklist_item_state", "bank_outcome_stats", "bank_retrieval_index", "operator_earnings_ledger", "referral_ledger"]);
    assert.deepEqual(DERIVED_EXPORTS.operator_earnings_ledger.filters, ["operator_org_id", "accrual_month", "settlement_status"]);
    assert.deepEqual(DERIVED_EXPORTS.referral_ledger.filters, ["saas_referral_id", "referrer_org_id", "referred_org_id", "accrual_month", "settlement_status"]);
    assert.ok(DERIVED_EXPORTS.operator_earnings_ledger.columns.includes("settlement_status"));
    assert.ok(DERIVED_EXPORTS.referral_ledger.columns.includes("settlement_status"));
  });

  it("streams a complete empty JSON document and one truthful audit", async () => {
    const audits: unknown[] = [];
    const descriptor = createDerivedExport({ actor: ACTOR, dataset: "plans", format: "json" }, repo({ async readExportPage() { return []; }, async auditExport(input) { audits.push(input); } }));
    assert.equal(await consume(descriptor.stream), "[]");
    assert.deepEqual(audits, [{ actorId: ACTOR.id, dataset: "plans", format: "json", filters: {}, rowCount: 0, status: "complete" }]);
  });

  it("streams valid multi-page JSON with delimiters across chunks", async () => {
    const rows = [{ id: "1", title: "café" }, { id: "2", title: "two" }, { id: "3", title: "three" }];
    const audits: Array<{ rowCount: number }> = [];
    const repository = repo({ async readExportPage(input) { return rows.slice(input.offset, input.offset + input.limit); }, async auditExport(input) { audits.push(input); } });
    const output = await consume(createDerivedExport({ actor: ACTOR, dataset: "plans", format: "json", pageSize: 2 }, repository).stream);
    assert.deepEqual(JSON.parse(output), rows);
    assert.equal(audits[0]?.rowCount, 3);
  });

  it("quotes CSV commas, quotes, and newlines", async () => {
    const row = { id: "1", client_id: "x", ran_at: "now", trigger: "upload", readiness_score: 1, derived: { note: "a,\n\"b\"" } };
    const output = await consume(createDerivedExport({ actor: ACTOR, dataset: "analysis_runs", format: "csv" }, repo({ async readExportPage() { return [row]; }, async auditExport() {} })).stream);
    assert.match(output, /"\{""note"":""a,\\n\\""b\\""""\}"/);
  });

  it("audits cancellation as partial and rejects before stream creation", async () => {
    const audits: Array<{ status: string; rowCount: number }> = [];
    const descriptor = createDerivedExport({ actor: ACTOR, dataset: "plans", format: "json", pageSize: 1 }, repo({ async readExportPage() { return [{ id: "1" }]; }, async auditExport(input) { audits.push(input); } }));
    const reader = descriptor.stream.getReader(); await reader.read(); await reader.read(); await reader.cancel();
    assert.deepEqual(audits, [{ actorId: ACTOR.id, dataset: "plans", format: "json", filters: {}, rowCount: 1, status: "partial" }]);
    assert.throws(() => createDerivedExport({ actor: ACTOR, dataset: "unknown", format: "json" }, repo({})), /EXPORT_DATASET_INVALID/);
    assert.throws(() => createDerivedExport({ actor: ACTOR, dataset: "plans", format: "xml" }, repo({})), /EXPORT_FORMAT_INVALID/);
    assert.throws(() => createDerivedExport({ actor: ACTOR, dataset: "plans", format: "json", filters: { table: "clients" } }, repo({})), /EXPORT_FILTER_INVALID/);
  });
});
