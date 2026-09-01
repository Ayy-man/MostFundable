import assert from "node:assert/strict";
import test from "node:test";

import { createInviteMailSender } from "./invite-mail.ts";
import { createInviteService, parseInviteBody, type InviteActor } from "./invites.ts";
import { TenantBillingWallError, TenantError } from "./errors.ts";
import type { TenancyRepository } from "./repository.ts";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const INVITE_ID = "33333333-3333-4333-8333-333333333333";
const PROVIDER_ID = "44444444-4444-4444-8444-444444444444";
const IDEMPOTENCY_KEY = "55555555-5555-4555-8555-555555555555";
const TOKEN_ID = "66666666-6666-4666-8666-666666666666";
const TARGET_ID = "77777777-7777-4777-8777-777777777777";

const ACTOR: InviteActor = {
  disabledAt: null,
  id: ACTOR_ID,
  orgId: ORG_ID,
  orgMembership: "current",
  orgRole: "owner",
  role: "operator_member",
};

function repository(overrides: Partial<TenancyRepository> = {}): TenancyRepository {
  return {
    async acceptInvite() { return { affiliateId: null, clientId: null, kind: "team", orgId: ORG_ID, profileId: PROVIDER_ID }; },
    async createInvite() { return { inviteId: INVITE_ID, orgId: ORG_ID, tokenId: TOKEN_ID }; },
    async deactivateMember() { return { applied: true, customerRef: "customer_ref", orgId: ORG_ID, profileId: TARGET_ID }; },
    async expireTrials() { throw new Error("unexpected expiry"); },
    async findClaimedOrgBySlug() { return null; },
    async findMember() { return null; },
    async provisionTenant() { throw new Error("unexpected provision"); },
    async publishBrand() { throw new Error("unexpected publish"); },
    async readBrand() { return null; },
    async readPublishedBrand() { return null; },
    async recordInviteDelivery() {},
    async runTenantAction() { throw new Error("unexpected action"); },
    async updateBrand() { throw new Error("unexpected brand"); },
    ...overrides,
  };
}

function service(overrides: Partial<Parameters<typeof createInviteService>[0]> = {}) {
  return createInviteService({
    clock: () => new Date("2026-08-17T00:00:00.000Z"),
    repository: repository(),
    inviteSender: { async send() { return { providerUserId: PROVIDER_ID }; } },
    verifier: { async verify() { return { email: "target@example.test", metadataInviteId: TOKEN_ID, providerUserId: PROVIDER_ID }; } },
    seatSynchronizer: { async sync() { return { reason: "synced" }; } },
    ...overrides,
  });
}

test("invite parser requires a bounded name and enforces closed invite roles", () => {
  assert.deepEqual(parseInviteBody({
    email: " TARGET@Example.Test ", fullName: " Target User ", kind: "team", orgRole: "member",
  }), {
    email: "target@example.test", expiresInDays: 7, fullName: "Target User", kind: "team", orgRole: "member",
  });
  assert.deepEqual(parseInviteBody({
    email: "affiliate@example.test", fullName: "Affiliate User", kind: "affiliate",
  }), {
    email: "affiliate@example.test", expiresInDays: 7, fullName: "Affiliate User", kind: "affiliate", orgRole: null,
  });
  assert.deepEqual(parseInviteBody({
    email: "client@example.test", fullName: "Client User", kind: "client",
  }), {
    email: "client@example.test", expiresInDays: 7, fullName: "Client User", kind: "client", orgRole: null,
  });
  for (const body of [
    { email: "target@example.test", kind: "team", orgRole: "member" },
    { email: "target@example.test", fullName: "Target", kind: "team", orgRole: "superadmin" },
    { email: "target@example.test", fullName: "Target", kind: "affiliate", orgRole: "member" },
    { email: "target@example.test", fullName: "Target", kind: "team", orgRole: "member", extra: true },
    { email: "target@example.test", fullName: "x".repeat(121), kind: "team", orgRole: "member" },
  ]) assert.throws(() => parseInviteBody(body), TenantError);
});

