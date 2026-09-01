import { isAdminDay, isExactRecord } from "./http.ts";
import {
  ADMIN_BANK_CATALOG_SOURCES,
  type AdminBankCatalogContent,
  type AdminBankCatalogCreateInput,
  type AdminBankCatalogEntry,
  type AdminBankCatalogPayload,
} from "./bank-catalog-types.ts";
import {
  STANDING_APPLICATION_QUESTIONS,
  STANDING_QUESTION_IDS,
  withStandingQuestions,
} from "@/lib/vault/standing-questions";
import { normalizeChannel, vettedText } from "@/lib/vault/sync";
import type { BankApplicationQuestion, BankChannel } from "@/lib/vault/types";

export const ADMIN_BANK_REF = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const QUESTION_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CONTENT_KEYS = [
  "applicationQuestions",
  "bureauPulls",
  "channel",
  "checking",
  "name",
  "products",
  "qualificationSummary",
  "relationshipManager",
  "sourceUpdatedAt",
] as const;

const CREATE_KEYS = [...CONTENT_KEYS, "bankRef"] as const;
const ENTRY_KEYS = [
  ...CREATE_KEYS,
  "catalogId",
  "hasOverride",
  "isActive",
  "outcomeReferenced",
  "source",
  "sourceIsActive",
  "syncedAt",
  "updatedAt",
] as const;

function instant(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function exactVettedText(value: unknown, max: number): value is string {
  return typeof value === "string"
    && value.length > 0
    && value === value.trim()
    && vettedText(value, max) === value;
}

function nullableVettedText(value: unknown, max: number): value is string | null {
  return value === null || exactVettedText(value, max);
}

function parseProducts(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length > 50) return null;
  const products: string[] = [];
  const seen = new Set<string>();
  for (const product of value) {
    if (!exactVettedText(product, 120) || seen.has(product)) return null;
    seen.add(product);
    products.push(product);
  }
  return Object.freeze(products);
}

function parseChannel(value: unknown): BankChannel | null | undefined {
  if (value === null) return null;
  if (!isExactRecord(value, ["type", "value"])) return undefined;
  if (value.type !== "online" && value.type !== "phone" && value.type !== "in-person") {
    return undefined;
  }
  if (!(value.value === null || typeof value.value === "string")) return undefined;
  const candidate = { type: value.type, value: value.value } as BankChannel;
  const normalized = normalizeChannel(candidate);
  if (normalized === null || JSON.stringify(normalized) !== JSON.stringify(candidate)) return undefined;
  return Object.freeze(normalized);
}

function parseQuestions(value: unknown): readonly BankApplicationQuestion[] | null {
  if (!Array.isArray(value) || value.length < STANDING_APPLICATION_QUESTIONS.length || value.length > 50) {
    return null;
  }
  const questions: BankApplicationQuestion[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const question = value[index];
    if (!isExactRecord(question, ["id", "label", "responseBasis"])
      || typeof question.id !== "string" || !QUESTION_ID.test(question.id)
      || !exactVettedText(question.label, 200)
      || !exactVettedText(question.responseBasis, 500)
      || seen.has(question.id)) return null;
    if (index < STANDING_APPLICATION_QUESTIONS.length
      && JSON.stringify(question) !== JSON.stringify(STANDING_APPLICATION_QUESTIONS[index])) return null;
    seen.add(question.id);
    questions.push(Object.freeze({
      id: question.id,
      label: question.label,
      responseBasis: question.responseBasis,
    }));
  }
  return Object.freeze(questions);
}

