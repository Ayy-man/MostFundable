import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { STANDING_APPLICATION_QUESTIONS } from "@/lib/vault/standing-questions";
import {
  handleAdminBankCatalogCreate,
  handleAdminBankCatalogList,
  handleAdminBankCatalogMutation,
  type AdminBankCatalogHandlerDependencies,
} from "./bank-catalog-handler.ts";
import { createAdminBankCatalogService } from "./bank-catalog-service.ts";
import type { AdminBankCatalogEntry, AdminBankCatalogRepository } from "./bank-catalog-types.ts";

const ACTOR = "42000000-0000-4000-8000-000000000001";
const CONTENT = {
  applicationQuestions: STANDING_APPLICATION_QUESTIONS,
  bureauPulls: null,
  channel: null,
  checking: { depositAmountCents: null, required: null, seasoning: null },
  name: "Example Bank",
  products: ["Term loan"],
  qualificationSummary: null,
  relationshipManager: { required: null, tip: null },
  sourceUpdatedAt: null,
} as const;
const ENTRY: AdminBankCatalogEntry = {
  bankRef: "example-bank",
  catalogId: "42000000-0000-4000-8000-000000000002",
  hasOverride: true,
  isActive: true,
  outcomeReferenced: false,
  source: "manual",
  sourceIsActive: true,
  syncedAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  ...CONTENT,
};

function harness() {
  const calls: unknown[] = [];
  const repository: AdminBankCatalogRepository = {
    async list() { calls.push("list"); return [ENTRY]; },
    async create(actor, input) { calls.push(["create", actor, input]); return ENTRY; },
    async update(actor, ref, content) { calls.push(["update", actor, ref, content]); return ENTRY; },
    async setStatus(actor, ref, active) { calls.push(["status", actor, ref, active]); return { ...ENTRY, isActive: active }; },
  };
  const service = createAdminBankCatalogService(repository);
  const dependencies: AdminBankCatalogHandlerDependencies = {
    async requireAdmin() { calls.push("auth"); return { id: ACTOR, role: "platform_admin" }; },
    async service() { return service; },
  };
  return { calls, dependencies };
}

describe("admin bank catalog handlers", () => {
  it("authenticates before reading or parsing and returns private readbacks", async () => {
    const { calls, dependencies } = harness();
    const list = await handleAdminBankCatalogList(dependencies);
    assert.equal(list.status, 200);
    assert.equal(list.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(calls.slice(0, 2), ["auth", "list"]);
    assert.deepEqual(await list.json(), { banks: [ENTRY] });

    const forbidden = await handleAdminBankCatalogCreate(
      new Request("http://local/api/admin/banks", { body: "not json", method: "POST" }),
      { ...dependencies, async requireAdmin() { throw { status: 403 }; } },
    );
    assert.equal(forbidden.status, 403);
  });

  it("creates, updates, archives and reactivates through exact envelopes", async () => {
    const { calls, dependencies } = harness();
    const created = await handleAdminBankCatalogCreate(new Request("http://local/api/admin/banks", {
      body: JSON.stringify({ bankRef: "example-bank", ...CONTENT }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }), dependencies);
    assert.equal(created.status, 201);

    const updated = await handleAdminBankCatalogMutation(new Request("http://local/api/admin/banks/example-bank", {
      body: JSON.stringify({ action: "update", content: CONTENT }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    }), "example-bank", dependencies);
    assert.equal(updated.status, 200);

    for (const action of ["archive", "reactivate"] as const) {
      const response = await handleAdminBankCatalogMutation(new Request("http://local/api/admin/banks/example-bank", {
        body: JSON.stringify({ action }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      }), "example-bank", dependencies);
      assert.equal(response.status, 200);
    }
    assert.deepEqual(calls.filter((call) => Array.isArray(call)).map((call) => (call as unknown[])[0]), [
      "create", "update", "status", "status",
    ]);
  });

  it("rejects widened or mismatched action bodies without calling a mutation", async () => {
    const { calls, dependencies } = harness();
    for (const value of [
      { action: "delete" },
      { action: "archive", content: CONTENT },
      { action: "update" },
      { action: "update", content: CONTENT, providerToken: "secret" },
    ]) {
      const response = await handleAdminBankCatalogMutation(new Request("http://local/api/admin/banks/example-bank", {
        body: JSON.stringify(value), method: "PATCH",
      }), "example-bank", dependencies);
      assert.equal(response.status, 400);
    }
    assert.equal(calls.some((call) => Array.isArray(call)), false);
  });
});
