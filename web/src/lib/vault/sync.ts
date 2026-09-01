import { complianceLanguageCodes } from "../compliance/language-rules.mjs";

import { withStandingQuestions } from "./standing-questions.ts";
import { mentionsExcludedCriteria } from "./vault05-text.ts";
import {
  BANK_CHANNEL_TYPES,
  type BankApplicationQuestion,
  type BankCacheRow,
  type BankChannel,
  type VaultBankRecord,
} from "./types.ts";

/**
 * The normalization both drivers feed.
 *
 * Everything a driver hands over is treated as untrusted: VAULT is the client's
 * own database, edited by their team, and its free-text fields have never been
 * through this platform's copy rules. So the sync is the boundary — it composes
 * the standing questions, bounds every string, and drops any prose that trips a
 * compliance rule rather than storing it and hoping no surface renders it.
 *
 * Pure and database-free on purpose: the mapping is the part most likely to be
 * wrong, and it is testable without a driver, a key or a Postgres.
 */

/** §6 calls the relationship-manager tip a one-line tip; the column caps at 240. */
const TIP_MAX = 240;
const NAME_MAX = 200;
const SHORT_TEXT_MAX = 200;
const BANK_REF_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class VaultSyncRejection extends Error {
  readonly bankRef: string;
  readonly reason: string;

  constructor(bankRef: string, reason: string) {
    super(`${bankRef}: ${reason}`);
    this.name = "VaultSyncRejection";
    this.bankRef = bankRef;
    this.reason = reason;
  }
}

/**
 * VAULT prose is authored in a Markdown-capable knowledge base, while the
 * operator surface deliberately renders plain text. Normalise that boundary so
 * formatting tokens and source-system record handles never become operator
 * copy. This is also used while reading the cache because rows written before
 * this normaliser shipped must be safe immediately, without waiting for the
 * next nightly sync.
 */
