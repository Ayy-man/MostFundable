import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { STANDING_APPLICATION_QUESTIONS } from "@/lib/vault/standing-questions";
import {
  AdminBankCatalogError,
  changeAdminBankCatalogStatus,
  createAdminBankCatalogEntry,
  loadAdminBankCatalog,
  updateAdminBankCatalogEntry,
} from "./bank-catalog-client.ts";

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
const ENTRY = {
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
} as const;

type Call = { init?: RequestInit; path: string };
function fetcher(body: unknown, status: number, calls: Call[]): typeof fetch {
  return (async (input, init) => {
    calls.push({ path: String(input), init });
    return new Response(body === null ? null : JSON.stringify(body), { status });
  }) as typeof fetch;
}

describe("admin bank catalog client", () => {
  it("loads all lifecycle states without caching and keeps feature-off distinct", async () => {
    const calls: Call[] = [];
    assert.deepEqual(await loadAdminBankCatalog(fetcher({ banks: [ENTRY] }, 200, calls)), [ENTRY]);
    assert.deepEqual(calls[0], {
      path: "/api/admin/banks",
      init: { cache: "no-store", credentials: "same-origin" },
    });
    assert.equal(await loadAdminBankCatalog(fetcher(null, 404, [])), null);
  });

  it("uses exact create/update/status payloads and returns each write readback", async () => {
    const calls: Call[] = [];
    assert.equal((await createAdminBankCatalogEntry({ bankRef: "example-bank", ...CONTENT }, fetcher({ bank: ENTRY }, 201, calls))).bankRef, "example-bank");
    await updateAdminBankCatalogEntry("example-bank", CONTENT, fetcher({ bank: ENTRY }, 200, calls));
    await changeAdminBankCatalogStatus("example-bank", "archive", fetcher({ bank: { ...ENTRY, isActive: false } }, 200, calls));
    assert.deepEqual(calls.map((call) => [call.path, call.init?.method]), [
      ["/api/admin/banks", "POST"],
      ["/api/admin/banks/example-bank", "PATCH"],
      ["/api/admin/banks/example-bank", "PATCH"],
    ]);
    assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { action: "update", content: CONTENT });
    assert.deepEqual(JSON.parse(String(calls[2].init?.body)), { action: "archive" });
  });

  it("rejects widened readbacks and preserves typed server failures", async () => {
    await assert.rejects(
      () => loadAdminBankCatalog(fetcher({ banks: [{ ...ENTRY, providerToken: "secret" }] }, 200, [])),
      (error: unknown) => error instanceof AdminBankCatalogError
        && error.code === "bank_catalog_response_invalid",
    );
    await assert.rejects(
      () => changeAdminBankCatalogStatus("example-bank", "archive", fetcher({ error: { code: "bank_catalog_not_found" } }, 404, [])),
      (error: unknown) => error instanceof AdminBankCatalogError
        && error.status === 404 && error.code === "bank_catalog_not_found",
    );
  });
});
