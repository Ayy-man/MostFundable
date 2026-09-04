import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { createAdminClient } from "@/lib/supabase/admin";
import { enrollmentBody } from "./support";
import {
  applyStackEnv,
  buildProblem,
  freePort,
  resolveStackEnv,
  stackSkipReason,
  startChildServer,
} from "./billing-support";

type DbResult = {
  count: number | null;
  data: unknown;
  error: { code?: string; message: string } | null;
};

interface Query extends PromiseLike<DbResult> {
  delete(): Query;
  eq(column: string, value: unknown): Query;
  insert(value: Record<string, unknown> | Array<Record<string, unknown>>): Query;
  maybeSingle(): PromiseLike<DbResult>;
  select(columns?: string, options?: { count?: "exact"; head?: boolean }): Query;
  update(value: Record<string, unknown>): Query;
  upsert(value: Record<string, unknown>): Query;
}

interface FixtureDb {
  from(table: string): Query;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<DbResult>;
}

type CookieHeaders = { getSetCookie(): string[] };
type Running = { pid: number; port: number };

const runMailReceipt = process.env.MF_TENANCY_MAIL_E2E === "1";
const mailpitBaseUrl = "http://127.0.0.1:54524";

function row(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function count(value: DbResult): number {
  return value.count ?? 0;
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(collectStrings);
  }
  return [];
}

