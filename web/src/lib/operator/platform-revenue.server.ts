import "server-only";

import type {
  ConsumerPlanStatus,
  OperatorPlatformRevenue,
  OperatorPlanRosterRow,
  OperatorRevenueLedgerMonth,
} from "./platform-revenue.types.ts";
import { CONSUMER_PLAN_STATUSES } from "./platform-revenue.types.ts";

interface Session {
  readonly id: string;
  readonly orgId: string;
  readonly orgRole: string | null;
}

export interface OperatorPlatformRevenueDependencies {
  read(orgId: string, month: string): Promise<OperatorPlatformRevenue>;
  requireOperator(): Promise<Session>;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const privateHeaders = { "Cache-Control": "private, no-store" };

function cents(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function decimal(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
}

function planStatus(value: unknown): ConsumerPlanStatus | null {
  return typeof value === "string" && CONSUMER_PLAN_STATUSES.some((status) => status === value)
    ? value as ConsumerPlanStatus
    : null;
}

async function read(orgId: string, month: string): Promise<OperatorPlatformRevenue> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();
  const { data: clients, error: clientsError } = await db
    .from("clients")
    .select("id, display_name")
    .eq("org_id", orgId)
    .eq("status", "active")
    .order("display_name", { ascending: true })
    .limit(1000);
  if (clientsError || !Array.isArray(clients)) throw new Error("OPERATOR_REVENUE_CLIENTS_FAILED");
  const clientIds = clients.map((client) => client.id);
  const subscriptionsPromise = clientIds.length === 0
    ? Promise.resolve({ data: [], error: null })
    : db
        .from("consumer_subscriptions")
        .select("client_id, status, price_cents, currency, activated_at, cancelled_at, updated_at")
        .in("client_id", clientIds);
  const ledgerPromise = db
    .from("operator_earnings_ledger")
    .select("base_amount_cents, pct_snapshot, amount_cents, source_row_count, is_complete, incomplete_code, settlement_status")
    .eq("operator_org_id", orgId)
    .eq("accrual_month", `${month}-01`)
    .maybeSingle();
  const [subscriptionsResult, ledgerResult] = await Promise.all([subscriptionsPromise, ledgerPromise]);
  if (subscriptionsResult.error || !Array.isArray(subscriptionsResult.data) || ledgerResult.error) {
    throw new Error("OPERATOR_REVENUE_READ_FAILED");
  }

  const subscriptionByClient = new Map(subscriptionsResult.data.map((row) => [row.client_id, row]));
  const roster: OperatorPlanRosterRow[] = clients.map((client) => {
    const subscription = subscriptionByClient.get(client.id);
    return Object.freeze({
      activatedAt: subscription?.activated_at ?? null,
      cancelledAt: subscription?.cancelled_at ?? null,
      clientId: client.id,
      clientName: client.display_name,
      currency: subscription?.currency ?? null,
      priceCents: subscription === undefined ? null : cents(subscription.price_cents),
      status: planStatus(subscription?.status),
      updatedAt: subscription?.updated_at ?? null,
    });
  });

  let ledger: OperatorRevenueLedgerMonth | null = null;
  if (ledgerResult.data !== null) {
    const baseAmountCents = cents(ledgerResult.data.base_amount_cents);
    const amountCents = ledgerResult.data.amount_cents === null ? null : cents(ledgerResult.data.amount_cents);
    const pctSnapshot = ledgerResult.data.pct_snapshot === null ? null : decimal(ledgerResult.data.pct_snapshot);
    const sourceRowCount = cents(ledgerResult.data.source_row_count);
    const settlementStatus = ledgerResult.data.settlement_status;
    if (baseAmountCents === null || sourceRowCount === null
        || (ledgerResult.data.amount_cents !== null && amountCents === null)
        || (ledgerResult.data.pct_snapshot !== null && pctSnapshot === null)
        || !["accrued", "exported", "paid", "reversed"].includes(settlementStatus)) {
      throw new Error("OPERATOR_REVENUE_LEDGER_INVALID");
    }
    ledger = Object.freeze({
      amountCents,
      baseAmountCents,
      incompleteCode: ledgerResult.data.incomplete_code,
      isComplete: ledgerResult.data.is_complete,
      pctSnapshot,
      settlementStatus: settlementStatus as OperatorRevenueLedgerMonth["settlementStatus"],
      sourceRowCount,
    });
  }
  return Object.freeze({ ledger, month, roster: Object.freeze(roster) });
}

async function defaults(): Promise<OperatorPlatformRevenueDependencies> {
  const { requireOrgMember } = await import("@/lib/auth/session");
  return { read, requireOperator: requireOrgMember };
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: privateHeaders });
}

function accessStatus(value: unknown): 401 | 403 | null {
  if (typeof value !== "object" || value === null || !("status" in value)) return null;
  const status = (value as { status?: unknown }).status;
  return status === 401 || status === 403 ? status : null;
}

export async function handleOperatorPlatformRevenue(
  request: Request,
  supplied?: OperatorPlatformRevenueDependencies,
): Promise<Response> {
  const dependencies = supplied ?? await defaults();
  try {
    const session = await dependencies.requireOperator();
    if (session.orgRole !== "owner" && session.orgRole !== "admin") {
      return json({ error: { code: "role_forbidden", message: "Only workspace owners and admins can view platform revenue." } }, 403);
    }
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some((key) => key !== "month")) return json({ error: { code: "invalid_request", message: "The platform revenue filter is not supported." } }, 400);
    const now = new Date();
    const fallback = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const month = params.get("month") ?? fallback;
    if (!MONTH.test(month)) return json({ error: { code: "invalid_request", message: "month must use YYYY-MM." } }, 400);
    return json(await dependencies.read(session.orgId, month));
  } catch (caught) {
    const status = accessStatus(caught);
    if (status !== null) return json({ error: { code: status === 401 ? "session_required" : "role_forbidden", message: status === 401 ? "Sign in to view platform revenue." : "This account cannot view platform revenue." } }, status);
    return json({ error: { code: "platform_revenue_unavailable", message: "Platform revenue is temporarily unavailable." } }, 500);
  }
}
