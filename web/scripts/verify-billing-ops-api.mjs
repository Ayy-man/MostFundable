#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";

const webRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(webRoot, "..");
const retained = [];
const actorHosts = new Map();
let activeChild = null;

function skipped(reason) {
  console.error(`SKIPPED billing operations API verification: ${reason}`);
  process.exitCode = 2;
}

function stackEnv() {
  const status = spawnSync("supabase", ["status", "-o", "env"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (status.status !== 0) return null;
  const values = {};
  for (const line of status.stdout.split("\n")) {
    const match = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim());
    if (match) values[match[1]] = match[2];
  }
  if (!values.API_URL || !values.ANON_KEY || !values.SERVICE_ROLE_KEY) return null;
  return values;
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function stopChild() {
  if (!activeChild) return;
  const { child, port } = activeChild;
  const listeners = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" });
  const ownsPort = (listeners.stdout ?? "").split("\n").some((value) => value.trim() === String(child.pid));
  if (ownsPort) {
    try { process.kill(-child.pid, "SIGTERM"); } catch { try { child.kill("SIGTERM"); } catch {} }
  }
  activeChild = null;
}

async function startServer(stack, flags) {
  const requestedPort = Number(process.env.MF_BILLING_OPS_PORT ?? 0);
  if (requestedPort !== 0 && (!Number.isInteger(requestedPort) || requestedPort < 3010 || requestedPort > 65535)) {
    throw new Error("MF_BILLING_OPS_PORT must be an integer from 3010 through 65535");
  }
  const port = requestedPort || await freePort();
  const child = spawn(path.join(webRoot, "node_modules/.bin/next"), ["start", "-p", String(port)], {
    cwd: webRoot,
    detached: true,
    stdio: "ignore",
    env: {
      HOME: process.env.HOME ?? "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: stack.ANON_KEY,
      NEXT_PUBLIC_SUPABASE_URL: stack.API_URL,
      NODE_ENV: "production",
      PATH: process.env.PATH ?? "",
      SUPABASE_SERVICE_ROLE_KEY: stack.SERVICE_ROLE_KEY,
      TMPDIR: process.env.TMPDIR ?? "/tmp",
      ...flags,
    },
  });
  activeChild = { child, port };
  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 180; attempt += 1) {
    try {
      await fetch(`${baseUrl}/api/billing/config`);
      return baseUrl;
    } catch {}
    await delay(250);
  }
  stopChild();
  throw new Error("production server did not become ready");
}

async function api(baseUrl, route, actorId, init = {}) {
  const target = new URL(route, baseUrl);
  const actorHost = actorId ? actorHosts.get(actorId) : null;
  if (actorHost) target.hostname = actorHost;
  const response = await fetch(target, {
    ...init,
    headers: {
      ...(actorId ? { "x-mf-demo-profile-id": actorId } : {}),
      ...(actorHost ? { "x-forwarded-host": actorHost } : {}),
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      ...(init.headers ?? {}),
    },
  });
  const type = response.headers.get("content-type") ?? "";
  const body = type.includes("json") ? await response.json() : await response.text();
  return { body, response };
}

async function waitFor(label, read, matches) {
  let last;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    last = await read();
    if (matches(last)) return last;
    await delay(150);
  }
  throw new Error(`${label} did not settle; last value was ${JSON.stringify(last)}`);
}

function month(offset = 0) {
  const value = new Date();
  value.setUTCDate(1);
  value.setUTCMonth(value.getUTCMonth() + offset);
  return value.toISOString().slice(0, 7);
}

function mockSignature(body, webhookSigningValue) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", webhookSigningValue)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

async function requireOk(result, label) {
  assert.equal(result.error, null, label);
  return result.data;
}

