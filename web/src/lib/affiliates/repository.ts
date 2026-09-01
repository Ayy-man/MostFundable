import type {
  AffiliateLifecyclePatch,
  AffiliateLifecycleResult,
  AffiliatePaymentStatus,
  AffiliateRosterEntry,
  AffiliateRosterRow,
  AffiliateStatementRow,
  AffiliateUpdateResult,
  AffiliateViewRow,
  AffiliateShareResult,
  UpdateShareBody,
} from "@/lib/affiliates/types";
import {
  AFFILIATE_PAYMENT_STATUSES,
  AFFILIATE_STAGES,
  AffiliateError,
} from "@/lib/affiliates/types";

export const AFFILIATE_VIEW_COLUMNS =
  "started_at,stage,funded_amount_cents,expected_commission_cents,payment_status";

type DbError = { code?: string | null };
type DbResponse<T> = PromiseLike<{ data: T | null; error: DbError | null }>;
type ViewQuery = DbResponse<AffiliateViewRow[]> & {
  select(columns: string): DbResponse<AffiliateViewRow[]>;
};
export type AffiliateDatabaseClient = {
  from(table: "affiliate_client_view"): ViewQuery;
  rpc(name: string, args: Record<string, unknown>): DbResponse<unknown>;
};

export type AffiliateRepository = {
  referralValid(code: string): Promise<boolean>;
  listPortalRows(): Promise<AffiliateViewRow[]>;
  listOperatorRoster(): Promise<AffiliateRosterEntry[]>;
  getOperatorStatement(affiliateId: string): Promise<AffiliateStatementRow[]>;
  updateAffiliate(affiliateId: string, patch: AffiliateLifecyclePatch): Promise<AffiliateLifecycleResult>;
  shareClient(affiliateId: string, clientId: string): Promise<AffiliateShareResult>;
  unshareClient(affiliateId: string, clientId: string): Promise<boolean>;
  updateShare(affiliateId: string, clientId: string, patch: UpdateShareBody): Promise<AffiliateUpdateResult>;
};

function failure(error: DbError | null): never {
  if (error?.code === "P0002" || error?.code === "42501") {
    throw new AffiliateError("not_found", "Affiliate share not found.");
  }
  throw new AffiliateError("unexpected", "The affiliate request could not be completed.");
}

function firstRow(data: unknown): Record<string, unknown> {
  const row = Array.isArray(data) ? data[0] : data;
  if (typeof row !== "object" || row === null) failure(null);
  return row as Record<string, unknown>;
}

function shareRow(data: unknown) {
  const row = firstRow(data);
  if (
    typeof row.affiliate_id !== "string" ||
    typeof row.client_id !== "string" ||
    (row.expected_commission_cents !== null && typeof row.expected_commission_cents !== "number") ||
    typeof row.payment_status !== "string"
  ) failure(null);
  return {
    affiliateId: row.affiliate_id as string,
    clientId: row.client_id as string,
    expectedCommissionCents: row.expected_commission_cents as number | null,
    paymentStatus: row.payment_status as AffiliatePaymentStatus,
  };
}

function recordValue(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) failure(null);
  return value as Record<string, unknown>;
}

function nonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function rosterRow(value: unknown): AffiliateRosterEntry {
  const row = recordValue(value);
  if (
    typeof row.affiliate_id !== "string" ||
    typeof row.profile_id !== "string" ||
    typeof row.name !== "string" ||
    typeof row.email !== "string" ||
    typeof row.referral_slug !== "string" ||
    typeof row.active !== "boolean" ||
    !nonnegativeInteger(row.default_commission_bps) ||
    !nonnegativeInteger(row.shared_clients) ||
    !nonnegativeInteger(row.expected_commission_cents) ||
    !nonnegativeInteger(row.paid_commission_cents)
  ) failure(null);
  return {
    affiliateId: row.affiliate_id as string,
    profileId: row.profile_id as string,
    name: row.name as string,
    email: row.email as string,
    referralSlug: row.referral_slug as string,
    active: row.active as boolean,
    defaultCommissionBps: row.default_commission_bps as number,
    sharedClients: row.shared_clients as number,
    expectedCommissionCents: row.expected_commission_cents as number,
    paidCommissionCents: row.paid_commission_cents as number,
  };
}

