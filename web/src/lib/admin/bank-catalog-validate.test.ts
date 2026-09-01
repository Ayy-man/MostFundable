import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { STANDING_APPLICATION_QUESTIONS } from "@/lib/vault/standing-questions";
import {
  adminBankCatalogPayload,
  parseAdminBankCatalogCreateInput,
  parseAdminBankCatalogDatabaseRow,
  parseAdminBankCatalogEntry,
} from "./bank-catalog-validate.ts";

const CONTENT = {
  applicationQuestions: [
    ...STANDING_APPLICATION_QUESTIONS,
    { id: "requested-amount", label: "Requested amount", responseBasis: "Use the documented funding need." },
  ],
  bureauPulls: "Experian business",
  channel: { type: "online", value: "https://example.test/apply" },
  checking: { depositAmountCents: 100_000, required: true, seasoning: "90 days" },
  name: "Example Bank",
  products: ["Business line of credit"],
  qualificationSummary: "Current business records",
  relationshipManager: { required: false, tip: "Expect a document follow-up." },
  sourceUpdatedAt: "2026-08-31",
} as const;

const ENTRY = {
  ...CONTENT,
  bankRef: "example-bank",
  catalogId: "42000000-0000-4000-8000-000000000001",
  hasOverride: true,
  isActive: true,
  outcomeReferenced: false,
  source: "manual",
  sourceIsActive: true,
  syncedAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
} as const;

describe("admin bank catalog validation", () => {
  it("accepts the exact Bank Vault contract and builds only migration 420's allow-listed payload", () => {
    const input = parseAdminBankCatalogCreateInput({ bankRef: "example-bank", ...CONTENT });
    assert.ok(input);
    assert.deepEqual(Object.keys(adminBankCatalogPayload(input)).sort(), [
      "application_questions",
      "bureau_pulls",
      "channel_type",
      "channel_value",
      "checking_deposit_cents",
      "checking_required",
      "checking_seasoning",
      "name",
      "products",
      "qualification_summary",
      "rel_manager",
      "rel_manager_tip",
      "source_updated_at",
    ]);
  });

  it("rejects widened provider data, excluded criteria and raw source markup", () => {
    assert.equal(parseAdminBankCatalogCreateInput({
      bankRef: "example-bank",
      ...CONTENT,
      providerServiceKey: "do-not-accept",
    }), null);
    assert.equal(parseAdminBankCatalogCreateInput({
      bankRef: "example-bank",
      ...CONTENT,
      qualificationSummary: "Requires a 700 score",
    }), null);
    assert.equal(parseAdminBankCatalogCreateInput({
      bankRef: "example-bank",
      ...CONTENT,
      qualificationSummary: "- **3-day rule (HowToCredit `fBqsFVBezyw`)**",
    }), null);
  });

  it("keeps the four standing questions exact and rejects unsafe channels or duplicate products", () => {
    assert.equal(parseAdminBankCatalogCreateInput({
      bankRef: "example-bank",
      ...CONTENT,
      applicationQuestions: CONTENT.applicationQuestions.slice(1),
    }), null);
    assert.equal(parseAdminBankCatalogCreateInput({
      bankRef: "example-bank",
      ...CONTENT,
      channel: { type: "online", value: "javascript:alert(1)" },
    }), null);
    assert.equal(parseAdminBankCatalogCreateInput({
      bankRef: "example-bank",
      ...CONTENT,
      products: ["Term loan", "Term loan"],
    }), null);
  });

  it("parses the public readback and the exact snake-case database projection", () => {
    assert.deepEqual(parseAdminBankCatalogEntry(ENTRY), ENTRY);
    const row = {
      application_questions: CONTENT.applicationQuestions,
      bank_ref: ENTRY.bankRef,
      bureau_pulls: CONTENT.bureauPulls,
      catalog_id: ENTRY.catalogId,
      channel_type: CONTENT.channel.type,
      channel_value: CONTENT.channel.value,
      checking_deposit_cents: CONTENT.checking.depositAmountCents,
      checking_required: CONTENT.checking.required,
      checking_seasoning: CONTENT.checking.seasoning,
      has_override: ENTRY.hasOverride,
      is_active: ENTRY.isActive,
      name: CONTENT.name,
      outcome_referenced: ENTRY.outcomeReferenced,
      products: CONTENT.products,
      qualification_summary: CONTENT.qualificationSummary,
      rel_manager: CONTENT.relationshipManager.required,
      rel_manager_tip: CONTENT.relationshipManager.tip,
      source: ENTRY.source,
      source_is_active: ENTRY.sourceIsActive,
      source_updated_at: CONTENT.sourceUpdatedAt,
      synced_at: ENTRY.syncedAt,
      updated_at: ENTRY.updatedAt,
    };
    assert.deepEqual(parseAdminBankCatalogDatabaseRow(row), ENTRY);
    assert.throws(() => parseAdminBankCatalogDatabaseRow({ ...row, vault_service_key: "secret" }), {
      message: "BANK_CATALOG_RESULT_INVALID",
    });
  });

  it("normalizes legacy VAULT markup and source handles on database readback only", () => {
    const row = {
      application_questions: [
        ...CONTENT.applicationQuestions,
        {
          id: "timing",
          label: "**Application timing**",
          responseBasis: "- **Apply after opening (HowToCredit `fBqsFVBezyw`):** within 3 days.",
        },
      ],
      bank_ref: ENTRY.bankRef,
      bureau_pulls: "`Experian business`",
      catalog_id: ENTRY.catalogId,
      channel_type: CONTENT.channel.type,
      channel_value: CONTENT.channel.value,
      checking_deposit_cents: CONTENT.checking.depositAmountCents,
      checking_required: CONTENT.checking.required,
      checking_seasoning: "**90 days**",
      has_override: false,
      is_active: true,
      name: "**Example Bank**",
      outcome_referenced: false,
      products: ["**Business line of credit**"],
      qualification_summary: "- **3-day rule (HowToCredit `fBqsFVBezyw`):** apply within 3 days.",
      rel_manager: CONTENT.relationshipManager.required,
      rel_manager_tip: "`Expect a document follow-up.`",
      source: "vault",
      source_is_active: true,
      source_updated_at: CONTENT.sourceUpdatedAt,
      synced_at: ENTRY.syncedAt,
      updated_at: ENTRY.updatedAt,
    };

    const parsed = parseAdminBankCatalogDatabaseRow(row);
    assert.equal(parsed.name, "Example Bank");
    assert.deepEqual(parsed.products, ["Business line of credit"]);
    assert.equal(parsed.qualificationSummary, "3-day rule: apply within 3 days.");
    assert.deepEqual(parsed.applicationQuestions.at(-1), {
      id: "timing",
      label: "Application timing",
      responseBasis: "Apply after opening: within 3 days.",
    });

    assert.equal(parseAdminBankCatalogCreateInput({
      bankRef: ENTRY.bankRef,
      ...CONTENT,
      qualificationSummary: row.qualification_summary,
    }), null);
  });
});