const stack = stackEnv();
const buildId = path.join(webRoot, ".next", "BUILD_ID");
const exportSource = fs.readFileSync(path.join(webRoot, "src/lib/ancillary/exports.ts"), "utf8");
if (!stack) {
  skipped("the shared local Supabase stack is unavailable");
} else if (!fs.existsSync(buildId)) {
  skipped("web/.next has no production build; run npm run build first");
} else if (!exportSource.includes('operator_earnings_ledger: { table: "operator_earnings_ledger"') || !exportSource.includes('referral_ledger: { table: "referral_ledger"')) {
  skipped("IA-21-01 ledger export descriptors are absent");
} else {
  const db = createClient(stack.API_URL, stack.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const runId = randomUUID().replaceAll("-", "").slice(0, 12);
  const orgId = randomUUID();
  const adminId = randomUUID();
  const ownerId = randomUUID();
  const clientIds = [];
  const eventIds = [];
  const password = randomUUID();
  const webhookSigningValue = process.env.STRIPE_WEBHOOK_SECRET || randomBytes(32).toString("hex");
  const ownerEmail = `mf-p21-owner-${runId}@example.invalid`;
  const adminEmail = `mf-p21-admin-${runId}@example.invalid`;
  actorHosts.set(adminId, "admin.localhost");
  actorHosts.set(ownerId, `mf-p21-${runId}.localhost`);
  let enrollmentId = null;
  let consumerSubscriptionId = null;
  const consentIds = [randomUUID(), randomUUID()];

  async function createClientOverHttp(baseUrl, label) {
    const result = await api(baseUrl, "/api/clients", ownerId, {
      body: JSON.stringify({ displayName: `${label} ${runId}` }),
      method: "POST",
    });
    if (result.response.status === 201) clientIds.push(result.body.client.id);
    return result;
  }

  try {
    await requireOk(await db.auth.admin.createUser({ email: adminEmail, email_confirm: true, id: adminId, password }), "platform admin Auth fixture");
    await requireOk(await db.auth.admin.createUser({ email: ownerEmail, email_confirm: true, id: ownerId, password }), "operator owner Auth fixture");
    await requireOk(await db.from("orgs").insert({ id: orgId, name: `Phase 21 ${runId}`, slug: `mf-p21-${runId}` }), "organization fixture");
    await requireOk(await db.from("profiles").upsert([
      { email: adminEmail, full_name: "Phase 21 Admin", id: adminId, manages: [], org_id: null, org_role: null, role: "platform_admin" },
      { email: ownerEmail, full_name: "Phase 21 Owner", id: ownerId, manages: [], org_id: orgId, org_role: "owner", role: "operator_member" },
    ]), "profile fixtures");

    let baseUrl = await startServer(stack, {
      BILLING_DRIVER: "mock",
      DEFAULT_ORG_SLUG: `mf-p21-${runId}`,
      FEATURE_BILLING: "1",
      FEATURE_TENANCY: "1",
      FEATURE_TRACKER: "1",
      STRIPE_WEBHOOK_SECRET: webhookSigningValue,
    });
    assert.equal((await api(baseUrl, "/api/billing/checkout", ownerId, { body: "{}", method: "POST" })).response.status, 404);
    assert.equal((await api(baseUrl, "/api/billing/portal", ownerId, { body: "{}", method: "POST" })).response.status, 404);
    assert.equal((await api(baseUrl, "/api/revenue/settlement", adminId, { body: "{}", method: "PATCH" })).response.status, 404);
    const offClient = await createClientOverHttp(baseUrl, "Off path");
    assert.equal(offClient.response.status, 201, `feature-off client create returned ${offClient.response.status}: ${JSON.stringify(offClient.body)}`);
    const adminHtml = await api(baseUrl, "/admin", adminId);
    assert.equal(String(adminHtml.body).includes("Stripe test mode"), false);
    stopChild();
    await delay(400);

    baseUrl = await startServer(stack, {
      BILLING_DRIVER: "mock",
      DEFAULT_ORG_SLUG: `mf-p21-${runId}`,
      FEATURE_BILLING: "1",
      FEATURE_BILLING_OPS: "1",
      FEATURE_REVENUE: "1",
      FEATURE_TENANCY: "1",
      FEATURE_TRACKER: "1",
      MONITORING_SPLIT_PCT: "40",
      STRIPE_WEBHOOK_SECRET: webhookSigningValue,
    });

    const noCap = await requireOk(await db.rpc("billing_read_client_cap", { p_org_id: orgId }), "no-cap meter read");
    assert.deepEqual(noCap, [{ active_count: 1, client_cap: null }]);
    const raisedTwo = await api(baseUrl, `/api/admin/tenants/${orgId}`, adminId, {
      body: JSON.stringify({ action: "raise-cap", cap: 2 }), method: "PATCH",
    });
    assert.equal(raisedTwo.response.status, 200);
    assert.equal((await createClientOverHttp(baseUrl, "At cap")).response.status, 201);
    const blocked = await createClientOverHttp(baseUrl, "Blocked by cap");
    assert.equal(blocked.response.status, 409);
    assert.equal(blocked.body.error.code, "CLIENT_CAP_REACHED");
    const raisedThree = await api(baseUrl, `/api/admin/tenants/${orgId}`, adminId, {
      body: JSON.stringify({ action: "raise-cap", cap: 3 }), method: "PATCH",
    });
    assert.equal(raisedThree.response.status, 200);
    assert.equal((await createClientOverHttp(baseUrl, "After raise")).response.status, 201);
    const meter = await requireOk(await db.rpc("billing_read_client_cap", { p_org_id: orgId }), "capped meter read");
    assert.deepEqual(meter, [{ active_count: 3, client_cap: 3 }]);

    const checkout = await api(baseUrl, "/api/billing/checkout", ownerId, { body: "{}", method: "POST" });
    assert.equal(checkout.response.status, 200);
    assert.equal(checkout.body.url, `https://billing.mock.local/checkout/${orgId}`);
    const binding = await requireOk(await db.from("operator_subscriptions").select("customer_ref").eq("org_id", orgId).single(), "checkout customer binding");
    assert.equal(binding.customer_ref, `mock_cus_${orgId.replaceAll("-", "")}`);
    const portal = await api(baseUrl, "/api/billing/portal", ownerId, { body: "{}", method: "POST" });
    assert.equal(portal.response.status, 200);
    assert.equal(portal.body.url, `https://billing.mock.local/portal/${orgId}`);

    const settledMonth = month(-1);
    await requireOk(await db.rpc("revenue_post_billing_accrual", {
      p_accrual_month: `${settledMonth}-01`, p_operator_amount_cents: 4000,
      p_operator_base_amount_cents: 10000, p_operator_incomplete_code: null,
      p_operator_is_complete: true, p_operator_org_id: orgId,
      p_operator_pct_snapshot: 40, p_operator_source_row_count: 1,
      p_referral_snapshots: [],
    }), "settlement fixture accrual");
    const settlementLedger = await requireOk(await db.from("operator_earnings_ledger").select("id").eq("operator_org_id", orgId).eq("accrual_month", `${settledMonth}-01`).single(), "settlement ledger read");
    for (const transition of [
      { expectedStatus: "accrued", status: "exported" },
      { expectedStatus: "exported", status: "paid" },
    ]) {
      const response = await api(baseUrl, "/api/revenue/settlement", adminId, {
        body: JSON.stringify({ ...transition, ledger: "operator", ledgerId: settlementLedger.id }),
        method: "PATCH",
      });
      assert.equal(response.response.status, 200);
    }
    const paid = await requireOk(await db.from("operator_earnings_ledger").select("settlement_status").eq("id", settlementLedger.id).single(), "paid settlement read");
    assert.equal(paid.settlement_status, "paid");
    const settlementAudits = await requireOk(await db.from("audit_log").select("id").eq("subject_id", settlementLedger.id).eq("action", "billing.settlement_changed"), "settlement audit read");
    assert.equal(settlementAudits.length, 2);

    const revenueClientId = clientIds[0];
    enrollmentId = randomUUID();
    const subscriptionRef = `mock_sub_p21_${runId}`;
    const customerRef = `mock_cus_p21_${runId}`;
    const consentAt = new Date().toISOString();
    const esigRef = `p21-${runId}`;
    await requireOk(await db.from("consents").insert([
      { action: "granted", client_id: revenueClientId, esig_ref: esigRef, id: consentIds[0], ip: "127.0.0.1", kind: "monitoring", signed_at: consentAt, text_version: "p21-local-fixture" },
      { action: "granted", client_id: revenueClientId, esig_ref: esigRef, id: consentIds[1], ip: "127.0.0.1", kind: "analysis", signed_at: consentAt, text_version: "p21-local-fixture" },
    ]), "revenue consent fixtures");
    retained.push(`consents:${consentIds.join(",")}`);
    await requireOk(await db.from("enrollments").insert({
      analysis_consent_at: consentAt, client_id: revenueClientId,
      esig_doc_id: esigRef, id: enrollmentId,
      monitoring_consent_at: consentAt, status: "active",
    }), "revenue enrollment fixture");
    await requireOk(await db.rpc("enrollment_record_setup", {
      p_actor_id: ownerId, p_client_id: revenueClientId, p_customer_ref: customerRef,
      p_enrollment_id: enrollmentId, p_idempotency_key: `p21-${runId}`,
      p_payment_method_ref: `mock_pm_${runId}`, p_price_cents: 10000,
      p_price_ref: `mock_price_${runId}`, p_provider: "mock",
      p_setup_intent_ref: `mock_seti_${runId}`,
    }), "revenue subscription authorization");
    // R4A-04: settlement requires a persisted passed IDV session, so the
    // fixture walks the same two RPCs the product does.
    await requireOk(await db.rpc("enrollment_idv_started", {
      p_actor_id: ownerId, p_client_id: revenueClientId, p_driver: "mock",
      p_enrollment_id: enrollmentId, p_kind: "sms", p_max_attempts: 3,
      p_member_ref: `mock_member_p21_${runId}`,
    }), "revenue idv session fixture");
    await requireOk(await db.rpc("enrollment_idv_settled", {
      p_actor_id: ownerId, p_enrollment_id: enrollmentId, p_locked_until: null,
      p_next_state: "passed", p_outcome: "pass", p_parked_until: null,
    }), "revenue idv pass fixture");
    await requireOk(await db.rpc("enrollment_settle_sub", {
      p_actor_id: ownerId, p_enrollment_id: enrollmentId, p_subscription_ref: subscriptionRef,
    }), "revenue subscription settlement");
    const consumerSubscription = await requireOk(await db.from("consumer_subscriptions").select("id,status").eq("enrollment_id", enrollmentId).single(), "revenue subscription read");
    consumerSubscriptionId = consumerSubscription.id;
    assert.equal(consumerSubscription.status, "active");
    retained.push(`consumer_subscription:${consumerSubscriptionId}`, `enrollment:${enrollmentId}`, `client:${revenueClientId}`);

    const refundEventId = `evt_p21_refund_${runId}`;
    eventIds.push(refundEventId);
    const refundBody = JSON.stringify({
      amount_refunded: 2000, charge_ref: `ch_p21_${runId}`, created: Math.floor(Date.now() / 1000),
      currency: "usd", customer: customerRef, id: refundEventId,
      subscription: subscriptionRef, type: "charge.refunded",
    });
    const refundResponse = await api(baseUrl, "/api/webhooks/stripe", null, {
      body: refundBody, headers: { "stripe-signature": mockSignature(refundBody, webhookSigningValue) }, method: "POST",
    });
    assert.equal(refundResponse.response.status, 200);
    const observation = await waitFor("refund observation", async () => {
      const result = await db.from("billing_refund_observations").select("id,org_id,cumulative_amount_refunded_cents").eq("event_id", refundEventId).maybeSingle();
      assert.equal(result.error, null);
      return result.data;
    }, (value) => value?.org_id === orgId);
    retained.push(`refund:${observation.id}`);
    assert.equal(observation.cumulative_amount_refunded_cents, 2000);

    const unknownEventId = `evt_p21_unknown_${runId}`;
    eventIds.push(unknownEventId);
    const unknownBody = JSON.stringify({ id: unknownEventId, type: "billing.unrecognized", created: Math.floor(Date.now() / 1000) });
    assert.equal((await api(baseUrl, "/api/webhooks/stripe", null, {
      body: unknownBody, headers: { "stripe-signature": mockSignature(unknownBody, webhookSigningValue) }, method: "POST",
    })).response.status, 200);
    await waitFor("unknown event compatibility", async () => {
      const result = await db.from("stripe_webhook_events").select("status").eq("event_id", unknownEventId).maybeSingle();
      assert.equal(result.error, null);
      return result.data?.status ?? null;
    }, (value) => value === "ignored");

    const accrualMonth = month();
    const run = await api(baseUrl, "/api/revenue/jobs/run-now", adminId, {
      body: JSON.stringify({ job: "billing.accruals", subject: `org:${orgId}`, window: accrualMonth }), method: "POST",
    });
    assert.equal(run.response.status, 200);
    assert.equal(run.body.status, "complete");
    const net = await requireOk(await db.from("operator_earnings_ledger").select("base_amount_cents,amount_cents,settlement_status").eq("operator_org_id", orgId).eq("accrual_month", `${accrualMonth}-01`).single(), "net accrual read");
    assert.deepEqual(net, { amount_cents: 3200, base_amount_cents: 8000, settlement_status: "accrued" });

    retained.push(`org:${orgId}`, `admin:${adminId}`, `owner:${ownerId}`, `events:${eventIds.join(",")}`);
    console.log(`Billing operations API verification passed: OFF parity, cap meter 3/3, hosted mock URLs, paid settlement with 2 audits, refund observation, unknown-event compatibility, and net accrual 3200 cents; retained ${retained.join(" ")}.`);
  } finally {
    stopChild();
    if (consumerSubscriptionId) await db.from("consumer_subscriptions").delete().eq("id", consumerSubscriptionId);
    if (enrollmentId) await db.from("enrollments").delete().eq("id", enrollmentId);
    if (clientIds.length > 0) await db.from("clients").delete().in("id", clientIds);
    await db.from("operator_subscriptions").delete().eq("org_id", orgId);
    // Audit and refund evidence are append-only or intentionally immutable, so
    // their organization and actors remain as explicitly reported evidence.
  }
}
