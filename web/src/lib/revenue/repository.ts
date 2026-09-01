import { createAdminClient } from "@/lib/supabase/admin";

import { isRevenueIncompleteCode } from "./config.ts";

import type {
  PostBillingAccrualResult,
  RevenueAccrualInputs,
  RevenueKpis,
  LedgerKind,
  RevenueRepository,
  RevenueRpcClient,
  SaasReferralInput,
  SettlementMarkInput,
  SettlementMarkVerdict,
  SettlementRow,
  SettlementRepository,
  SettlementStatus,
} from "./types.ts";

type Row = Record<string, unknown>;

export class RevenueRepositoryError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "RevenueRepositoryError";
    this.code = code;
  }
}

function rows(value: unknown): Row[] {
  if (Array.isArray(value)) return value.filter((row): row is Row => !!row && typeof row === "object");
  return value && typeof value === "object" ? [value as Row] : [];
}

function text(row: Row, key: string): string | null {
  return typeof row[key] === "string" ? row[key] : null;
}

function integer(row: Row, key: string): number | null {
  const value = row[key];
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function numberValue(row: Row, key: string): number | null {
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function object(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
}

function settlementStatus(value: unknown): SettlementStatus | null {
  return value === "accrued" || value === "exported" || value === "paid" || value === "reversed"
    ? value
    : null;
}

function settlementRow(value: unknown, expectedKind: LedgerKind, expectedId: string): SettlementRow | null {
  const row = object(value);
  const ledger = row ? text(row, "ledger") : null;
  const ledgerId = row ? text(row, "ledger_id") : null;
  const status = row ? settlementStatus(row.status) : null;
  if (ledger !== expectedKind || ledgerId !== expectedId || !status) return null;
  return { ledger, ledgerId, status };
}

function databaseFailure(error: { code?: string | null } | null): never {
  throw new RevenueRepositoryError(error?.code ? "REVENUE_DATABASE_ERROR" : "REVENUE_DATABASE_ERROR");
}

function parseReferral(value: unknown): SaasReferralInput | null {
  const row = object(value);
  if (!row) return null;
  const base = text(row, "base");
  const months = integer(row, "months");
  const pct = numberValue(row, "pct");
  const id = text(row, "id");
  const referrerOrgId = text(row, "referrer_org_id");
  const referredOrgId = text(row, "referred_org_id");
  const startedAt = text(row, "started_at");
  if (
    (base !== "platform_subscription" && base !== "consumer_subscriptions")
    || months !== 12 || pct === null || !id || !referrerOrgId || !referredOrgId || !startedAt
  ) throw new RevenueRepositoryError("REVENUE_INPUT_INVALID");
  return { base, id, months, pct, referredOrgId, referrerOrgId, startedAt };
}

export function createRevenueRepository(client: RevenueRpcClient): RevenueRepository & SettlementRepository {
  return {
    async listAccrualOrgIds() {
      const { data, error } = await client.rpc("revenue_list_accrual_orgs", {});
      if (error) databaseFailure(error);
      return rows(data).map((row) => text(row, "operator_org_id")).filter((id): id is string => !!id);
    },

    async readAccrualInputs(operatorOrgId, accrualMonth) {
      const { data, error } = await client.rpc("revenue_read_accrual_inputs", {
        p_accrual_month: accrualMonth,
        p_operator_org_id: operatorOrgId,
      });
      if (error) databaseFailure(error);
      const row = rows(data)[0];
      if (!row) throw new RevenueRepositoryError("REVENUE_INPUT_MISSING");
      const returnedOrgId = text(row, "operator_org_id");
      const orgBasePriceCents = integer(row, "org_base_price_cents");
      const orgSeatPriceCents = integer(row, "org_seat_price_cents");
      const refundAmountCents = integer(row, "refund_amount_cents");
      if (
        returnedOrgId !== operatorOrgId || orgBasePriceCents === null || orgSeatPriceCents === null ||
        refundAmountCents === null || refundAmountCents < 0
      ) {
        throw new RevenueRepositoryError("REVENUE_INPUT_INVALID");
      }
      const subscription = object(row.operator_subscription);
      const consumerRows = Array.isArray(row.consumer_subscriptions) ? row.consumer_subscriptions : [];
      return {
        consumerSubscriptions: consumerRows.map((value) => {
          const item = object(value);
          const provider = item ? text(item, "provider") : null;
          const priceCents = item ? integer(item, "price_cents") : null;
          if ((provider !== "mock" && provider !== "stripe") || priceCents === null || priceCents < 0) {
            throw new RevenueRepositoryError("REVENUE_INPUT_INVALID");
          }
          return { provider, priceCents };
        }),
        operatorOrgId,
        operatorSubscription: subscription ? {
          provider: text(subscription, "provider") === "mock" ? "mock" : "stripe",
          seatQuantity: integer(subscription, "seat_quantity") ?? 0,
          status: text(subscription, "status") ?? "incomplete",
        } : null,
        orgBasePriceCents,
        orgSeatPriceCents,
        referral: parseReferral(row.referral),
        refundAmountCents,
      } satisfies RevenueAccrualInputs;
    },

    async postBillingAccrual(input) {
      const { data, error } = await client.rpc("revenue_post_billing_accrual", {
        p_accrual_month: input.accrualMonth,
        p_operator_amount_cents: input.operator.amountCents,
        p_operator_base_amount_cents: input.operator.baseAmountCents,
        p_operator_incomplete_code: input.operator.incompleteCode,
        p_operator_is_complete: input.operator.isComplete,
        p_operator_org_id: input.operator.operatorOrgId,
        p_operator_pct_snapshot: input.operator.pctSnapshot,
        p_operator_source_row_count: input.operator.sourceRowCount,
        p_referral_snapshots: input.referrals.map((snapshot) => ({
          accrual_month: snapshot.accrualMonth,
          amount_cents: snapshot.amountCents,
          base_amount_cents: snapshot.baseAmountCents,
          base_snapshot: snapshot.baseSnapshot,
          cycle_number: snapshot.cycleNumber,
          incomplete_code: snapshot.incompleteCode,
          is_complete: snapshot.isComplete,
          pct_snapshot: snapshot.pctSnapshot,
          referred_org_id: snapshot.referredOrgId,
          referrer_org_id: snapshot.referrerOrgId,
          saas_referral_id: snapshot.saasReferralId,
          source_row_count: snapshot.sourceRowCount,
        })),
      });
      if (error) databaseFailure(error);
      const row = rows(data)[0] ?? {};
      const operatorRows = integer(row, "operator_rows");
      const referralRows = integer(row, "referral_rows");
      if (operatorRows === null || referralRows === null) throw new RevenueRepositoryError("REVENUE_POST_INVALID");
      return { operatorRows, referralRows } satisfies PostBillingAccrualResult;
    },

    async readSettlementStatus(kind, ledgerId) {
      const { data, error } = await client.rpc("revenue_read_settlement_status", {
        p_ledger_id: ledgerId,
        p_ledger_kind: kind,
      });
      if (error) databaseFailure(error);
      if (data === null) return null;
      const parsed = settlementRow(data, kind, ledgerId);
      if (!parsed) throw new RevenueRepositoryError("SETTLEMENT_RESPONSE_INVALID");
      return parsed;
    },

    async markSettlement(input: SettlementMarkInput): Promise<SettlementMarkVerdict> {
      const { data, error } = await client.rpc("revenue_mark_settlement", {
        p_actor_id: input.actorId,
        p_expected_status: input.expectedStatus,
        p_ledger_id: input.ledgerId,
        p_ledger_kind: input.ledger,
        p_status: input.status,
      });
      if (error) databaseFailure(error);
      const row = object(data);
      if (!row || row.ledger !== input.ledger || row.ledger_id !== input.ledgerId) {
        throw new RevenueRepositoryError("SETTLEMENT_RESPONSE_INVALID");
      }
      if (row.applied === true && row.reason_code === "applied") {
        const parsed = settlementRow(row, input.ledger, input.ledgerId);
        if (!parsed || parsed.status !== input.status) {
          throw new RevenueRepositoryError("SETTLEMENT_RESPONSE_INVALID");
        }
        return { applied: true, row: parsed };
      }
      if (row.applied === false && row.reason_code === "not_found") {
        return { applied: false, reason: "not_found", row: null };
      }
      if (row.applied === false && row.reason_code === "stale") {
        const parsed = settlementRow(row, input.ledger, input.ledgerId);
        if (!parsed) throw new RevenueRepositoryError("SETTLEMENT_RESPONSE_INVALID");
        return { applied: false, reason: "stale", row: parsed };
      }
      if (row.applied === false && row.reason_code === "incomplete") {
        const parsed = settlementRow(row, input.ledger, input.ledgerId);
        if (!parsed) throw new RevenueRepositoryError("SETTLEMENT_RESPONSE_INVALID");
        return { applied: false, reason: "incomplete", row: parsed };
      }
      throw new RevenueRepositoryError("SETTLEMENT_RESPONSE_INVALID");
    },
  };
}

export function productionRevenueRepository(): RevenueRepository & SettlementRepository {
  return createRevenueRepository(createAdminClient() as unknown as RevenueRpcClient);
}

export async function readRevenueKpiRow(
  accrualMonth: string,
  client: RevenueRpcClient,
): Promise<RevenueKpis> {
  const { data, error } = await client.rpc("revenue_read_kpis", { p_accrual_month: accrualMonth });
  if (error) databaseFailure(error);
  const row = rows(data)[0];
  if (!row) throw new RevenueRepositoryError("REVENUE_KPI_INVALID");
  const monitoring = integer(row, "monitoring_share_total_cents");
  const referral = integer(row, "saas_referral_total_cents");
  if (monitoring === null || referral === null || monitoring < 0 || referral < 0 || typeof row.is_complete !== "boolean") {
    throw new RevenueRepositoryError("REVENUE_KPI_INVALID");
  }
  const rawCodes = Array.isArray(row.incomplete_codes) ? row.incomplete_codes : [];
  if (!rawCodes.every(isRevenueIncompleteCode)) throw new RevenueRepositoryError("REVENUE_KPI_INVALID");
  return {
    complete: row.is_complete,
    incompleteCodes: [...new Set(rawCodes)].sort(),
    monitoringShareTotalCents: monitoring,
    saasReferralTotalCents: referral,
  };
}
