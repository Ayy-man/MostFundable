/**
 * The whole operator dunning ladder, over real HTTP, with no Stripe key.
 *
 * Everything Phase 10 claims about membership is claimed about persisted state,
 * so every assertion below reads `public.orgs.membership` back out of the
 * database rather than trusting a response body. The endpoint acknowledges
 * before it works (DEC-OWN-AFTER), so each POST is followed by a bounded poll
 * rather than an immediate read.
 *
 * The server is a child `next start` on a free port, started by this suite,
 * carrying `FEATURE_BILLING=1`, `BILLING_DRIVER=mock`, `FEATURE_REAL_AUTH=1`,
 * and one ephemeral webhook signing value shared with this test process. Real auth rather than the demo header is
 * deliberate: `GET /api/billing/subscription` reads through the caller's
 * session-scoped client so migration 070's scoped select policies decide the
 * answer, and a demo session carries no Supabase JWT, so that read would come
 * back empty and the assertion would prove nothing.
 *
 * Cleanup, stated plainly because it is incomplete by design: this suite
 * removes its subscription row, its outbox row, its members and its ledger
 * rows. It cannot remove `public.operator_billing_events`, which migration 070
 * makes append-only with a BEFORE DELETE trigger, and therefore cannot remove
 * the `public.orgs` row those events hang from. One org shell and its trail
 * survive each run. Disabling that trigger to tidy up would mean turning off a
 * protection on a database three other phases are using, which is a worse trade
 * than leaving a row behind.
 */

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { DUNNING_FIXTURE_STREAM } from "@/lib/billing/fixtures/dunning-stream";
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
  waitFor,
} from "./billing-support";

// ---------------------------------------------------------------------------
// A structural view of the admin client
//
// Migrations 070 to 073 are not in the generated `src/lib/db/types.ts`, and
// regenerating that file would edit a module every lane imports. The repository
// layer solved this with a structural cast; a fixture does the same.
// ---------------------------------------------------------------------------

type DbResult = {
  count: number | null;
  data: unknown;
  error: { code?: string; message: string } | null;
};

interface FixtureQuery extends PromiseLike<DbResult> {
  delete(): FixtureQuery;
  eq(column: string, value: string): FixtureQuery;
  in(column: string, values: readonly string[]): FixtureQuery;
  insert(values: Record<string, unknown>): FixtureQuery;
  maybeSingle(): PromiseLike<DbResult>;
  select(
    columns?: string,
    options?: { count?: "exact"; head?: boolean },
  ): FixtureQuery;
  upsert(values: Record<string, unknown>): FixtureQuery;
}

interface FixtureClient {
  from(table: string): FixtureQuery;
}

type CookieHeaders = { getSetCookie(): string[] };

