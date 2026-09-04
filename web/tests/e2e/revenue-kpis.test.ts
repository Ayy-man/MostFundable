import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { deriveSaasMetrics } from "@/lib/demo/feedback-fixtures";
import { parseRevenueKpiResponse, revenuePresentation, selectRevenueMetrics } from "@/lib/revenue/client";
import { createAdminClient } from "@/lib/supabase/admin";

import {
  applyStackEnv,
  buildProblem,
  delay,
  freePort,
  resolveStackEnv,
  stackSkipReason,
  startChildServer,
  stopChild,
} from "./billing-support";

const REFERRER_ORG_ID = "14e60000-0000-4000-8000-000000000001";
const REFERRED_ORG_ID = "14e60000-0000-4000-8000-000000000002";
const ADMIN_ID = "14e60000-0000-4000-8000-000000000101";
const OPERATOR_ID = "14e60000-0000-4000-8000-000000000102";
const REFERRAL_ID = "14e60000-0000-4000-8000-000000000201";
const DISPLAY_MONTH = "2098-01";
const RUN_MONTH = "2098-02";
const container = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_mostfundable";

type DbResult = { count: number | null; data: unknown; error: { code?: string; message?: string } | null };
interface Query extends PromiseLike<DbResult> {
  delete(): Query;
  eq(column: string, value: string): Query;
  insert(values: Record<string, unknown> | Record<string, unknown>[]): Query;
  select(columns?: string, options?: { count?: "exact"; head?: boolean }): Query;
  upsert(values: Record<string, unknown> | Record<string, unknown>[]): Query;
}
interface FixtureClient {
  auth: {
    admin: {
      createUser(input: Record<string, unknown>): Promise<{ error: { message: string } | null }>;
      deleteUser(id: string): Promise<{ error: { message: string } | null }>;
    };
  };
  from(table: string): Query;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<DbResult>;
}

const stack = resolveStackEnv();
const build = stack === null ? null : buildProblem();
const skip = process.env.REVENUE_E2E !== "1"
  ? "REVENUE_E2E=1 is absent — SKIPPED, not passed"
  : stack === null
    ? stackSkipReason()
    : build ?? false;

if (stack !== null) applyStackEnv(stack);

function sql(statement: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-tAq", "-v", "ON_ERROR_STOP=1", "-c", statement],
    { encoding: "utf8" },
  ).trim();
}

function cleanup(): void {
  sql(`
    set session_replication_role = replica;
    delete from public.referral_ledger where saas_referral_id = '${REFERRAL_ID}';
    delete from public.operator_earnings_ledger where operator_org_id = '${REFERRED_ORG_ID}';
    delete from public.background_jobs where subject = 'org:${REFERRED_ORG_ID}';
    set session_replication_role = origin;
    delete from public.saas_referrals where id = '${REFERRAL_ID}';
    delete from public.operator_subscriptions where org_id = '${REFERRED_ORG_ID}';
    delete from public.profiles where id in ('${ADMIN_ID}', '${OPERATOR_ID}');
    delete from auth.users where id in ('${ADMIN_ID}', '${OPERATOR_ID}');
    delete from public.orgs where id in ('${REFERRER_ORG_ID}', '${REFERRED_ORG_ID}');
  `);
}

async function signIn(baseUrl: string, email: string, password: string): Promise<string> {
  const signInUrl = new URL("/api/auth/sign-in", baseUrl);
  const response = await fetch(signInUrl, {
    body: JSON.stringify({ email, password }),
    headers: { "content-type": "application/json", origin: signInUrl.origin },
    method: "POST",
    redirect: "manual",
  });
  assert.ok([200, 302, 303, 307].includes(response.status), `sign-in returned ${response.status}`);
  const cookies = response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).filter(Boolean);
  assert.ok(cookies.length > 0, "sign-in set no session cookie");
  return cookies.join("; ");
}