async function inviteLinkFromMailpit(email: string): Promise<URL> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${mailpitBaseUrl}/api/v1/messages`);
    assert.equal(response.status, 200, "Mailpit message inventory was unavailable");
    const inventory = row(await response.json());
    const messages = Array.isArray(inventory?.messages) ? inventory.messages : [];
    const message = messages.map(row).find((candidate) => {
      const recipients = Array.isArray(candidate?.To) ? candidate.To.map(row) : [];
      return recipients.some((recipient) => text(recipient?.Address)?.toLowerCase() === email);
    });
    const messageId = text(message?.ID);
    if (messageId) {
      const detail = await fetch(`${mailpitBaseUrl}/api/v1/message/${encodeURIComponent(messageId)}`);
      assert.equal(detail.status, 200, "Mailpit message receipt was unreadable");
      const link = collectStrings(await detail.json())
        .flatMap((part) => part.match(/https?:\/\/[^\s"'<>]+\/api\/invites\/accept\?[^\s"'<>]+/g) ?? [])
        .map((part) => part.replaceAll("&amp;", "&"))
        .find((part) => part.includes("token_hash=") && part.includes("invite_id="));
      assert.ok(link, "mail receipt carried no invitation acceptance link");
      return new URL(link);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.fail(`no local mail receipt arrived for ${email}`);
}

const stack = resolveStackEnv();
const build = stack === null ? null : buildProblem();
const skip = stack === null ? stackSkipReason() : (build ?? false);
if (stack !== null) applyStackEnv(stack);

describe("Phase 20 tenancy over live local HTTP", { skip }, () => {
  const runId = randomUUID().replaceAll("-", "").slice(0, 10);
  const password = randomUUID();
  let orgId = "";
  let expiredOrgId = "";
  let duplicateOrgId = "";
  const ownerId = randomUUID();
  const memberId = randomUUID();
  const consumerId = randomUUID();
  const duplicateId = randomUUID();
  const adminId = randomUUID();
  const clientId = randomUUID();
  const slug = `p20-${runId}`;
  const renamedSlug = `p20-${runId}-renamed`;
  const duplicateSlug = `p20-${runId}-duplicate`;
  const expiredSlug = `p20-${runId}-expired`;
  const ownerEmail = `p20-owner-${runId}@example.invalid`;
  const memberEmail = `p20-member-${runId}@example.invalid`;
  const consumerEmail = `p20-consumer-${runId}@example.invalid`;
  const duplicateEmail = `p20-duplicate-${runId}@example.invalid`;
  const adminEmail = `p20-admin-${runId}@example.invalid`;
  const children: Running[] = [];

  let admin: ReturnType<typeof createAdminClient>;
  let db: FixtureDb;
  let enabledBase = "";
  let offBase = "";
  let defaultBase = "";
  let ownerCookie = "";
  let consumerCookie = "";
  let adminCookie = "";
  let currentSlug = slug;

  function hostUrl(baseUrl: string, hostname: string, path: string): string {
    const origin = new URL(baseUrl);
    origin.hostname = hostname;
    return new URL(path, origin).toString();
  }

  async function createUser(input: {
    email: string;
    id: string;
    name: string;
    orgId: string | null;
    orgRole: string | null;
    role: string;
  }): Promise<void> {
    const created = await admin.auth.admin.createUser({
      email: input.email,
      email_confirm: true,
      id: input.id,
      password,
    });
    assert.ok(created.data.user, `synthetic ${input.role} Auth user was not created`);
    const profile = await db.from("profiles").upsert({
      disabled_at: null,
      email: input.email,
      full_name: input.name,
      id: input.id,
      manages: [],
      org_id: input.orgId,
      org_role: input.orgRole,
      phone: null,
      role: input.role,
    });
    assert.equal(profile.error, null, `synthetic ${input.role} profile was not persisted`);
  }

  async function provisionFixtureOrg(input: {
    name: string;
    slug: string;
  }): Promise<string> {
    const result = await db.rpc("tenancy_provision_org", {
      p_actor_id: adminId,
      p_email: `pending-${input.slug}@example.invalid`,
      p_full_name: "Pending Owner",
      p_idempotency_key: randomUUID(),
      p_name: input.name,
      p_slug: input.slug,
      p_trial_ends_at: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    });
    assert.equal(result.error, null, `synthetic ${input.slug} organization was not provisioned`);
    const id = text(row(result.data)?.org_id);
    assert.ok(id, `synthetic ${input.slug} organization returned no id`);
    return id;
  }

  async function signIn(baseUrl: string, host: string, email: string): Promise<string> {
    const signInUrl = new URL(hostUrl(baseUrl, host, "/api/auth/sign-in"));
    const response = await fetch(signInUrl, {
      body: JSON.stringify({ email, password }),
      headers: {
        "content-type": "application/json",
        origin: signInUrl.origin,
        "x-forwarded-host": host,
      },
      method: "POST",
      redirect: "manual",
    });
    if (response.status < 200 || response.status >= 400) {
      const detail = (await response.text()).slice(0, 160).replaceAll(/\s+/g, " ");
      assert.fail(`sign-in returned ${response.status}: ${detail}`);
    }
    const cookies = (response.headers as unknown as CookieHeaders).getSetCookie();
    const cookie = cookies.map((value) => value.split(";")[0]).filter(Boolean).join("; ");
    assert.ok(cookie, "sign-in set no session cookie");
    return cookie;
  }

  async function request(input: {
    baseUrl?: string;
    body?: BodyInit;
    cookie?: string;
    headers?: Record<string, string>;
    host: string;
    method?: string;
    path: string;
  }): Promise<Response> {
    const target = new URL(hostUrl(input.baseUrl ?? defaultBase, input.host, input.path));
    return fetch(target, {
      body: input.body,
      headers: {
        ...(input.cookie ? { cookie: input.cookie } : {}),
        ...(input.method && !["GET", "HEAD"].includes(input.method)
          ? { origin: target.origin }
          : {}),
        "x-forwarded-host": input.host,
        ...input.headers,
      },
      method: input.method,
      redirect: "manual",
    });
  }

  async function readOne(table: string, columns: string, column: string, value: unknown) {
    const result = await db.from(table).select(columns).eq(column, value).maybeSingle();
    assert.equal(result.error, null, `${table} readback failed`);
    return row(result.data);
  }

  before(async () => {
    admin = createAdminClient();
    db = admin as unknown as FixtureDb;
    await createUser({ email: adminEmail, id: adminId, name: "Phase 20 Admin", orgId: null, orgRole: null, role: "platform_admin" });
    orgId = await provisionFixtureOrg({ name: `Phase 20 ${runId}`, slug });
    expiredOrgId = await provisionFixtureOrg({ name: `Phase 20 Expired ${runId}`, slug: expiredSlug });
    duplicateOrgId = await provisionFixtureOrg({ name: `Phase 20 Duplicate ${runId}`, slug: duplicateSlug });
    const expiry = await db.from("orgs").update({ trial_ends_at: new Date(Date.now() - 86_400_000).toISOString() }).eq("id", expiredOrgId);
    assert.equal(expiry.error, null, "expired trial fixture was not persisted");

    await createUser({ email: ownerEmail, id: ownerId, name: "Phase 20 Owner", orgId, orgRole: "owner", role: "operator_member" });
    await createUser({ email: memberEmail, id: memberId, name: "Phase 20 Member", orgId, orgRole: "prep_specialist", role: "operator_member" });
    await createUser({ email: consumerEmail, id: consumerId, name: "Phase 20 Consumer", orgId, orgRole: null, role: "consumer" });
    await createUser({ email: duplicateEmail, id: duplicateId, name: "Phase 20 Duplicate", orgId: duplicateOrgId, orgRole: null, role: "consumer" });

    const ownerManagers = await db.from("profiles").update({ manages: [memberId] }).eq("id", ownerId);
    assert.equal(ownerManagers.error, null, "owner manager array was not prepared");
    const client = await db.from("clients").insert({
      assigned_to: memberId,
      consumer_profile_id: consumerId,
      display_name: `Phase 20 Client ${runId}`,
      id: clientId,
      org_id: orgId,
    });
    assert.equal(client.error, null, "synthetic client was not persisted");
    const subscription = await db.from("operator_subscriptions").insert({
      base_price_ref: `mock_base_${runId}`,
      customer_ref: `mock_customer_${runId}`,
      org_id: orgId,
      provider: "mock",
      seat_item_ref: `mock_seat_item_${runId}`,
      seat_price_ref: `mock_seat_${runId}`,
      seat_quantity: 2,
      status: "active",
      subscription_ref: `mock_subscription_${runId}`,
    });
    assert.equal(subscription.error, null, "synthetic subscription was not persisted");

    const commonFlags = {
      BILLING_DRIVER: "mock",
      FEATURE_BILLING: "1",
      FEATURE_ENROLLMENT: "1",
      FEATURE_REAL_AUTH: "1",
      FEATURE_TENANCY: "1",
      IDV_DRIVER: "mock",
    };
    for (const [kind, flags] of [
      ["off", { FEATURE_REAL_AUTH: "0", FEATURE_TENANCY: "0" }],
      ["enabled", commonFlags],
      ["default", { ...commonFlags, DEFAULT_ORG_SLUG: slug }],
    ] as const) {
      const port = await freePort();
      const child = await startChildServer({ flags, port, stack: stack! });
      children.push(child);
      if (kind === "off") offBase = child.baseUrl;
      if (kind === "enabled") enabledBase = child.baseUrl;
      if (kind === "default") defaultBase = child.baseUrl;
    }

    adminCookie = await signIn(defaultBase, "localhost", adminEmail);
    ownerCookie = await signIn(defaultBase, "localhost", ownerEmail);
    consumerCookie = await signIn(defaultBase, "localhost", consumerEmail);
  });

  after(() => {
    for (const child of children) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        try { process.kill(child.pid, "SIGTERM"); } catch { /* already stopped */ }
      }
    }
  });

  it("preserves flag-off bytes and proves the default and neutral unknown paths", async () => {
    const offOne = await request({ baseUrl: offBase, host: "first.localhost", path: "/" });
    const offTwo = await request({ baseUrl: offBase, host: "second.localhost", path: "/" });
    assert.equal(offTwo.status, offOne.status);
    assert.equal(await offTwo.text(), await offOne.text());

    const unknown = await request({ baseUrl: enabledBase, host: `missing-${runId}.localhost`, path: "/operator" });
    const unknownBody = await unknown.text();
    assert.equal(unknown.status, 404);
    assert.doesNotMatch(unknownBody, new RegExp(`missing-${runId}|${slug}`, "i"));
    assert.doesNotMatch(unknownBody, /Apex Funding Partners/i);

    const platform = await request({ cookie: adminCookie, host: "localhost", path: "/admin" });
    assert.equal(platform.status, 200);
    assert.match(await platform.text(), /data-mf-surface="admin"/);
    const fallback = await request({ cookie: ownerCookie, host: "localhost", path: "/operator" });
    assert.equal(fallback.status, 200);
    assert.match(await fallback.text(), /data-mf-surface="operator"/);
  });

  it("persists, uploads, publishes, and renders the brand", async () => {
    const patch = await request({
      body: JSON.stringify({ accentColor: "#2255aa", primaryColor: "#114477" }),
      cookie: ownerCookie,
      headers: { "content-type": "application/json" },
      host: `${currentSlug}.localhost`,
      method: "PATCH",
      path: "/api/org/brand",
    });
    assert.equal(patch.status, 200);
    const patched = await readOne("orgs", "brand", "id", orgId);
    assert.equal(row(patched?.brand)?.primaryColor, "#114477");

    const form = new FormData();
    form.set("logo", new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: "image/png" }), "logo.png");
    const upload = await request({ body: form, cookie: ownerCookie, host: `${currentSlug}.localhost`, method: "PATCH", path: "/api/org/brand" });
    assert.equal(upload.status, 200);
    const uploadedPayload = row(await upload.json());
    const logoUrl = text(row(uploadedPayload?.brand)?.logoUrl);
    assert.ok(logoUrl, "brand upload returned no public URL");
    assert.equal((await fetch(logoUrl)).status, 200);

    const publish = await request({ cookie: ownerCookie, host: `${currentSlug}.localhost`, method: "POST", path: "/api/org/brand/publish" });
    assert.equal(publish.status, 200);
    const published = await readOne("orgs", "brand, brand_published_at", "id", orgId);
    assert.ok(text(published?.brand_published_at), "publish timestamp was not persisted");
    assert.equal(text(row(published?.brand)?.logoUrl), logoUrl);

    const rendered = await request({ cookie: ownerCookie, host: `${currentSlug}.localhost`, path: "/operator" });
    const html = await rendered.text();
    assert.equal(rendered.status, 200);
    assert.match(html, /--primary:#114477/);
    assert.match(html, /--ring:#2255aa/);

  });

  it("off-boards atomically and persists the lower provider seat quantity", async () => {
    const response = await request({ cookie: ownerCookie, host: `${currentSlug}.localhost`, method: "POST", path: `/api/invites/members/${memberId}/deactivate` });
    assert.equal(response.status, 200);
    const member = await readOne("profiles", "disabled_at", "id", memberId);
    assert.ok(text(member?.disabled_at), "disabled timestamp was not persisted");
    const client = await readOne("clients", "assigned_to", "id", clientId);
    assert.equal(client?.assigned_to, null);
    const owner = await readOne("profiles", "manages", "id", ownerId);
    assert.deepEqual(owner?.manages, []);
    const subscription = await readOne("operator_subscriptions", "seat_quantity", "org_id", orgId);
    assert.equal(subscription?.seat_quantity, 0);
    const outbox = await readOne("operator_seat_sync_outbox", "desired_quantity, status", "org_id", orgId);
    assert.deepEqual(outbox, { desired_quantity: 0, status: "synced" });
    const audit = await db.from("audit_log").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("action", "org.member_disabled");
    assert.equal(count(audit), 1);
  });

  it("expires a trial through run-now, walls operator writes, and leaves consumers available", async () => {
    const window = new Date().toISOString().slice(0, 10);
    const oldTuple = await db.from("background_jobs").delete().eq("job", "tenancy.trial_expiry").eq("subject", "global").eq("window", window);
    assert.equal(oldTuple.error, null, "prior tenancy run-now tuple could not be cleared");
    const run = await request({ cookie: adminCookie, host: "admin.localhost", method: "POST", path: "/api/admin/tenants/jobs/trial-expiry/run-now" });
    assert.equal(run.status, 200);
    const expired = await readOne("orgs", "membership", "id", expiredOrgId);
    assert.equal(expired?.membership, "deactivated");
    const trail = await readOne("operator_billing_events", "reason_code", "org_id", expiredOrgId);
    assert.equal(trail?.reason_code, "trial_ended");

    const deactivate = await request({
      body: JSON.stringify({ action: "deactivate" }),
      cookie: adminCookie,
      headers: { "content-type": "application/json" },
      host: "admin.localhost",
      method: "PATCH",
      path: `/api/admin/tenants/${orgId}`,
    });
    assert.equal(deactivate.status, 200);
    const wall = await request({
      body: JSON.stringify({ primaryColor: "#335577" }),
      cookie: ownerCookie,
      headers: { "content-type": "application/json" },
      host: `${currentSlug}.localhost`,
      method: "PATCH",
      path: "/api/org/brand",
    });
    assert.equal(wall.status, 402);
    assert.equal(row(row(await wall.json())?.error)?.code, "ORG_DEACTIVATED");
    const consumer = await request({ cookie: consumerCookie, host: `${currentSlug}.localhost`, path: "/consumer" });
    assert.equal(consumer.status, 200);
    assert.match(await consumer.text(), /data-mf-surface="consumer"/);
  });

  it("refuses a cross-org duplicate email before enrollment writes", async () => {
    const beforeClients = await db.from("clients").select("id", { count: "exact", head: true }).eq("org_id", orgId);
    const beforeEnrollments = await db.from("enrollments").select("id", { count: "exact", head: true }).eq("client_id", clientId);
    const response = await request({
      body: JSON.stringify(enrollmentBody({ draftId: randomUUID(), email: duplicateEmail, name: "Duplicate Refusal" })),
      cookie: consumerCookie,
      headers: { "content-type": "application/json" },
      host: `${currentSlug}.localhost`,
      method: "POST",
      path: "/api/enroll",
    });
    assert.equal(response.status, 409);
    assert.equal(row(row(await response.json())?.error)?.code, "EMAIL_ALREADY_REGISTERED");
    const afterClients = await db.from("clients").select("id", { count: "exact", head: true }).eq("org_id", orgId);
    const afterEnrollments = await db.from("enrollments").select("id", { count: "exact", head: true }).eq("client_id", clientId);
    assert.deepEqual([count(afterClients), count(afterEnrollments)], [count(beforeClients), count(beforeEnrollments)]);
  });

  it("locks the published slug and permits one audited platform rename", async () => {
    const directRename = await db.from("orgs").update({ slug: renamedSlug }).eq("id", orgId);
    assert.ok(directRename.error, "published slug accepted a direct update");
    const rename = await request({
      body: JSON.stringify({ action: "rename-slug", slug: renamedSlug }),
      cookie: adminCookie,
      headers: { "content-type": "application/json" },
      host: "localhost",
      method: "PATCH",
      path: `/api/admin/tenants/${orgId}`,
    });
    assert.equal(rename.status, 200);
    const renamed = await readOne("orgs", "slug", "id", orgId);
    assert.equal(renamed?.slug, renamedSlug);
    const renameAudit = await db.from("audit_log").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("action", "org.slug_renamed");
    assert.equal(renameAudit.error, null);
    assert.equal(count(renameAudit), 1);
    currentSlug = renamedSlug;
  });

  it("provisions through a local mail receipt and accepts the invite", {
    skip: runMailReceipt
      ? false
      : "OPEN — reload the idle shared stack and set MF_TENANCY_MAIL_E2E=1",
  }, async () => {
    const inviteEmail = `p20-invite-${runId}@example.invalid`;
    const inviteOrgSlug = `p20-${runId}-mail`;
    const inviteOwnerEmail = `p20-mail-owner-${runId}@example.invalid`;
    const inviteOwnerId = randomUUID();
    const inviteOrgId = await provisionFixtureOrg({ name: `Phase 20 Mail ${runId}`, slug: inviteOrgSlug });
    // Billable seats are members beyond `seats_included` (migration 072; the
    // column is webhook-guarded), so the expected provider quantity is derived
    // from the provisioned org rather than assumed. The fixture subscription
    // starts at 1 seat so the post-accept sync is observable as a change.
    const includedSeats = Number((await readOne("orgs", "seats_included", "id", inviteOrgId))?.seats_included ?? 0);
    const expectedSeats = Math.max(0, 2 - includedSeats);
    await createUser({
      email: inviteOwnerEmail,
      id: inviteOwnerId,
      name: "Phase 20 Mail Owner",
      orgId: inviteOrgId,
      orgRole: "owner",
      role: "operator_member",
    });
    const subscription = await db.from("operator_subscriptions").insert({
      base_price_ref: `mock_mail_base_${runId}`,
      customer_ref: `mock_mail_customer_${runId}`,
      org_id: inviteOrgId,
      provider: "mock",
      seat_item_ref: `mock_mail_seat_item_${runId}`,
      seat_price_ref: `mock_mail_seat_${runId}`,
      seat_quantity: 1,
      status: "active",
      subscription_ref: `mock_mail_subscription_${runId}`,
    });
    assert.equal(subscription.error, null, "mail e2e subscription was not persisted");

    const port = await freePort();
    const mailServer = await startChildServer({
      flags: {
        BILLING_DRIVER: "mock",
        DEFAULT_ORG_SLUG: inviteOrgSlug,
        FEATURE_BILLING: "1",
        FEATURE_REAL_AUTH: "1",
        FEATURE_TENANCY: "1",
      },
      port,
      stack: stack!,
    });
    children.push(mailServer);
    const mailOwnerCookie = await signIn(mailServer.baseUrl, "localhost", inviteOwnerEmail);
    const created = await request({
      baseUrl: mailServer.baseUrl,
      body: JSON.stringify({
        email: inviteEmail,
        fullName: "Phase 20 Invited Member",
        kind: "team",
        orgRole: "member",
      }),
      cookie: mailOwnerCookie,
      headers: {
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      host: "localhost",
      method: "POST",
      path: "/api/invites",
    });
    assert.equal(created.status, 201);
    const inviteId = text(row(row(await created.json())?.invite)?.inviteId);
    assert.ok(inviteId, "invite route returned no durable invite id");
    const sent = await readOne("invites", "provider_user_id, status", "id", inviteId);
    assert.equal(sent?.status, "sent");
    assert.ok(text(sent?.provider_user_id), "sent invite persisted no provider identity");

    const receiptLink = await inviteLinkFromMailpit(inviteEmail);
    const accepted = await request({
      baseUrl: mailServer.baseUrl,
      host: "localhost",
      path: `${receiptLink.pathname}${receiptLink.search}`,
    });
    assert.equal(accepted.status, 303);
    assert.equal(new URL(accepted.headers.get("location")!, mailServer.baseUrl).pathname, "/operator");

    const invite = await readOne(
      "invites",
      "accepted_at, accepted_profile_id, provider_user_id, status",
      "id",
      inviteId,
    );
    assert.equal(invite?.status, "accepted");
    assert.ok(text(invite?.accepted_at));
    assert.equal(invite?.accepted_profile_id, invite?.provider_user_id);
    const profile = await readOne("profiles", "disabled_at, org_id, org_role", "id", invite?.accepted_profile_id);
    assert.deepEqual(profile, { disabled_at: null, org_id: inviteOrgId, org_role: "member" });
    const seats = await readOne("operator_subscriptions", "seat_quantity", "org_id", inviteOrgId);
    assert.equal(seats?.seat_quantity, expectedSeats);
    const outbox = await readOne("operator_seat_sync_outbox", "desired_quantity, status", "org_id", inviteOrgId);
    assert.deepEqual(outbox, { desired_quantity: expectedSeats, status: "synced" });
  });
});