test("mail adapter sends only the non-secret invite correlation metadata and fails closed", async () => {
  let call: unknown;
  const sender = createInviteMailSender({
    auth: { admin: { async inviteUserByEmail(email, options) {
      call = { email, options };
      return { data: { user: { id: PROVIDER_ID } }, error: null };
    } } },
  });
  assert.deepEqual(await sender.send({ email: "target@example.test", inviteId: TOKEN_ID }), { providerUserId: PROVIDER_ID });
  assert.deepEqual(call, {
    email: "target@example.test",
    options: { data: { invite_id: TOKEN_ID } },
  });

  const refused = createInviteMailSender({
    auth: { admin: { async inviteUserByEmail() {
      return { data: { user: null }, error: { message: "credential detail" } };
    } } },
  });
  await assert.rejects(
    refused.send({ email: "target@example.test", inviteId: TOKEN_ID }),
    (error: unknown) => error instanceof Error && !error.message.includes("credential detail"),
  );
});

test("manual invite commits before provider and records sent outcome", async () => {
  const events: string[] = [];
  const created = await service({
    repository: repository({
      async createInvite(input) {
        events.push(`commit:${input.orgRole}:${input.expiresAt}`);
        return { inviteId: INVITE_ID, orgId: ORG_ID, tokenId: TOKEN_ID };
      },
      async recordInviteDelivery(input) { events.push(`receipt:${input.status}`); },
    }),
    inviteSender: { async send({ inviteId }) { events.push(`provider:${inviteId}`); return { providerUserId: PROVIDER_ID }; } },
  }).create({
    actor: ACTOR,
    body: { email: "target@example.test", fullName: "Target", kind: "team", orgRole: "member", expiresInDays: 3 },
    idempotencyKey: IDEMPOTENCY_KEY,
  });
  assert.equal(created.inviteId, INVITE_ID);
  assert.deepEqual(events, [
    "commit:member:2026-08-20T00:00:00.000Z",
    `provider:${TOKEN_ID}`,
    "receipt:sent",
  ]);
});

test("provider failure persists failed outcome and exposes no provider detail", async () => {
  const receipts: unknown[] = [];
  const instance = service({
    repository: repository({ async recordInviteDelivery(input) { receipts.push(input); } }),
    inviteSender: { async send() { throw new Error("mail credential detail"); } },
  });
  await assert.rejects(
    instance.create({
      actor: ACTOR,
      body: { email: "target@example.test", fullName: "Target", kind: "affiliate" },
      idempotencyKey: IDEMPOTENCY_KEY,
    }),
    (error: unknown) => error instanceof TenantError && error.code === "TENANT_INVITE_DELIVERY_FAILED" && !error.message.includes("credential"),
  );
  assert.equal((receipts[0] as { status: string }).status, "failed");
});

test("owner/admin authorization and billing wall precede invite mutation", async () => {
  let calls = 0;
  const instance = service({ repository: repository({ async createInvite() { calls += 1; throw new Error(); } }) });
  for (const actor of [
    { ...ACTOR, orgRole: "member" as const },
    { ...ACTOR, disabledAt: "2026-08-17T00:00:00Z" },
  ]) {
    await assert.rejects(instance.create({
      actor,
      body: { email: "target@example.test", fullName: "Target", kind: "team", orgRole: "member" },
      idempotencyKey: IDEMPOTENCY_KEY,
    }), TenantError);
  }
  await assert.rejects(instance.create({
    actor: { ...ACTOR, orgMembership: "deactivated" },
    body: { email: "target@example.test", fullName: "Target", kind: "team", orgRole: "member" },
    idempotencyKey: IDEMPOTENCY_KEY,
  }), TenantBillingWallError);
  assert.equal(calls, 0);
});

test("OTP verification and metadata match precede durable team acceptance and seat sync", async () => {
  const events: string[] = [];
  const accepted = await service({
    verifier: { async verify() { events.push("verify"); return { email: "TARGET@example.test", metadataInviteId: TOKEN_ID, providerUserId: PROVIDER_ID }; } },
    repository: repository({ async acceptInvite(input) {
      events.push(`accept:${input.email}:${input.tokenId}`);
      return { affiliateId: null, clientId: null, kind: "team", orgId: ORG_ID, profileId: PROVIDER_ID };
    } }),
    seatSynchronizer: { async sync(orgId) { events.push(`seat:${orgId}`); return { reason: "synced" }; } },
  }).accept({ tokenHash: "otp-token-value", tokenId: TOKEN_ID });
  assert.equal(accepted.kind, "team");
  assert.deepEqual(events, ["verify", `accept:target@example.test:${TOKEN_ID}`, `seat:${ORG_ID}`]);
});

