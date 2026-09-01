import assert from "node:assert/strict";
import test from "node:test";

import {
  createTenantAdminService,
  parseProvisionTenantBody,
  parseTenantActionBody,
} from "./admin.ts";
import { TenantError } from "./errors.ts";
import type { TenancyRepository } from "./repository.ts";

const ACTOR = { id: "11111111-1111-4111-8111-111111111111", role: "platform_admin" };
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const INVITE_ID = "33333333-3333-4333-8333-333333333333";
const PROVIDER_ID = "44444444-4444-4444-8444-444444444444";
const IDEMPOTENCY_KEY = "55555555-5555-4555-8555-555555555555";
const TOKEN_ID = "66666666-6666-4666-8666-666666666666";
const BODY = {
  email: " Owner@Example.Test ",
  fullName: " First Owner ",
  name: " Example Funding ",
  slug: " Example-Funding ",
};

function fakeRepository(overrides: Partial<TenancyRepository> = {}): TenancyRepository {
  return {
    async acceptInvite() { throw new Error("unexpected accept"); },
    async createInvite() { throw new Error("unexpected invite"); },
    async deactivateMember() { throw new Error("unexpected deactivate"); },
    async expireTrials() { throw new Error("unexpected expiry"); },
    async findClaimedOrgBySlug() { return null; },
    async findMember() { return null; },
    async provisionTenant() { return { inviteId: INVITE_ID, orgId: ORG_ID, replayed: false, tokenId: TOKEN_ID }; },
    async publishBrand() { throw new Error("unexpected publish"); },
    async readBrand() { return null; },
    async readPublishedBrand() { return null; },
    async recordInviteDelivery() {},
    async runTenantAction(input) {
      return { membership: "current", orgId: input.orgId, slug: input.slug ?? null, trialEndsAt: input.trialEndsAt ?? null };
    },
    async updateBrand() { throw new Error("unexpected brand"); },
    ...overrides,
  };
}

test("provision parser is closed, bounded, normalized, and never derives a name", () => {
  assert.deepEqual(parseProvisionTenantBody(BODY), {
    email: "owner@example.test",
    fullName: "First Owner",
    name: "Example Funding",
    slug: "example-funding",
  });
  for (const body of [
    { ...BODY, extra: true },
    { ...BODY, fullName: "" },
    { ...BODY, fullName: "x".repeat(121) },
    { ...BODY, email: "invalid" },
    { email: BODY.email, name: BODY.name, slug: BODY.slug },
    { ...BODY, slug: "admin" },
  ]) {
    assert.throws(() => parseProvisionTenantBody(body), TenantError);
  }
});

test("action parser keeps exact closed shapes including the Phase 21 slot", () => {
  assert.deepEqual(parseTenantActionBody({ action: "extend-trial", trialDays: 30 }), { action: "extend-trial", trialDays: 30 });
  assert.deepEqual(parseTenantActionBody({ action: "rename-slug", slug: " New-Slug " }), { action: "rename-slug", slug: "new-slug" });
  for (const action of ["deactivate", "reactivate"] as const) {
    assert.deepEqual(parseTenantActionBody({ action }), { action });
  }
  assert.deepEqual(parseTenantActionBody({ action: "raise-cap", cap: 5 }), { action: "raise-cap", cap: 5 });
  for (const body of [
    { action: "extend-trial", trialDays: 0 },
    { action: "deactivate", reason: "extra" },
    { action: "rename-slug", slug: "www" },
    { action: "raise-cap" },
    { action: "raise-cap", cap: 0 },
    { action: "raise-cap", cap: -1 },
    { action: "raise-cap", cap: 1.5 },
    { action: "raise-cap", cap: 2_147_483_648 },
    { action: "raise-cap", cap: 5, extra: true },
    { action: "unknown" },
  ]) assert.throws(() => parseTenantActionBody(body), TenantError);
});

test("non-platform actor is refused before repository or provider access", async () => {
  let calls = 0;
  const service = createTenantAdminService({
    repository: fakeRepository({ async provisionTenant() { calls += 1; throw new Error(); } }),
    inviteSender: { async send() { calls += 1; throw new Error(); } },
  });
  await assert.rejects(
    service.provision({ actor: { ...ACTOR, role: "operator_member" }, body: BODY, idempotencyKey: IDEMPOTENCY_KEY }),
    (error: unknown) => error instanceof TenantError && error.status === 403,
  );
  assert.equal(calls, 0);
});

test("provision captures one instant, commits before provider, and stores sent receipt", async () => {
  const events: string[] = [];
  let repositoryInput: unknown;
  const repository = fakeRepository({
    async provisionTenant(input) {
      events.push("commit");
      repositoryInput = input;
      return { inviteId: INVITE_ID, orgId: ORG_ID, replayed: false, tokenId: TOKEN_ID };
    },
    async recordInviteDelivery(input) {
      events.push(`receipt:${input.status}:${input.providerUserId}`);
    },
  });
  const service = createTenantAdminService({
    clock: () => new Date("2026-08-17T12:00:00.000Z"),
    trialDays: () => 14,
    repository,
    inviteSender: {
      async send(input) {
        events.push(`provider:${input.inviteId}:${input.email}`);
        return { providerUserId: PROVIDER_ID };
      },
    },
  });
  assert.deepEqual(
    await service.provision({ actor: ACTOR, body: BODY, idempotencyKey: IDEMPOTENCY_KEY }),
    { inviteId: INVITE_ID, orgId: ORG_ID, replayed: false, tokenId: TOKEN_ID },
  );
  assert.deepEqual(repositoryInput, {
    actorId: ACTOR.id,
    email: "owner@example.test",
    fullName: "First Owner",
    idempotencyKey: IDEMPOTENCY_KEY,
    name: "Example Funding",
    slug: "example-funding",
    trialEndsAt: "2026-08-31T12:00:00.000Z",
  });
  assert.deepEqual(events, [
    "commit",
    `provider:${TOKEN_ID}:owner@example.test`,
    `receipt:sent:${PROVIDER_ID}`,
  ]);
});

