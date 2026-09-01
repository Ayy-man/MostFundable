import type {
  BankApplicationQuestion,
  BankChannel,
  BankChecking,
  BankRelationshipManager,
} from "@/lib/vault/types";

export const ADMIN_BANK_CATALOG_SOURCES = [
  "backfill",
  "fixture",
  "manual",
  "vault",
] as const;

export type AdminBankCatalogSource = (typeof ADMIN_BANK_CATALOG_SOURCES)[number];

export type AdminBankCatalogContent = Readonly<{
  applicationQuestions: readonly BankApplicationQuestion[];
  bureauPulls: string | null;
  channel: BankChannel | null;
  checking: BankChecking;
  name: string;
  products: readonly string[];
  qualificationSummary: string | null;
  relationshipManager: BankRelationshipManager;
  sourceUpdatedAt: string | null;
}>;

export type AdminBankCatalogCreateInput = AdminBankCatalogContent & Readonly<{
  bankRef: string;
}>;

export type AdminBankCatalogEntry = AdminBankCatalogCreateInput & Readonly<{
  catalogId: string;
  hasOverride: boolean;
  isActive: boolean;
  outcomeReferenced: boolean;
  source: AdminBankCatalogSource;
  sourceIsActive: boolean;
  syncedAt: string;
  updatedAt: string;
}>;

export type AdminBankCatalogStatusAction = "archive" | "reactivate";

/** Exact JSON shape accepted by migration 420's service-only mutation RPCs. */
export type AdminBankCatalogPayload = Readonly<{
  application_questions: readonly BankApplicationQuestion[];
  bureau_pulls: string | null;
  channel_type: BankChannel["type"] | null;
  channel_value: string | null;
  checking_deposit_cents: number | null;
  checking_required: boolean | null;
  checking_seasoning: string | null;
  name: string;
  products: readonly string[];
  qualification_summary: string | null;
  rel_manager: boolean | null;
  rel_manager_tip: string | null;
  source_updated_at: string | null;
}>;

export interface AdminBankCatalogRepository {
  create(actorId: string, input: AdminBankCatalogCreateInput): Promise<AdminBankCatalogEntry>;
  list(): Promise<readonly AdminBankCatalogEntry[]>;
  setStatus(
    actorId: string,
    bankRef: string,
    isActive: boolean,
  ): Promise<AdminBankCatalogEntry>;
  update(
    actorId: string,
    bankRef: string,
    content: AdminBankCatalogContent,
  ): Promise<AdminBankCatalogEntry>;
}

export class AdminBankCatalogError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string) {
    super(code);
    this.name = "AdminBankCatalogError";
    this.code = code;
    this.status = status;
  }
}