function row(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

/** The references the committed stream carries. The seeded row must match them. */
const FIXTURE_SUBSCRIPTION_REF = "mock_sub_operator_dunning";
const FIXTURE_CUSTOMER_REF = "mock_cus_operator_dunning";

/** Seven members against five included seats is the plan's arithmetic: two paid. */
// Bounded, so a route that is genuinely broken still fails the suite rather
// than looping. Three attempts covers the single-reset case seen on this stack.
const WEBHOOK_POST_ATTEMPTS = 3;
const WEBHOOK_RETRY_MS = 400;
const SEATS_INCLUDED = 5;
const INITIAL_MEMBERS = 7;

/** The rungs the first five fixture events must walk, in order. */
const LADDER: readonly string[] = [
  "current",
  "past_due",
  "grace",
  "deactivated",
  "current",
];

type Delivery = {
  body: string;
  eventId: string;
  header: string;
  label: string;
};

/**
 * Sign each fixture body against the current clock (D-13).
 *
 * Two things are decided here rather than in the fixture. The event ids get a
 * run suffix, because `public.stripe_webhook_events.event_id` is a global
 * primary key and a second run carrying the committed ids would be refused as a
 * replay before any of this suite's code ran. And the stream is anchored so its
 * last event lands on now and the rest sit in the past, which keeps every
 * `occurred_at` behind the wall clock while leaving the stream's internal
 * ordering — including the deliberately older final event — exactly as
 * committed. The signature timestamp stays the current second either way, so
 * the provider's five-minute tolerance is respected.
 */
function buildDeliveries(runId: string, nowSeconds: number, webhookSigningValue: string): Delivery[] {
  const span = Math.max(
    ...DUNNING_FIXTURE_STREAM.map((fixture) => fixture.createdOffsetSeconds),
  );
  const base = nowSeconds - span;

  return DUNNING_FIXTURE_STREAM.map((fixture) => {
    const eventId = `${String(fixture.body.id)}_${runId}`;
    const body = JSON.stringify({
      ...fixture.body,
      created: base + fixture.createdOffsetSeconds,
      id: eventId,
    });

    return {
      body,
      eventId,
      header: signMockWebhook(body, nowSeconds, webhookSigningValue),
      label: fixture.label,
    };
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

const stack = resolveStackEnv();
const build = stack === null ? null : buildProblem();
const skip = stack === null ? stackSkipReason() : (build ?? false);

if (stack !== null) {
  detachStripeKeys();
  applyStackEnv(stack);
}

describe("operator dunning over HTTP, with no Stripe key", { skip }, () => {
  const runId = randomUUID().replaceAll("-", "").slice(0, 12);
  const webhookSigningValue = randomBytes(32).toString("hex");
  const orgId = randomUUID();
  const slug = `mf-p10-dunning-${runId}`;
  const password = randomUUID();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const deliveries = buildDeliveries(runId, nowSeconds, webhookSigningValue);
  const memberIds: string[] = [];
  const ledgerIds: string[] = deliveries.map((delivery) => delivery.eventId);

  let admin: ReturnType<typeof createAdminClient>;
  let db: FixtureClient;
  let baseUrl = "";
  let cookie = "";
  let pid: number | null = null;
  let port: number | null = null;

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async function readOrgColumn(column: string): Promise<unknown> {
    const { data, error } = await db
      .from("orgs")
      .select(column)
      .eq("id", orgId)
      .maybeSingle();
    if (error) throw new Error(`orgs read failed (${error.code ?? "unknown"})`);
    return row(data)?.[column] ?? null;
  }

  async function readMembership(): Promise<string | null> {
    return text(await readOrgColumn("membership"));
  }

  async function readSubscription(): Promise<Record<string, unknown> | null> {
    const { data, error } = await db
      .from("operator_subscriptions")
      .select(
        "seat_quantity, status, subscription_ref, grace_started_at, grace_until, cancel_at_period_end, current_period_end, base_price_ref, seat_price_ref",
      )
      .eq("org_id", orgId)
      .maybeSingle();
    if (error) {
      throw new Error(`subscription read failed (${error.code ?? "unknown"})`);
    }
    return row(data);
  }

  async function readOutbox(): Promise<Record<string, unknown> | null> {
    const { data, error } = await db
      .from("operator_seat_sync_outbox")
      .select("desired_quantity, status, attempts")
      .eq("org_id", orgId)
      .maybeSingle();
    if (error) throw new Error(`outbox read failed (${error.code ?? "unknown"})`);
    return row(data);
  }

  async function countTrail(): Promise<number> {
    const { count, error } = await db
      .from("operator_billing_events")
      .select("event_id", { count: "exact", head: true })
      .eq("org_id", orgId);
    if (error) throw new Error(`trail count failed (${error.code ?? "unknown"})`);
    return count ?? 0;
  }

  async function readTrailRow(
    eventId: string,
  ): Promise<Record<string, unknown> | null> {
    const { data, error } = await db
      .from("operator_billing_events")
      .select("event_id, reason_code, applied, from_membership, to_membership")
      .eq("org_id", orgId)
      .eq("event_id", eventId)
      .maybeSingle();
    if (error) throw new Error(`trail read failed (${error.code ?? "unknown"})`);
    return row(data);
  }

  async function readLedgerStatus(eventId: string): Promise<string | null> {
    const { data, error } = await db
      .from("stripe_webhook_events")
      .select("status")
      .eq("event_id", eventId)
      .maybeSingle();
    if (error) throw new Error(`ledger read failed (${error.code ?? "unknown"})`);
    return text(row(data)?.status);
  }

  // -------------------------------------------------------------------------
  // HTTP
  // -------------------------------------------------------------------------

  /**
   * Posts a delivery and retries a 5xx, which is what Stripe itself does.
   *
   * The retry is not there to make a red test green. `POST /api/webhooks/stripe`
   * calls `recordWebhookEvent` before it acknowledges, and on this shared local
   * stack that call intermittently comes back as a Kong 502: PostgREST resets a
   * pooled upstream connection (`recv() failed (104: Connection reset by peer)
   * ... POST /rest/v1/stripe_webhook_events`, Kong answers 502) while the
   * container itself never restarts and Postgres sits at 20 of 100 connections.
   * The route's response to that is correct and deliberate — the ledger row was
   * never written, so a 5xx tells the provider to deliver again and the retry is
   * clean. Swallowing it here would assert the opposite of the contract; not
   * retrying at all would make the suite fail for an upstream hiccup that the
   * production caller is specified to absorb. So the suite behaves like the
   * caller it stands in for, and a persistent 5xx still fails the assertion.
   */
  async function postWebhook(delivery: Delivery): Promise<number> {
    let status = 0;
    for (let attempt = 1; attempt <= WEBHOOK_POST_ATTEMPTS; attempt += 1) {
      const response = await fetch(`${baseUrl}/api/webhooks/stripe`, {
        body: delivery.body,
        headers: {
          "content-type": "application/json",
          "stripe-signature": delivery.header,
        },
        method: "POST",
      });
      status = response.status;
      if (status < 500) return status;
      if (attempt < WEBHOOK_POST_ATTEMPTS) await delay(WEBHOOK_RETRY_MS);
    }
    return status;
  }

  async function callBilling(
    method: "GET" | "POST",
    route: string,
  ): Promise<{ payload: unknown; status: number }> {
    const response = await fetch(`${baseUrl}${route}`, {
      headers: {
        cookie,
        ...(method === "POST" ? { origin: new URL(baseUrl).origin } : {}),
      },
      method,
    });
    const raw = await response.text();
    let payload: unknown = null;
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      payload = null;
    }
    return { payload, status: response.status };
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  before(async () => {
    admin = createAdminClient();
    db = admin as unknown as FixtureClient;

    // The fixture reference is globally unique by partial index, so a crashed
    // earlier run of this suite would block this one. Only a row belonging to
    // this suite's own org-slug family is removed; anything else means another
    // worktree is mid-run and this suite must not touch it.
    const stale = await db
      .from("operator_subscriptions")
      .select("org_id")
      .eq("subscription_ref", FIXTURE_SUBSCRIPTION_REF)
      .maybeSingle();
    const staleOrgId = text(row(stale.data)?.org_id);
    if (staleOrgId !== null) {
      const owner = await db
        .from("orgs")
        .select("slug")
        .eq("id", staleOrgId)
        .maybeSingle();
      const ownerSlug = text(row(owner.data)?.slug) ?? "";
      assert.ok(
        ownerSlug.startsWith("mf-p10-dunning-"),
        `${FIXTURE_SUBSCRIPTION_REF} is held by an organization this suite did not create; refusing to touch it`,
      );
      await db.from("operator_subscriptions").delete().eq("org_id", staleOrgId);
      await db.from("operator_seat_sync_outbox").delete().eq("org_id", staleOrgId);
    }

    const org = await db.from("orgs").insert({
      id: orgId,
      name: `Phase 10 Dunning ${runId}`,
      seats_included: SEATS_INCLUDED,
      slug,
    });
    assert.equal(org.error, null, "seeding the organization failed");

    // Seeded before the members, because migration 072's trigger stays quiet
    // for an organization with no subscription — the seat count only becomes an
    // outbox row once there is something to bill it against.
    const subscription = await db.from("operator_subscriptions").insert({
      base_item_ref: "mock_si_base_operator_dunning",
      base_price_ref: "mock_price_operator_base",
      customer_ref: FIXTURE_CUSTOMER_REF,
      org_id: orgId,
      provider: "mock",
      seat_item_ref: "mock_si_seat_operator_dunning",
      seat_price_ref: "mock_price_operator_seat",
      seat_quantity: 0,
      status: "active",
      subscription_ref: FIXTURE_SUBSCRIPTION_REF,
    });
    assert.equal(subscription.error, null, "seeding the subscription failed");

    for (let index = 0; index < INITIAL_MEMBERS; index += 1) {
      await addMember(index);
    }

    port = await freePort();
    const child = await startChildServer({
      flags: {
        BILLING_DRIVER: "mock",
        FEATURE_BILLING: "1",
        FEATURE_REAL_AUTH: "1",
      },
      port,
      stack: stack as NonNullable<typeof stack>,
      webhookSigningValue,
    });
    baseUrl = child.baseUrl;
    pid = child.pid;

    // The application's own sign-in route, so the session cookie is minted the
    // way production mints it rather than assembled by hand here.
    const signInUrl = new URL("/api/auth/sign-in", baseUrl);
    const signIn = await fetch(signInUrl, {
      body: JSON.stringify({ email: ownerEmail(), password }),
      headers: {
        "content-type": "application/json",
        origin: signInUrl.origin,
      },
      method: "POST",
      redirect: "manual",
    });
    assert.ok(
      signIn.status >= 200 && signIn.status < 400,
      `sign-in returned ${signIn.status}`,
    );
    const jar = (signIn.headers as unknown as CookieHeaders).getSetCookie();
    cookie = jar
      .map((entry) => entry.split(";")[0])
      .filter((entry): entry is string => Boolean(entry))
      .join("; ");
    assert.ok(cookie.length > 0, "sign-in set no session cookie");
  });

  after(async () => {
    // Ordered so migration 072's trigger stays quiet while the members go: with
    // the subscription already gone it returns early, and no outbox row is
    // enqueued behind the cleanup.
    if (db !== undefined) {
      await db.from("operator_subscriptions").delete().eq("org_id", orgId);
    }

    for (const memberId of memberIds) {
      await admin?.auth.admin.deleteUser(memberId).catch(() => undefined);
    }

    if (db !== undefined) {
      await db.from("operator_seat_sync_outbox").delete().eq("org_id", orgId);
      await db.from("stripe_webhook_events").delete().in("event_id", ledgerIds);
      // Attempted, not assumed: it succeeds only when the run wrote no trail
      // row, and the append-only trigger refusing it is the documented case.
      await db.from("orgs").delete().eq("id", orgId);
    }

    if (pid !== null && port !== null) stopChild(pid, port);
  });

  function ownerEmail(): string {
    return `mf-p10-dunning-${runId}-0@example.invalid`;
  }

  async function addMember(index: number): Promise<void> {
    const email = `mf-p10-dunning-${runId}-${index}@example.invalid`;
    const created = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      password,
    });
    assert.ok(created.data.user, `creating member ${index} failed`);
    const memberId = created.data.user.id;
    memberIds.push(memberId);

    // upsert, not insert: migration 010's `on_auth_user_created` trigger has
    // already written a narrow consumer-shaped row for this user.
    const profile = await db.from("profiles").upsert({
      email,
      full_name: `Dunning Member ${index}`,
      id: memberId,
      manages: [],
      org_id: orgId,
      org_role: index === 0 ? "owner" : "prep_specialist",
      phone: null,
      role: "operator_member",
    });
    assert.equal(profile.error, null, `seeding member ${index} failed`);
  }

  async function removeMember(index: number): Promise<void> {
    const memberId = memberIds[index];
    assert.ok(memberId, `member ${index} was never created`);
    const removed = await admin.auth.admin.deleteUser(memberId);
    assert.equal(removed.error, null, `removing member ${index} failed`);
    memberIds.splice(index, 1);
  }

  // -------------------------------------------------------------------------
  // The ladder
  // -------------------------------------------------------------------------

  it("walks current, past_due, grace, deactivated and back to current", async () => {
    assert.equal(
      await readMembership(),
      "trial",
      "the seeded organization must start on trial, so every rung below is a real move",
    );

    for (const [index, expected] of LADDER.entries()) {
      const delivery = deliveries[index];
      assert.ok(delivery, `fixture event ${index} is missing`);

      assert.equal(
        await postWebhook(delivery),
        200,
        `${delivery.label} was not acknowledged`,
      );

      const landed = await waitFor({
        label: `${delivery.label} → ${expected}`,
        matches: (value: string | null) => value === expected,
        read: readMembership,
      });
      assert.equal(landed, expected, delivery.label);

      if (expected === "grace") {
        const subscription = await readSubscription();
        const startedAt = text(subscription?.grace_started_at);
        const until = text(subscription?.grace_until);
        assert.ok(startedAt, "grace_started_at must be recorded on the grace rung");
        assert.ok(until, "grace_until must be recorded on the grace rung");
        assert.ok(
          Date.parse(until) > Date.parse(startedAt),
          "grace_until must be later than grace_started_at",
        );
      }
    }

    const settled = await readSubscription();
    assert.equal(
      text(settled?.grace_until),
      null,
      "returning to current must clear the grace window rather than leave it standing",
    );
  });

  it("moves nothing when the grace event is redelivered verbatim", async () => {
    const before = { membership: await readMembership(), trail: await countTrail() };
    const duplicate = deliveries[5];
    assert.ok(duplicate, "the fixture stream carries no duplicate event");
    assert.equal(
      duplicate.body,
      deliveries[2]?.body,
      "the duplicate must be byte-identical to the grace event",
    );

    assert.equal(await postWebhook(duplicate), 200, "the duplicate was not acknowledged");

    // There is no row to poll for when the correct outcome is that nothing
    // happens, so the callback is given more time than it needs and the world
    // is then asserted to be where it was.
    await settle();

    assert.equal(await readMembership(), before.membership, "the duplicate moved the rung");
    assert.equal(await countTrail(), before.trail, "the duplicate added a trail row");
  });

  it("records an older event as stale and leaves the rung alone", async () => {
    const before = await readMembership();
    const stale = deliveries[6];
    assert.ok(stale, "the fixture stream carries no out-of-order event");

    assert.equal(await postWebhook(stale), 200, "the stale event was not acknowledged");

    const recorded = await waitFor({
      label: "the out-of-order event reaching the trail",
      matches: (value: Record<string, unknown> | null) => value !== null,
      read: () => readTrailRow(stale.eventId),
    });

    assert.equal(recorded?.reason_code, "stale_event");
    assert.equal(recorded?.applied, false);
    assert.equal(
      await readMembership(),
      before,
      "an event older than the one already recorded must not move the rung",
    );
  });

  it("hands a consumer event to lane B and moves no operator rung", async () => {
    const before = { membership: await readMembership(), trail: await countTrail() };
    const eventId = `evt_mock_consumer_${runId}`;
    ledgerIds.push(eventId);

    // A reference no `operator_subscriptions` row carries, which is what makes
    // `handleOperatorBillingEvent` decline and the fall-through run. Building a
    // real `consumer_subscriptions` row instead would need two `public.consents`
    // rows, and migration 002 makes those append-only — this suite would leave
    // permanent rows in lane B's consent trail on a shared database. The
    // assertion below is about the fall-through either way: `ignored` is a
    // status only `processWebhookEvent` writes.
    const body = JSON.stringify({
      created: Math.floor(Date.now() / 1000),
      customer: `mock_cus_consumer_${runId}`,
      id: eventId,
      subscription: `mock_sub_consumer_${runId}`,
      type: "invoice.paid",
    });

    assert.equal(
      await postWebhook({
        body,
        eventId,
        header: signMockWebhook(body, Math.floor(Date.now() / 1000), webhookSigningValue),
        label: "a consumer invoice",
      }),
      200,
    );

    const status = await waitFor({
      label: "lane B finishing the consumer event",
      matches: (value: string | null) => value !== null && value !== "received",
      read: () => readLedgerStatus(eventId),
    });

    assert.equal(status, "ignored", "lane B's handler is what must have run");
    assert.equal(await readMembership(), before.membership);
    assert.equal(await countTrail(), before.trail);
    assert.equal(
      await readTrailRow(eventId),
      null,
      "a consumer event must leave no operator trail row",
    );
  });

  // -------------------------------------------------------------------------
  // Seats
  // -------------------------------------------------------------------------

  it("syncs a seat count increase through the outbox", async () => {
    await addMember(INITIAL_MEMBERS);

    const pending = await waitFor({
      label: "the outbox reaching three paid seats",
      matches: (value: Record<string, unknown> | null) =>
        value?.desired_quantity === 3 && value.status === "pending",
      read: readOutbox,
    });
    assert.equal(pending?.desired_quantity, 3);

    const { payload, status } = await callBilling("POST", "/api/billing/seats/sync");
    assert.equal(status, 200, "the sync route refused an operator owner");
    assert.deepEqual(payload, {
      enabled: true,
      seats: { quantity: 3, reason: "synced", synced: true },
    });

    assert.equal((await readOutbox())?.status, "synced");
    assert.equal((await readSubscription())?.seat_quantity, 3);
  });

  it("syncs a seat count decrease through the same path", async () => {
    await removeMember(memberIds.length - 1);
    await removeMember(memberIds.length - 1);

    const pending = await waitFor({
      label: "the outbox reaching one paid seat",
      matches: (value: Record<string, unknown> | null) =>
        value?.desired_quantity === 1 && value.status === "pending",
      read: readOutbox,
    });
    assert.equal(pending?.desired_quantity, 1);

    const { payload, status } = await callBilling("POST", "/api/billing/seats/sync");
    assert.equal(status, 200);
    assert.deepEqual(payload, {
      enabled: true,
      seats: { quantity: 1, reason: "synced", synced: true },
    });

    assert.equal((await readOutbox())?.status, "synced");
    assert.equal((await readSubscription())?.seat_quantity, 1);
  });

  // -------------------------------------------------------------------------
  // The read
  // -------------------------------------------------------------------------

  it("reports the state the database holds", async () => {
    const { payload, status } = await callBilling("GET", "/api/billing/subscription");
    assert.equal(status, 200, "the read route refused an operator owner");

    const body = row(payload);
    assert.equal(body?.enabled, true);
    const billing = row(body?.billing);
    assert.ok(billing, "the route returned no billing state");

    const subscription = await readSubscription();
    const outbox = await readOutbox();

    assert.equal(billing.membership, await readMembership());
    assert.equal(billing.plan, await readOrgColumn("plan"));
    assert.equal(billing.seatsIncluded, SEATS_INCLUDED);
    assert.equal(billing.seatQuantity, subscription?.seat_quantity);
    assert.equal(billing.status, subscription?.status);
    assert.equal(billing.subscriptionRef, FIXTURE_SUBSCRIPTION_REF);
    assert.equal(billing.graceUntil, text(subscription?.grace_until));
    assert.equal(billing.cancelAtPeriodEnd, subscription?.cancel_at_period_end);
    assert.deepEqual(billing.seatSync, {
      attempts: outbox?.attempts,
      desiredQuantity: outbox?.desired_quantity,
      status: outbox?.status,
    });

    // BILL-03 as persisted state: both references were recorded when the row
    // was created and are the ones `config.ts` resolves with no environment.
    assert.equal(subscription?.base_price_ref, "mock_price_operator_base");
    assert.equal(subscription?.seat_price_ref, "mock_price_operator_seat");
  });
});