async function api(
  baseUrl: string,
  path: string,
  input: { body?: unknown; cookie?: string; method?: "GET" | "POST" } = {},
): Promise<{ body: Record<string, unknown>; status: number }> {
  const target = new URL(path, baseUrl);
  const response = await fetch(target, {
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
    headers: {
      ...(input.cookie ? { cookie: input.cookie } : {}),
      ...(input.body === undefined ? {} : { "content-type": "application/json" }),
      ...(input.method === "POST" ? { origin: target.origin } : {}),
    },
    method: input.method ?? "GET",
    redirect: "manual",
  });
  const text = await response.text();
  return { body: text ? JSON.parse(text) as Record<string, unknown> : {}, status: response.status };
}

describe("revenue KPIs over a live local server", { skip }, () => {
  it("keeps flag-off fixtures, serves ledger values, enforces roles, and persists one replay", async () => {
    const db = createAdminClient() as unknown as FixtureClient;
    const adminEmail = `phase14-admin-${ADMIN_ID}@example.invalid`;
    const operatorEmail = `phase14-operator-${OPERATOR_ID}@example.invalid`;
    const adminPassword = `${randomUUID()}A1!`;
    const operatorPassword = `${randomUUID()}A1!`;
    let pid: number | null = null;
    let port: number | null = null;

    cleanup();
    try {
      port = await freePort();
      const off = await startChildServer({ flags: {}, port, stack: stack as NonNullable<typeof stack> });
      pid = off.pid;
      const disabled = await api(off.baseUrl, `/api/revenue/kpis?window=${DISPLAY_MONTH}`);
      assert.equal(disabled.status, 404);
      const offFixture = deriveSaasMetrics();
      assert.equal(selectRevenueMetrics(offFixture, null), offFixture);
      const disabledPresentation = revenuePresentation(null);
      const failedPresentation = revenuePresentation("failed");
      assert.deepEqual(
        Object.keys(disabledPresentation).sort(),
        Object.keys(failedPresentation).sort(),
        "disabled and failed revenue reads no longer share one presentation contract",
      );
      assert.equal(disabledPresentation.enabled, false);
      assert.equal(disabledPresentation.failed, false);
      assert.equal(failedPresentation.failed, true);
      assert.equal(disabledPresentation.monitoringLabel, failedPresentation.monitoringLabel);
      assert.equal(disabledPresentation.referralLabel, failedPresentation.referralLabel);
      stopChild(pid, port);
      pid = null;
      port = null;
      await delay(500);

      const insertedOrgs = await db.from("orgs").insert([
        { id: REFERRER_ORG_ID, name: "Phase 14 Referrer", slug: "phase-14-referrer" },
        { id: REFERRED_ORG_ID, name: "Phase 14 Referred", slug: "phase-14-referred" },
      ]);
      assert.equal(insertedOrgs.error, null);
      assert.equal((await db.auth.admin.createUser({ email: adminEmail, email_confirm: true, id: ADMIN_ID, password: adminPassword })).error, null);
      assert.equal((await db.auth.admin.createUser({ email: operatorEmail, email_confirm: true, id: OPERATOR_ID, password: operatorPassword })).error, null);
      assert.equal((await db.from("profiles").upsert([
        { email: adminEmail, full_name: "Phase 14 Admin", id: ADMIN_ID, manages: [], org_id: null, org_role: null, role: "platform_admin" },
        { email: operatorEmail, full_name: "Phase 14 Operator", id: OPERATOR_ID, manages: [], org_id: REFERRED_ORG_ID, org_role: "owner", role: "operator_member" },
      ])).error, null);
      assert.equal((await db.from("operator_subscriptions").insert({
        base_price_ref: "phase14_base",
        org_id: REFERRED_ORG_ID,
        provider: "mock",
        seat_price_ref: "phase14_seat",
        seat_quantity: 2,
        status: "active",
      })).error, null);
      assert.equal((await db.from("saas_referrals").insert({
        id: REFERRAL_ID,
        referred_org_id: REFERRED_ORG_ID,
        referrer_org_id: REFERRER_ORG_ID,
        started_at: `${DISPLAY_MONTH}-01`,
      })).error, null);
      assert.equal((await db.rpc("revenue_post_billing_accrual", {
        p_accrual_month: `${DISPLAY_MONTH}-01`,
        p_operator_amount_cents: 12_345,
        p_operator_base_amount_cents: 24_690,
        p_operator_incomplete_code: null,
        p_operator_is_complete: true,
        p_operator_org_id: REFERRED_ORG_ID,
        p_operator_pct_snapshot: 50,
        p_operator_source_row_count: 1,
        p_referral_snapshots: [{
          accrual_month: `${DISPLAY_MONTH}-01`, amount_cents: 6_789, base_amount_cents: 33_945,
          base_snapshot: "platform_subscription", cycle_number: 1, incomplete_code: null,
          is_complete: true, pct_snapshot: 20, referred_org_id: REFERRED_ORG_ID,
          referrer_org_id: REFERRER_ORG_ID, saas_referral_id: REFERRAL_ID, source_row_count: 1,
        }],
      })).error, null);

      port = await freePort();
      const on = await startChildServer({
        flags: { FEATURE_REAL_AUTH: "true", FEATURE_REVENUE: "true", MONITORING_SPLIT_PCT: "40" },
        port,
        stack: stack as NonNullable<typeof stack>,
      });
      pid = on.pid;
      const adminCookie = await signIn(on.baseUrl, adminEmail, adminPassword);
      const operatorCookie = await signIn(on.baseUrl, operatorEmail, operatorPassword);

      const enabled = await api(on.baseUrl, `/api/revenue/kpis?window=${DISPLAY_MONTH}`, { cookie: adminCookie });
      assert.equal(enabled.status, 200);
      const parsed = parseRevenueKpiResponse(enabled.body);
      assert.ok(parsed);
      const fixture = deriveSaasMetrics();
      const selected = selectRevenueMetrics(fixture, parsed);
      assert.equal(selected.monitoringProfit, 123.45);
      assert.equal(selected.referralSplit, 67.89);
      assert.equal(selected.monthlyRecurringTotal, fixture.monthlyRecurringTotal);
      assert.equal(selected.platformMrr, fixture.platformMrr);

      const incomplete = await api(on.baseUrl, "/api/revenue/kpis?window=2099-12", { cookie: adminCookie });
      assert.equal(incomplete.status, 200);
      const incompleteParsed = parseRevenueKpiResponse(incomplete.body);
      assert.ok(incompleteParsed);
      assert.equal(incompleteParsed.complete, false);
      assert.equal(incompleteParsed.monitoringShareTotalCents, 0);
      assert.equal(incompleteParsed.saasReferralTotalCents, 0);
      assert.equal(revenuePresentation(incompleteParsed).complete, false);

      assert.equal((await api(on.baseUrl, `/api/revenue/kpis?window=${DISPLAY_MONTH}`, { cookie: operatorCookie })).status, 403);
      const tuple = { job: "billing.accruals", subject: `org:${REFERRED_ORG_ID}`, window: RUN_MONTH };
      assert.equal((await api(on.baseUrl, "/api/revenue/jobs/run-now", { body: tuple, cookie: operatorCookie, method: "POST" })).status, 403);
      assert.equal((await api(on.baseUrl, "/api/revenue/jobs/run-now", { body: tuple, cookie: adminCookie, method: "POST" })).status, 200);
      assert.equal((await api(on.baseUrl, "/api/revenue/jobs/run-now", { body: tuple, cookie: adminCookie, method: "POST" })).status, 200);

      const operatorRows = await db.from("operator_earnings_ledger")
        .select("id", { count: "exact", head: true }).eq("operator_org_id", REFERRED_ORG_ID).eq("accrual_month", `${RUN_MONTH}-01`);
      const referralRows = await db.from("referral_ledger")
        .select("id", { count: "exact", head: true }).eq("saas_referral_id", REFERRAL_ID).eq("accrual_month", `${RUN_MONTH}-01`);
      assert.equal(operatorRows.error, null);
      assert.equal(referralRows.error, null);
      assert.equal(operatorRows.count, 1, "run-now replay must leave one operator row");
      assert.equal(referralRows.count, 1, "run-now replay must leave one eligible referral row");
    } finally {
      if (pid !== null && port !== null) stopChild(pid, port);
      cleanup();
    }
  });
});