export function parseAdminBankCatalogContent(value: unknown): AdminBankCatalogContent | null {
  if (!isExactRecord(value, CONTENT_KEYS)
    || !exactVettedText(value.name, 200)
    || !nullableVettedText(value.bureauPulls, 200)
    || !nullableVettedText(value.qualificationSummary, 500)
    || !(value.sourceUpdatedAt === null || isAdminDay(value.sourceUpdatedAt))) return null;

  const products = parseProducts(value.products);
  const channel = parseChannel(value.channel);
  const questions = parseQuestions(value.applicationQuestions);
  if (products === null || channel === undefined || questions === null) return null;

  if (!isExactRecord(value.checking, ["depositAmountCents", "required", "seasoning"])
    || !(value.checking.required === null || typeof value.checking.required === "boolean")
    || !(value.checking.depositAmountCents === null
      || (typeof value.checking.depositAmountCents === "number"
        && Number.isSafeInteger(value.checking.depositAmountCents)
        && value.checking.depositAmountCents >= 0
        && value.checking.depositAmountCents <= 2_147_483_647))
    || !nullableVettedText(value.checking.seasoning, 200)) return null;

  if (!isExactRecord(value.relationshipManager, ["required", "tip"])
    || !(value.relationshipManager.required === null
      || typeof value.relationshipManager.required === "boolean")
    || !nullableVettedText(value.relationshipManager.tip, 240)) return null;

  return Object.freeze({
    applicationQuestions: questions,
    bureauPulls: value.bureauPulls,
    channel,
    checking: Object.freeze({
      depositAmountCents: value.checking.depositAmountCents,
      required: value.checking.required,
      seasoning: value.checking.seasoning,
    }),
    name: value.name,
    products,
    qualificationSummary: value.qualificationSummary,
    relationshipManager: Object.freeze({
      required: value.relationshipManager.required,
      tip: value.relationshipManager.tip,
    }),
    sourceUpdatedAt: value.sourceUpdatedAt,
  });
}

export function parseAdminBankCatalogCreateInput(value: unknown): AdminBankCatalogCreateInput | null {
  if (!isExactRecord(value, CREATE_KEYS)
    || typeof value.bankRef !== "string" || !ADMIN_BANK_REF.test(value.bankRef)) return null;
  const content = parseAdminBankCatalogContent(Object.fromEntries(
    CONTENT_KEYS.map((key) => [key, value[key]]),
  ));
  return content === null ? null : Object.freeze({ bankRef: value.bankRef, ...content });
}

export function parseAdminBankCatalogEntry(value: unknown): AdminBankCatalogEntry | null {
  if (!isExactRecord(value, ENTRY_KEYS)
    || typeof value.bankRef !== "string" || !ADMIN_BANK_REF.test(value.bankRef)
    || typeof value.catalogId !== "string" || !UUID.test(value.catalogId)
    || typeof value.hasOverride !== "boolean"
    || typeof value.isActive !== "boolean"
    || typeof value.outcomeReferenced !== "boolean"
    || typeof value.source !== "string" || !ADMIN_BANK_CATALOG_SOURCES.includes(
      value.source as (typeof ADMIN_BANK_CATALOG_SOURCES)[number],
    )
    || typeof value.sourceIsActive !== "boolean"
    || !instant(value.syncedAt) || !instant(value.updatedAt)) return null;
  const content = parseAdminBankCatalogContent(Object.fromEntries(
    CONTENT_KEYS.map((key) => [key, value[key]]),
  ));
  if (content === null) return null;
  return Object.freeze({
    bankRef: value.bankRef,
    catalogId: value.catalogId,
    hasOverride: value.hasOverride,
    isActive: value.isActive,
    outcomeReferenced: value.outcomeReferenced,
    source: value.source as AdminBankCatalogEntry["source"],
    sourceIsActive: value.sourceIsActive,
    syncedAt: value.syncedAt,
    updatedAt: value.updatedAt,
    ...content,
  });
}

export function adminBankCatalogPayload(content: AdminBankCatalogContent): AdminBankCatalogPayload {
  return Object.freeze({
    application_questions: content.applicationQuestions,
    bureau_pulls: content.bureauPulls,
    channel_type: content.channel?.type ?? null,
    channel_value: content.channel?.value ?? null,
    checking_deposit_cents: content.checking.depositAmountCents,
    checking_required: content.checking.required,
    checking_seasoning: content.checking.seasoning,
    name: content.name,
    products: content.products,
    qualification_summary: content.qualificationSummary,
    rel_manager: content.relationshipManager.required,
    rel_manager_tip: content.relationshipManager.tip,
    source_updated_at: content.sourceUpdatedAt,
  });
}

type RawAdminBankCatalogRow = Readonly<{
  application_questions: unknown;
  bank_ref: unknown;
  bureau_pulls: unknown;
  catalog_id: unknown;
  channel_type: unknown;
  channel_value: unknown;
  checking_deposit_cents: unknown;
  checking_required: unknown;
  checking_seasoning: unknown;
  has_override: unknown;
  is_active: unknown;
  name: unknown;
  outcome_referenced: unknown;
  products: unknown;
  qualification_summary: unknown;
  rel_manager: unknown;
  rel_manager_tip: unknown;
  source: unknown;
  source_is_active: unknown;
  source_updated_at: unknown;
  synced_at: unknown;
  updated_at: unknown;
}>;