test("provider failure persists failed receipt and cannot return success", async () => {
  const receipts: unknown[] = [];
  const service = createTenantAdminService({
    repository: fakeRepository({ async recordInviteDelivery(input) { receipts.push(input); } }),
    inviteSender: { async send() { throw new Error("provider detail"); } },
  });
  await assert.rejects(
    service.provision({ actor: ACTOR, body: BODY, idempotencyKey: IDEMPOTENCY_KEY }),
    (error: unknown) =>
      error instanceof TenantError &&
      error.status === 502 &&
      error.code === "TENANT_INVITE_DELIVERY_FAILED" &&
      !error.message.includes("provider detail"),
  );
  assert.deepEqual(receipts, [{
    actorId: ACTOR.id,
    errorCode: "provider_unavailable",
    inviteId: INVITE_ID,
    status: "failed",
  }]);
});

test("same idempotency retry delegates the same durable invite without creating a new identity", async () => {
  const keys: string[] = [];
  const service = createTenantAdminService({
    repository: fakeRepository({
      async provisionTenant(input) {
        keys.push(input.idempotencyKey);
        return { inviteId: INVITE_ID, orgId: ORG_ID, replayed: keys.length > 1, tokenId: TOKEN_ID };
      },
    }),
    inviteSender: { async send() { return { providerUserId: PROVIDER_ID }; } },
  });
  const first = await service.provision({ actor: ACTOR, body: BODY, idempotencyKey: IDEMPOTENCY_KEY });
  const second = await service.provision({ actor: ACTOR, body: BODY, idempotencyKey: IDEMPOTENCY_KEY });
  assert.equal(first.orgId, second.orgId);
  assert.equal(first.inviteId, second.inviteId);
  assert.deepEqual(keys, [IDEMPOTENCY_KEY, IDEMPOTENCY_KEY]);
});

test("implemented actions delegate exactly once and unavailable raise-cap performs zero repository work", async () => {
  const calls: unknown[] = [];
  const service = createTenantAdminService({
    clock: () => new Date("2026-08-17T00:00:00.000Z"),
    repository: fakeRepository({
      async runTenantAction(input) {
        calls.push(input);
        return { membership: "trial", orgId: input.orgId, slug: input.slug ?? null, trialEndsAt: input.trialEndsAt ?? null };
      },
    }),
    inviteSender: { async send() { throw new Error(); } },
  });
  await service.act({ actor: ACTOR, orgId: ORG_ID, body: { action: "extend-trial", trialDays: 7 } });
  await service.act({ actor: ACTOR, orgId: ORG_ID, body: { action: "deactivate" } });
  await service.act({ actor: ACTOR, orgId: ORG_ID, body: { action: "reactivate" } });
  await service.act({ actor: ACTOR, orgId: ORG_ID, body: { action: "rename-slug", slug: "next-slug" } });
  assert.equal(calls.length, 4);
  assert.deepEqual(calls[0], {
    action: "extend-trial",
    actorId: ACTOR.id,
    orgId: ORG_ID,
    slug: undefined,
    trialEndsAt: "2026-08-24T00:00:00.000Z",
  });
  await assert.rejects(
    service.act({ actor: ACTOR, orgId: ORG_ID, body: { action: "raise-cap", cap: 5 } }),
    (error: unknown) => error instanceof TenantError && error.status === 501,
  );
  assert.equal(calls.length, 4);
});

test("raise-cap calls only the injected billing dependency", async () => {
  const calls: unknown[] = [];
  const service = createTenantAdminService({
    repository: fakeRepository({ async runTenantAction(input) { calls.push(input); throw new Error(); } }),
    inviteSender: { async send() { throw new Error(); } },
    async raiseClientCap(input) {
      calls.push(input);
      return { clientCap: input.cap };
    },
  });
  assert.deepEqual(
    await service.act({ actor: ACTOR, orgId: ORG_ID, body: { action: "raise-cap", cap: 8 } }),
    { clientCap: 8, membership: null, orgId: ORG_ID, slug: null, trialEndsAt: null },
  );
  assert.deepEqual(calls, [{ actorId: ACTOR.id, cap: 8, orgId: ORG_ID }]);
});

test("lifecycle transition errors remain typed", async () => {
  const expected = new TenantError(409, "TENANT_REACTIVATION_REQUIRES_TRIAL_EXTENSION", "Extend the trial first.");
  const service = createTenantAdminService({
    repository: fakeRepository({ async runTenantAction() { throw expected; } }),
    inviteSender: { async send() { throw new Error(); } },
  });
  await assert.rejects(
    service.act({ actor: ACTOR, orgId: ORG_ID, body: { action: "reactivate" } }),
    (error) => error === expected,
  );
});
