import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { STANDING_APPLICATION_QUESTIONS } from "@/lib/vault/standing-questions";
import { AdminBankCatalogError } from "./bank-catalog-types.ts";
import {
  ADMIN_BANK_CATALOG_COLUMNS,
  createAdminBankCatalogRepository,
} from "./bank-catalog-repository.ts";

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
const ROW = {
  application_questions: CONTENT.applicationQuestions,
  bank_ref: "example-bank",
  bureau_pulls: null,
  catalog_id: "42000000-0000-4000-8000-000000000002",
  channel_type: null,
  channel_value: null,
  checking_deposit_cents: null,
  checking_required: null,
  checking_seasoning: null,
  has_override: true,
  is_active: true,
  name: CONTENT.name,
  outcome_referenced: false,
  products: CONTENT.products,
  qualification_summary: null,
  rel_manager: null,
  rel_manager_tip: null,
  source: "manual",
  source_is_active: true,
  source_updated_at: null,
  synced_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
};

function query(result: { data: unknown[] | null; error: { code?: string; message?: string } | null }, orders: unknown[]) {
  return {
    order(column: string, options: unknown) { orders.push([column, options]); return this; },
    then(resolve: (value: typeof result) => unknown, reject: (reason: unknown) => unknown) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
}

describe("admin bank catalog repository", () => {
  it("lists the metadata-safe admin view in stable name/ref order", async () => {
    const orders: unknown[] = [];
    const selections: unknown[] = [];
    const repository = createAdminBankCatalogRepository(() => ({
      from(table: string) {
        assert.equal(table, "admin_bank_catalog_read_model");
        return { select(columns: string) { selections.push(columns); return query({ data: [ROW], error: null }, orders); } };
      },
      rpc() { throw new Error("unexpected"); },
    }));
    const rows = await repository.list();
    assert.equal(rows[0].bankRef, "example-bank");
    assert.deepEqual(selections, [ADMIN_BANK_CATALOG_COLUMNS]);
    assert.deepEqual(orders, [
      ["name", { ascending: true }],
      ["bank_ref", { ascending: true }],
    ]);
    assert.doesNotMatch(ADMIN_BANK_CATALOG_COLUMNS, /credential|service_key|secret|fico|time_in_business/i);
  });

  it("keeps listing when a legacy VAULT row still contains markup and an internal source handle", async () => {
    const repository = createAdminBankCatalogRepository(() => ({
      from() {
        return {
          select() {
            return query({
              data: [
                ROW,
                {
                  ...ROW,
                  bank_ref: "legacy-bank",
                  catalog_id: "42000000-0000-4000-8000-000000000003",
                  has_override: false,
                  name: "**Legacy Bank**",
                  qualification_summary:
                    "- **3-day rule (HowToCredit `fBqsFVBezyw`):** apply within 3 days.",
                  source: "vault",
                },
              ],
              error: null,
            }, []);
          },
        };
      },
      rpc() { throw new Error("unexpected"); },
    }));

    const rows = await repository.list();
    assert.equal(rows.length, 2);
    assert.equal(rows[1].name, "Legacy Bank");
    assert.equal(rows[1].qualificationSummary, "3-day rule: apply within 3 days.");
  });

  it("uses only the three audited RPCs and returns each write's database readback", async () => {
    const calls: { args: Record<string, unknown>; name: string }[] = [];
    const repository = createAdminBankCatalogRepository(() => ({
      from() { throw new Error("unexpected"); },
      async rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args });
        return { data: [ROW], error: null };
      },
    }));
    assert.equal((await repository.create(ACTOR, { bankRef: "example-bank", ...CONTENT })).bankRef, "example-bank");
    await repository.update(ACTOR, "example-bank", CONTENT);
    await repository.setStatus(ACTOR, "example-bank", false);
    assert.deepEqual(calls.map((call) => call.name), [
      "admin_create_bank_catalog_entry",
      "admin_update_bank_catalog_entry",
      "admin_set_bank_catalog_status",
    ]);
    assert.deepEqual(Object.keys(calls[0].args).sort(), ["p_actor", "p_bank_ref", "p_payload"]);
    assert.equal(calls[2].args.p_is_active, false);
    assert.equal(JSON.stringify(calls).includes("service_key"), false);
  });

  it("maps conflicts and missing rows without leaking database details", async () => {
    for (const [code, expectedStatus, expectedCode] of [
      ["23505", 409, "bank_catalog_already_exists"],
      ["P0002", 404, "bank_catalog_not_found"],
      ["XX000", 500, "bank_catalog_write_failed"],
    ] as const) {
      const repository = createAdminBankCatalogRepository(() => ({
        from() { throw new Error("unexpected"); },
        async rpc() { return { data: null, error: { code, message: "private database host" } }; },
      }));
      await assert.rejects(
        () => repository.setStatus(ACTOR, "example-bank", false),
        (error: unknown) => error instanceof AdminBankCatalogError
          && error.status === expectedStatus && error.code === expectedCode
          && !error.message.includes("database host"),
      );
    }
  });
});
