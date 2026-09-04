/**
 * The flag-off path, proven at runtime rather than at build time.
 *
 * `env -i npm run build` already shows Phase 10 compiles with no environment.
 * That is a weaker claim than it looks: a route can build cleanly and still
 * open a database connection, resolve a driver or load an admin client on the
 * first request. This suite starts a server whose environment omits
 * `FEATURE_BILLING` entirely — not set to `0`, absent — and drives all three
 * endpoints over HTTP.
 *
 * Row counts are scoped to an organization this run creates rather than taken
 * across the whole table. The stack is shared with the other phases, and Node's
 * test runner runs suite files in parallel, so a global `count(*)` would be
 * comparing against rows the dunning suite is writing at the same moment. The
 * scoped version is also the stronger claim: the seeded subscription carries a
 * reference the posted event names, so with the flag on the rung would move,
 * and the assertion is that it does not.
 */

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { signMockWebhook } from "@/lib/billing/mock";
import { createAdminClient } from "@/lib/supabase/admin";

import {
  applyStackEnv,
  buildProblem,
  delay,
  detachStripeKeys,
  freePort,
  resolveStackEnv,
  settle,
  stackSkipReason,
  startChildServer,
  stopChild,
} from "./billing-support";

type DbResult = {
  count: number | null;
  data: unknown;
  error: { code?: string; message: string } | null;
};

interface FixtureQuery extends PromiseLike<DbResult> {
  delete(): FixtureQuery;
  eq(column: string, value: string): FixtureQuery;
  insert(values: Record<string, unknown>): FixtureQuery;
  maybeSingle(): PromiseLike<DbResult>;
  select(
    columns?: string,
    options?: { count?: "exact"; head?: boolean },
  ): FixtureQuery;
}

interface FixtureClient {
  from(table: string): FixtureQuery;
}