export function surfacePlainText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/\[([^\]]+)]\((?:https?:\/\/|\/)[^)]+\)/g, "$1")
    .replace(/\(\s*HowToCredit\s+`[^`]+`\s*\)/gi, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(?:^|\n)\s*(?:[-*+] |\d+[.)] )/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1");
  if (text.length === 0) return null;
  return text;
}

function trimmed(value: string | null | undefined, max: number): string | null {
  const text = surfacePlainText(value);
  if (text === null) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * Free text that will reach a surface. A string is dropped whole rather than
 * edited: cutting the matched words out of a refused sentence usually leaves a
 * sentence that still means the refused thing, and the detail page renders a
 * missing tip perfectly well.
 *
 * Two filters, both of which have to pass. VAULT-05 runs first and is the wider
 * one — the platform copy rules say nothing about score floors or
 * time-in-business, so a sentence stating either would sail through them. Every
 * free-text field in a cache row goes through here, which is what makes the
 * exclusion a property of the sync rather than of any one driver.
 */
export function vettedText(value: string | null | undefined, max: number): string | null {
  const text = trimmed(value, max);
  if (text === null) return null;
  if (mentionsExcludedCriteria(text)) return null;
  return complianceLanguageCodes(text).length > 0 ? null : text;
}

export function normalizeChannel(channel: BankChannel | null | undefined): BankChannel | null {
  if (!channel || !BANK_CHANNEL_TYPES.includes(channel.type)) return null;
  if (channel.type === "in-person") return { type: "in-person", value: null };
  const value = trimmed(channel.value, 500);
  if (value === null) return null;
  // An online channel whose value is not a link is not an online channel: the
  // detail page renders it as an anchor, and `javascript:` or a bare word in
  // that position is either inert or dangerous.
  if (channel.type === "online" && !/^https:\/\//i.test(value)) return null;
  if (channel.type === "phone" && !/^[+0-9][0-9\s().-]{5,}$/.test(value)) return null;
  return { type: channel.type, value };
}

function normalizeQuestions(
  extras: readonly BankApplicationQuestion[],
): BankApplicationQuestion[] {
  const cleaned: BankApplicationQuestion[] = [];
  for (const question of extras) {
    const id = trimmed(question?.id, 64);
    const label = vettedText(question?.label, SHORT_TEXT_MAX);
    const responseBasis = vettedText(question?.responseBasis, 500);
    // All three or none. A question with a label and no basis renders as a row
    // that asks something and explains nothing.
    if (id === null || label === null || responseBasis === null) continue;
    cleaned.push({ id, label, responseBasis });
  }
  return withStandingQuestions(cleaned);
}

function normalizeProducts(products: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const product of products ?? []) {
    const text = vettedText(product, 120);
    if (text === null || seen.has(text)) continue;
    seen.add(text);
    cleaned.push(text);
  }
  return cleaned;
}

function nonNegativeInteger(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/**
 * One VAULT record becomes one cache row. Throws rather than silently skipping
 * when the lender has no usable identity: a bank with no handle or no name is a
 * bug upstream, and swallowing it would make a shrinking catalog look healthy.
 */
export function toCacheRow(
  record: VaultBankRecord,
  options: { source: BankCacheRow["source"]; syncedAt: string },
): BankCacheRow {
  const bankRef = typeof record?.bankRef === "string" ? record.bankRef.trim() : "";
  if (!BANK_REF_PATTERN.test(bankRef)) {
    throw new VaultSyncRejection(String(record?.bankRef ?? ""), "bank handle is not a lender slug");
  }
  const name = vettedText(record.name, NAME_MAX);
  if (name === null) {
    throw new VaultSyncRejection(bankRef, "lender has no usable name");
  }

  const channel = normalizeChannel(record.channel);
  const sourceUpdatedAt =
    typeof record.sourceUpdatedAt === "string" && ISO_DATE_PATTERN.test(record.sourceUpdatedAt)
      ? record.sourceUpdatedAt
      : null;

  return {
    bank_ref: bankRef,
    name,
    products: normalizeProducts(record.products),
    bureau_pulls: vettedText(record.bureauPulls, SHORT_TEXT_MAX),
    qualification_summary: vettedText(record.qualificationSummary, 500),
    channel_type: channel?.type ?? null,
    channel_value: channel?.value ?? null,
    checking_required:
      typeof record.checking?.required === "boolean" ? record.checking.required : null,
    checking_deposit_cents: nonNegativeInteger(record.checking?.depositAmountCents),
    checking_seasoning: vettedText(record.checking?.seasoning, SHORT_TEXT_MAX),
    rel_manager:
      typeof record.relationshipManager?.required === "boolean"
        ? record.relationshipManager.required
        : null,
    rel_manager_tip: vettedText(record.relationshipManager?.tip, TIP_MAX),
    application_questions: normalizeQuestions(record.applicationQuestions ?? []),
    source_updated_at: sourceUpdatedAt,
    // A lender VAULT has stopped publishing is unpublished, never deleted —
    // migration 383's foreign key depends on the row surviving.
    is_active: record.isActive !== false,
    source: options.source,
    synced_at: options.syncedAt,
  };
}

export interface VaultSyncPlan {
  rows: BankCacheRow[];
  rejected: { bankRef: string; reason: string }[];
}

/**
 * Every record the driver returned, normalized. A record that cannot be made
 * into a row is reported rather than thrown past the caller, so one broken
 * lender upstream does not stop the other forty-six syncing.
 */
export function planSync(
  records: readonly VaultBankRecord[],
  options: { source: BankCacheRow["source"]; syncedAt: string },
): VaultSyncPlan {
  const rows: BankCacheRow[] = [];
  const rejected: { bankRef: string; reason: string }[] = [];
  const seen = new Set<string>();

  for (const record of records) {
    try {
      const row = toCacheRow(record, options);
      if (seen.has(row.bank_ref)) {
        rejected.push({ bankRef: row.bank_ref, reason: "duplicate lender handle in one run" });
        continue;
      }
      seen.add(row.bank_ref);
      rows.push(row);
    } catch (error) {
      const rejection = error instanceof VaultSyncRejection
        ? error
        : new VaultSyncRejection("unknown", "record could not be normalized");
      rejected.push({ bankRef: rejection.bankRef, reason: rejection.reason });
    }
  }

  return { rows, rejected };
}
