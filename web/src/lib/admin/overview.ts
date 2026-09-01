import "server-only";

/**
 * Platform-wide headline figures for the admin Overview strip. These read
 * across every tenant, so they go through the service-scoped admin client the
 * other admin repositories use — the same injectable `createClient` /
 * `defaultClient` shape as analytics-repository.ts, so the reads stay
 * unit-testable with a fake client.
 */

export type AdminOverviewCounts = {
  operators: number;
  consumers: number;
  analyses: number;
};

type CountPayload = { count: number | null; error: unknown };
interface CountQuery extends PromiseLike<CountPayload> {
  eq(column: string, value: unknown): CountQuery;
  not(column: string, operator: string, value: unknown): CountQuery;
}
type DataPayload = { data: unknown[] | null; error: unknown };
interface DataQuery extends PromiseLike<DataPayload> {
  is(column: string, value: unknown): DataQuery;
}
interface OverviewTable {
  select(columns: string, options: { count: "exact"; head: true }): CountQuery;
  select(columns: string): DataQuery;
}
interface OverviewDb {
  from(table: "orgs" | "profiles" | "analysis_runs" | "clients" | "fee_payments"): OverviewTable;
}

async function defaultClient(): Promise<OverviewDb> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient() as unknown as OverviewDb;
}

// The platform intake org is marked in its brand JSON exactly as the referrals
// repository detects it (`brand @> {"platform_intake": true}`); operators are
// every other org. Counting with `not.cs` keeps the distinction in one place
// rather than hard-coding the seed's org id.
export const PLATFORM_INTAKE_MARKER = JSON.stringify({ platform_intake: true });

async function count(query: CountQuery, code: string): Promise<number> {
  const { count: value, error } = await query;
  if (error) throw new Error(code);
  return value ?? 0;
}

// Sum an integer-cents column over every returned row, reducing in JS the same
// way the operator dashboard totals its receivables. A non-integer or negative
// value contributes nothing rather than corrupting the total.
async function sumCents(query: DataQuery, column: string, code: string): Promise<number> {
  const { data, error } = await query;
  if (error || !Array.isArray(data)) throw new Error(code);
  return data.reduce<number>((total, row) => {
    const value = (row as Record<string, unknown>)[column];
    return total + (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0);
  }, 0);
}

export interface OverviewRepository {
  readCounts(): Promise<AdminOverviewCounts>;
  // All-time funded volume in cents across every client. `null` — never 0 —
  // when no client carries a recorded outcome, mirroring the operator
  // dashboard's "no recorded outcome, not $0" rule.
  readFundedCents(): Promise<number | null>;
  // All-time collected fee volume in cents across every org, counting only
  // payments that were never reversed — the same basis `fee_recompute_paid`
  // uses for the ledger's `paid_cents`.
  readCashCents(): Promise<number>;
}

export function createOverviewRepository(
  createClient: () => unknown | Promise<unknown> = defaultClient,
): OverviewRepository {
  let clientPromise: Promise<OverviewDb> | null = null;
  const client = () => (clientPromise ??= Promise.resolve(createClient()).then((value) => value as OverviewDb));
  return {
    async readCounts() {
      const db = await client();
      const [operators, consumers, analyses] = await Promise.all([
        count(
          db.from("orgs").select("id", { count: "exact", head: true }).not("brand", "cs", PLATFORM_INTAKE_MARKER),
          "ADMIN_OVERVIEW_OPERATORS_FAILED",
        ),
        count(
          db.from("profiles").select("id", { count: "exact", head: true }).eq("role", "consumer"),
          "ADMIN_OVERVIEW_CONSUMERS_FAILED",
        ),
        count(
          db.from("analysis_runs").select("id", { count: "exact", head: true }),
          "ADMIN_OVERVIEW_ANALYSES_FAILED",
        ),
      ]);
      return { operators, consumers, analyses };
    },
    async readFundedCents() {
      const db = await client();
      const total = await sumCents(
        db.from("clients").select("funded_amount_cents"),
        "funded_amount_cents",
        "ADMIN_OVERVIEW_FUNDED_FAILED",
      );
      return total === 0 ? null : total;
    },
    async readCashCents() {
      const db = await client();
      return sumCents(
        db.from("fee_payments").select("amount_cents").is("reversed_at", null),
        "amount_cents",
        "ADMIN_OVERVIEW_CASH_FAILED",
      );
    },
  };
}

export async function readAdminOverviewCounts(): Promise<AdminOverviewCounts> {
  return createOverviewRepository().readCounts();
}

export async function readAdminFundedCents(): Promise<number | null> {
  return createOverviewRepository().readFundedCents();
}

export async function readAdminCashCents(): Promise<number> {
  return createOverviewRepository().readCashCents();
}