const DATABASE_ROW_KEYS = [
  "application_questions",
  "bank_ref",
  "bureau_pulls",
  "catalog_id",
  "channel_type",
  "channel_value",
  "checking_deposit_cents",
  "checking_required",
  "checking_seasoning",
  "has_override",
  "is_active",
  "name",
  "outcome_referenced",
  "products",
  "qualification_summary",
  "rel_manager",
  "rel_manager_tip",
  "source",
  "source_is_active",
  "source_updated_at",
  "synced_at",
  "updated_at",
] as const;

function normalizedReadProducts(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  const products: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    const product = typeof candidate === "string" ? vettedText(candidate, 120) : null;
    if (product === null || seen.has(product)) continue;
    seen.add(product);
    products.push(product);
    if (products.length === 50) break;
  }
  return Object.freeze(products);
}

function normalizedReadQuestions(value: unknown): readonly BankApplicationQuestion[] {
  const extras: BankApplicationQuestion[] = [];
  const seen = new Set<string>(STANDING_QUESTION_IDS);
  for (const candidate of Array.isArray(value) ? value : []) {
    if (extras.length === 46) break;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const question = candidate as Record<string, unknown>;
    const id = typeof question.id === "string" ? question.id.trim() : "";
    const label = typeof question.label === "string" ? vettedText(question.label, 200) : null;
    const responseBasis = typeof question.responseBasis === "string"
      ? vettedText(question.responseBasis, 500)
      : null;
    if (!QUESTION_ID.test(id) || label === null || responseBasis === null || seen.has(id)) continue;
    seen.add(id);
    extras.push(Object.freeze({ id, label, responseBasis }));
  }
  return Object.freeze(withStandingQuestions(extras));
}

function normalizedReadChannel(type: unknown, value: unknown): BankChannel | null {
  if (type !== "online" && type !== "phone" && type !== "in-person") return null;
  if (!(value === null || typeof value === "string")) return null;
  return normalizeChannel({ type, value } as BankChannel);
}

function normalizedReadText(value: unknown, max: number): string | null {
  return typeof value === "string" ? vettedText(value, max) : null;
}

export function parseAdminBankCatalogDatabaseRow(value: unknown): AdminBankCatalogEntry {
  if (!isExactRecord(value, DATABASE_ROW_KEYS)) {
    throw new Error("BANK_CATALOG_RESULT_INVALID");
  }
  const row = value as RawAdminBankCatalogRow;
  const name = normalizedReadText(row.name, 200);
  if (name === null) throw new Error("BANK_CATALOG_RESULT_INVALID");
  const parsed = parseAdminBankCatalogEntry({
    applicationQuestions: normalizedReadQuestions(row.application_questions),
    bankRef: row.bank_ref,
    bureauPulls: normalizedReadText(row.bureau_pulls, 200),
    catalogId: row.catalog_id,
    channel: normalizedReadChannel(row.channel_type, row.channel_value),
    checking: {
      depositAmountCents: typeof row.checking_deposit_cents === "number"
        && Number.isSafeInteger(row.checking_deposit_cents)
        && row.checking_deposit_cents >= 0
        && row.checking_deposit_cents <= 2_147_483_647
        ? row.checking_deposit_cents
        : null,
      required: typeof row.checking_required === "boolean" ? row.checking_required : null,
      seasoning: normalizedReadText(row.checking_seasoning, 200),
    },
    hasOverride: row.has_override,
    isActive: row.is_active,
    name,
    outcomeReferenced: row.outcome_referenced,
    products: normalizedReadProducts(row.products),
    qualificationSummary: normalizedReadText(row.qualification_summary, 500),
    relationshipManager: {
      required: typeof row.rel_manager === "boolean" ? row.rel_manager : null,
      tip: normalizedReadText(row.rel_manager_tip, 240),
    },
    source: row.source,
    sourceIsActive: row.source_is_active,
    sourceUpdatedAt: typeof row.source_updated_at === "string" && isAdminDay(row.source_updated_at)
      ? row.source_updated_at
      : null,
    syncedAt: row.synced_at,
    updatedAt: row.updated_at,
  });
  if (parsed === null) throw new Error("BANK_CATALOG_RESULT_INVALID");
  return parsed;
}