test("mismatched identity and invalid/replayed database outcomes share one typed result", async () => {
  let accepted = false;
  await assert.rejects(service({
    verifier: { async verify() { return { email: "target@example.test", metadataInviteId: INVITE_ID, providerUserId: PROVIDER_ID }; } },
    repository: repository({ async acceptInvite() { accepted = true; throw new Error(); } }),
  }).accept({ tokenHash: "otp-token-value", tokenId: TOKEN_ID }),
  (error: unknown) => error instanceof TenantError && error.code === "TENANT_INVITE_INVALID");
  assert.equal(accepted, false);

  const invalid = new TenantError(409, "TENANT_INVITE_INVALID", "The invitation is invalid.");
  await assert.rejects(service({
    repository: repository({ async acceptInvite() { throw invalid; } }),
  }).accept({ tokenHash: "otp-token-value", tokenId: TOKEN_ID }), (error) => error === invalid);
});

test("affiliate acceptance creates no operator seat call", async () => {
  let seats = 0;
  const result = await service({
    repository: repository({ async acceptInvite() {
      return { affiliateId: TARGET_ID, clientId: null, kind: "affiliate", orgId: ORG_ID, profileId: PROVIDER_ID };
    } }),
    seatSynchronizer: { async sync() { seats += 1; return { reason: "synced" }; } },
  }).accept({ tokenHash: "otp-token-value", tokenId: TOKEN_ID });
  assert.equal(result.kind, "affiliate");
  assert.equal(seats, 0);
});

test("client acceptance returns its client binding and creates no operator seat call", async () => {
  let seats = 0;
  const result = await service({
    repository: repository({ async acceptInvite() {
      return {
        affiliateId: null,
        clientId: TARGET_ID,
        kind: "client",
        orgId: ORG_ID,
        profileId: PROVIDER_ID,
      };
    } }),
    seatSynchronizer: { async sync() { seats += 1; return { reason: "synced" }; } },
  }).accept({ tokenHash: "otp-token-value", tokenId: TOKEN_ID });
  assert.equal(result.kind, "client");
  assert.equal(result.clientId, TARGET_ID);
  assert.equal(seats, 0);
});

test("seat failure is reported after durable acceptance for outbox retry", async () => {
  let accepted = false;
  await assert.rejects(service({
    repository: repository({ async acceptInvite() {
      accepted = true;
      return { affiliateId: null, clientId: null, kind: "team", orgId: ORG_ID, profileId: PROVIDER_ID };
    } }),
    seatSynchronizer: { async sync() { return { reason: "driver_rejected" }; } },
  }).accept({ tokenHash: "otp-token-value", tokenId: TOKEN_ID }),
  (error: unknown) => error instanceof TenantError && error.code === "TENANT_SEAT_SYNC_FAILED");
  assert.equal(accepted, true);
});

test("offboarding commits before seat sync and preserves self/last-owner database refusals", async () => {
  const events: string[] = [];
  await service({
    repository: repository({ async deactivateMember(input) {
      events.push(`commit:${input.targetId}`);
      return { applied: true, customerRef: "customer_ref", orgId: ORG_ID, profileId: TARGET_ID };
    } }),
    seatSynchronizer: { async sync() { events.push("seat"); return { reason: "synced" }; } },
  }).deactivate({ actor: ACTOR, targetId: TARGET_ID });
  assert.deepEqual(events, [`commit:${TARGET_ID}`, "seat"]);

  for (const message of ["self", "last owner"] as const) {
    const refusal = new TenantError(409, "TENANT_CONFLICT", message);
    let seats = 0;
    await assert.rejects(service({
      repository: repository({ async deactivateMember() { throw refusal; } }),
      seatSynchronizer: { async sync() { seats += 1; return { reason: "synced" }; } },
    }).deactivate({ actor: ACTOR, targetId: TARGET_ID }), (error) => error === refusal);
    assert.equal(seats, 0);
  }
});