function row(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const OPERATOR_TABLES = [
  "operator_billing_events",
  "operator_seat_sync_outbox",
  "operator_subscriptions",
] as const;

type TableCounts = Record<string, number>;

const stack = resolveStackEnv();
const build = stack === null ? null : buildProblem();
const skip = stack === null ? stackSkipReason() : (build ?? false);

if (stack !== null) {
  detachStripeKeys();
  applyStackEnv(stack);
}

describe("billing is inert with FEATURE_BILLING absent", { skip }, () => {
  const runId = randomUUID().replaceAll("-", "").slice(0, 12);
  const webhookSigningValue = randomBytes(32).toString("hex");
  const orgId = randomUUID();
  const eventId = `evt_mock_disabled_${runId}`;
  const subscriptionRef = `mock_sub_disabled_${runId}`;

  let db: FixtureClient;
  let baseUrl = "";
  let pid: number | null = null;
  let port: number | null = null;
  let opening: TableCounts = {};

  async function countFor(table: string): Promise<number> {
    const { count, error } = await db
      .from(table)
      .select("org_id", { count: "exact", head: true })
      .eq("org_id", orgId);
    if (error) throw new Error(`${table} count failed (${error.code ?? "unknown"})`);
    return count ?? 0;
  }

  async function countAll(): Promise<TableCounts> {
    const counts: TableCounts = {};
    for (const table of OPERATOR_TABLES) counts[table] = await countFor(table);
    return counts;
  }

  async function call(
    method: "GET" | "POST",
    route: string,
  ): Promise<{ cacheControl: string | null; payload: unknown; status: number }> {
    const target = new URL(route, baseUrl);
    const response = await fetch(target, {
      body: method === "POST" ? JSON.stringify({}) : undefined,
      headers: method === "POST"
        ? { "content-type": "application/json", origin: new URL(baseUrl).origin }
        : {},
      method,
    });
    const raw = await response.text();
    let payload: unknown = null;
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      payload = null;
    }
    return {
      cacheControl: response.headers.get("cache-control"),
      payload,
      status: response.status,
    };
  }

  before(async () => {
    db = createAdminClient() as unknown as FixtureClient;

    const org = await db.from("orgs").insert({
      id: orgId,
      name: `Phase 10 Disabled ${runId}`,
      slug: `mf-p10-disabled-${runId}`,
    });
    assert.equal(org.error, null, "seeding the organization failed");

    const subscription = await db.from("operator_subscriptions").insert({
      base_price_ref: "mock_price_operator_base",
      customer_ref: `mock_cus_disabled_${runId}`,
      org_id: orgId,
      provider: "mock",
      seat_price_ref: "mock_price_operator_seat",
      status: "active",
      subscription_ref: subscriptionRef,
    });
    assert.equal(subscription.error, null, "seeding the subscription failed");

    opening = await countAll();

    port = await freePort();
    // No FEATURE_* key of any kind, and `startChildServer` builds the child's
    // environment from a whitelist, so nothing from the developer's shell can
    // switch the feature back on behind this suite's back.
    const child = await startChildServer({ flags: {}, port, stack: stack as NonNullable<typeof stack>, webhookSigningValue });
    baseUrl = child.baseUrl;
    pid = child.pid;
  });

  after(async () => {
    if (db !== undefined) {
      await db.from("operator_subscriptions").delete().eq("org_id", orgId);
      await db.from("operator_seat_sync_outbox").delete().eq("org_id", orgId);
      await db.from("stripe_webhook_events").delete().eq("event_id", eventId);
      await db.from("orgs").delete().eq("id", orgId);
    }

    if (pid !== null && port !== null) stopChild(pid, port);
  });

  it("answers the read with the disabled envelope and nothing else", async () => {
    const { cacheControl, payload, status } = await call(
      "GET",
      "/api/billing/subscription",
    );

    assert.equal(status, 200);
    assert.deepEqual(payload, { enabled: false });
    assert.equal(cacheControl, "private, no-store");
  });

  it("answers both writes with the disabled envelope", async () => {
    for (const route of ["/api/billing/subscription", "/api/billing/seats/sync"]) {
      const { cacheControl, payload, status } = await call("POST", route);

      assert.equal(status, 200, `${route} returned ${status}`);
      assert.deepEqual(payload, { code: "billing_disabled" }, route);
      assert.equal(cacheControl, "private, no-store", route);
    }
  });

  it("acknowledges a validly signed event and writes no billing row", async () => {
    const created = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      created,
      customer: `mock_cus_disabled_${runId}`,
      id: eventId,
      subscription: subscriptionRef,
      type: "invoice.paid",
    });

    // The 5xx retry mirrors the provider's own behaviour, and it is here for a
    // measured reason rather than as flake insurance: on this shared local
    // stack PostgREST intermittently resets a pooled upstream connection and
    // Kong answers the ledger insert with a 502, which the route correctly
    // turns into a 5xx so the delivery is retried. A persistent failure still
    // fails the assertion.
    let status = 0;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await fetch(`${baseUrl}/api/webhooks/stripe`, {
        body,
        headers: {
          "content-type": "application/json",
          "stripe-signature": signMockWebhook(body, created, webhookSigningValue),
        },
        method: "POST",
      });
      status = response.status;
      if (status < 500) break;
      await delay(400);
    }
    assert.equal(status, 200, "the webhook endpoint must still acknowledge");

    // Lane B's handler is the only thing that should have run, so the wait is
    // for the ledger row to stop saying `received` — and then for long enough
    // that a dispatcher which was going to write something would have.
    await settle();

    const { data } = await db
      .from("stripe_webhook_events")
      .select("status")
      .eq("event_id", eventId)
      .maybeSingle();
    assert.equal(
      row(data)?.status,
      "ignored",
      "lane B's handler is what must have run with the flag off",
    );

    assert.deepEqual(
      await countAll(),
      opening,
      "no operator billing table may gain a row while the flag is absent",
    );

    const { data: org } = await db
      .from("orgs")
      .select("membership")
      .eq("id", orgId)
      .maybeSingle();
    assert.equal(
      row(org)?.membership,
      "trial",
      "an event the ladder would have applied must not move the rung with the flag off",
    );
  });
});
