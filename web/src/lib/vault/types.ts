/**
 * The BANK VAULT read model's contract (INTERFACES §10: `web/src/lib/vault/types.ts`
 * is this service's frozen interface path).
 *
 * Deliberately pure — no `server-only`, no Supabase, no environment. The two
 * routes import it at module scope so their `FEATURE_VAULT`-off branch can
 * answer without loading anything that could reach a database, which is the
 * ordering `web/src/app/api/banks/routes.test.ts` asserts by source position.
 *
 * VAULT-05 lives here as much as in the schema: there is no field on any type
 * below for a credit-score floor or for time in business. Those columns exist
 * in the CCA VAULT project and they stop at the driver.
 */

export const BANK_CHANNEL_TYPES = ["online", "phone", "in-person"] as const;
export type BankChannelType = (typeof BANK_CHANNEL_TYPES)[number];

/**
 * §6's channel block. The in-person arm carries no value on purpose: the detail
 * page answers it by telling the reader to research a local branch, so a value
 * there would have nowhere to render.
 */
export type BankChannel =
  | { type: "online"; value: string }
  | { type: "phone"; value: string }
  | { type: "in-person"; value: null };

export interface BankApplicationQuestion {
  id: string;
  label: string;
  responseBasis: string;
}

export interface BankChecking {
  required: boolean | null;
  depositAmountCents: number | null;
  seasoning: string | null;
}

export interface BankRelationshipManager {
  required: boolean | null;
  tip: string | null;
}

/**
 * One lender as a driver reports it, before the sync core normalizes it.
 *
 * `applicationQuestions` holds only what this lender adds; the four standing §6
 * questions are prepended by the sync so no driver can forget them.
 */
export interface VaultBankRecord {
  bankRef: string;
  name: string;
  products: readonly string[];
  bureauPulls: string | null;
  qualificationSummary: string | null;
  channel: BankChannel | null;
  checking: BankChecking;
  relationshipManager: BankRelationshipManager;
  applicationQuestions: readonly BankApplicationQuestion[];
  /** ISO date, or null when VAULT does not say. */
  sourceUpdatedAt: string | null;
  isActive: boolean;
}

export const VAULT_DRIVER_NAMES = ["fixture", "supabase"] as const;
export type VaultDriverName = (typeof VAULT_DRIVER_NAMES)[number];

/**
 * The one interface both drivers implement. Per INTERFACES §10 the driver is
 * chosen once at module load and no caller branches on it — the fixture driver
 * is a real implementation of this interface, not a test double.
 */
export interface VaultDriver {
  readonly name: VaultDriverName;
  listBanks(): Promise<readonly VaultBankRecord[]>;
}

/** The row `public.banks_cache` holds, in its own column names. */
export interface BankCacheRow {
  bank_ref: string;
  name: string;
  products: string[];
  bureau_pulls: string | null;
  qualification_summary: string | null;
  channel_type: BankChannelType | null;
  channel_value: string | null;
  checking_required: boolean | null;
  checking_deposit_cents: number | null;
  checking_seasoning: string | null;
  rel_manager: boolean | null;
  rel_manager_tip: string | null;
  application_questions: BankApplicationQuestion[];
  source_updated_at: string | null;
  is_active: boolean;
  source: "vault" | "fixture" | "backfill" | "manual";
  synced_at: string;
}

export const BANK_WINDOW_KEYS = ["d30", "d60", "d90", "d183", "d365"] as const;
export type BankWindowKey = (typeof BANK_WINDOW_KEYS)[number];

export type BankHeatLevel = "hot" | "warm" | "cold";

/** A window exactly as `bank_outcome_stats.windows` stores it. */
export interface BankWindowCounts {
  approved: number;
  denied: number;
  withdrawn: number;
  approved_amount_cents: number;
}

/** The same window as the surface reads it. Money is dollars, rate is 0–100. */
export interface BankWindowSummary {
  outcomes: number;
  approvals: number;
  approvalRate: number;
  fundedCount: number;
  fundedAmount: number;
  averageFundedAmount: number;
}

/**
 * A row of `public.bank_read_model`, in the repository's column names. `windows`
 * and every other stats field is null for a lender with no counted outcome,
 * which is a fact about the lender rather than a missing row.
 */
export interface BankReadModelRow extends Omit<BankCacheRow, "is_active" | "source"> {
  heat_level: BankHeatLevel | null;
  windows: Record<BankWindowKey, BankWindowCounts> | null;
  last_outcome_at: string | null;
  approved_amount_cents_total: number | null;
  outcome_count_total: number | null;
}

/** What `GET /api/banks` serves per lender. */
export interface BankListRow {
  bankRef: string;
  name: string;
  products: readonly string[];
  bureauPulls: string | null;
  qualificationSummary: string | null;
  heatLevel: BankHeatLevel | null;
  lastOutcomeAt: string | null;
  windows: Record<BankWindowKey, BankWindowSummary>;
}

/** What `GET /api/banks/[ref]` serves: the list row plus §6's four blocks. */
export interface BankDetailPayload extends BankListRow {
  channel: BankChannel | null;
  checking: BankChecking;
  relationshipManager: BankRelationshipManager;
  applicationQuestions: readonly BankApplicationQuestion[];
  sourceUpdatedAt: string | null;
}

export type VaultErrorCode = "disabled" | "not_found" | "configuration_error" | "failed";

export class VaultError extends Error {
  readonly code: VaultErrorCode;

  constructor(code: VaultErrorCode, message = code) {
    super(message);
    this.name = "VaultError";
    this.code = code;
  }
}

/**
 * The four states a durable Bank Vault read can be in, named the way the fee
 * and tracker rails main merged name theirs. Lives here rather than beside the
 * hooks so a frozen surface component can branch on it without importing a
 * client module. `idle` means the flag is off — the only state in which the
 * illustrative fixtures are the honest thing to render.
 */
export type VaultReadState = "idle" | "loading" | "ready" | "failed";