function statementRow(value: unknown): AffiliateStatementRow {
  const row = recordValue(value);
  if (
    typeof row.affiliate_id !== "string" ||
    typeof row.client_id !== "string" ||
    typeof row.client_name !== "string" ||
    typeof row.started_at !== "string" ||
    typeof row.stage !== "string" ||
    !AFFILIATE_STAGES.includes(row.stage as AffiliateStatementRow["stage"]) ||
    !nonnegativeInteger(row.funded_amount_cents) ||
    !nonnegativeInteger(row.expected_commission_cents) ||
    typeof row.payment_status !== "string" ||
    !AFFILIATE_PAYMENT_STATUSES.includes(row.payment_status as AffiliatePaymentStatus) ||
    typeof row.commission_override !== "boolean"
  ) failure(null);
  return {
    affiliateId: row.affiliate_id as string,
    clientId: row.client_id as string,
    clientName: row.client_name as string,
    startedAt: row.started_at as string,
    stage: row.stage as AffiliateStatementRow["stage"],
    fundedAmountCents: row.funded_amount_cents as number,
    expectedCommissionCents: row.expected_commission_cents as number,
    paymentStatus: row.payment_status as AffiliatePaymentStatus,
    commissionOverride: row.commission_override as boolean,
  };
}

function lifecycleRow(value: unknown): AffiliateLifecycleResult {
  const row = recordValue(value);
  if (
    typeof row.affiliate_id !== "string" ||
    typeof row.active !== "boolean" ||
    !nonnegativeInteger(row.default_commission_bps) ||
    typeof row.changed !== "boolean"
  ) failure(null);
  return {
    affiliateId: row.affiliate_id as string,
    active: row.active as boolean,
    defaultCommissionBps: row.default_commission_bps as number,
    changed: row.changed as boolean,
  };
}

async function defaultClient(): Promise<AffiliateDatabaseClient> {
  const { createClient } = await import("@/lib/supabase/server");
  return (await createClient()) as unknown as AffiliateDatabaseClient;
}

export function createAffiliateRepository(
  supplied?: AffiliateDatabaseClient,
): AffiliateRepository {
  const client = async () => supplied ?? defaultClient();
  return {
    async referralValid(code) {
      const { data, error } = await (await client()).rpc("affiliate_referral_valid", { p_aff: code });
      if (error || typeof data !== "boolean") failure(error);
      return data as boolean;
    },
    async listPortalRows() {
      const { data, error } = await (await client())
        .from("affiliate_client_view")
        .select(AFFILIATE_VIEW_COLUMNS);
      if (error || !Array.isArray(data)) failure(error);
      return data as AffiliateViewRow[];
    },
    async listOperatorRoster() {
      const { data, error } = await (await client()).rpc("operator_affiliate_roster", {});
      if (error || !Array.isArray(data)) failure(error);
      return (data as AffiliateRosterRow[]).map(rosterRow);
    },
    async getOperatorStatement(affiliateId) {
      const { data, error } = await (await client()).rpc("operator_affiliate_statement", {
        p_affiliate_id: affiliateId,
      });
      if (error || !Array.isArray(data)) failure(error);
      return data.map(statementRow);
    },
    async updateAffiliate(affiliateId, patch) {
      const { data, error } = await (await client()).rpc("operator_affiliate_update", {
        p_affiliate_id: affiliateId,
        p_patch: patch,
      });
      if (error) failure(error);
      return lifecycleRow(firstRow(data));
    },
    async shareClient(affiliateId, clientId) {
      const { data, error } = await (await client()).rpc("affiliate_share_client", {
        p_affiliate_id: affiliateId,
        p_client_id: clientId,
      });
      if (error) failure(error);
      const row = firstRow(data);
      return { ...shareRow(row), inserted: row.inserted === true };
    },
    async unshareClient(affiliateId, clientId) {
      const { data, error } = await (await client()).rpc("affiliate_unshare_client", {
        p_affiliate_id: affiliateId,
        p_client_id: clientId,
      });
      if (error || typeof data !== "boolean") failure(error);
      return data as boolean;
    },
    async updateShare(affiliateId, clientId, patch) {
      const { data, error } = await (await client()).rpc("affiliate_update_share", {
        p_affiliate_id: affiliateId,
        p_client_id: clientId,
        p_patch: patch,
      });
      if (error) failure(error);
      const row = firstRow(data);
      return { ...shareRow(row), changed: row.changed === true };
    },
  };
}
