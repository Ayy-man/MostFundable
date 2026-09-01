import assert from "node:assert/strict";
import test from "node:test";

import { AuthError } from "@/lib/auth/errors";
import { createInviteService } from "@/lib/tenancy/invites";
import type { TenancyRepository } from "@/lib/tenancy/repository";
import { handleCreateInvite } from "./route.ts";

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const INVITE_ID = "33333333-3333-4333-8333-333333333333";
const PROVIDER_ID = "44444444-4444-4444-8444-444444444444";
const KEY = "55555555-5555-4555-8555-555555555555";
const TOKEN_ID = "66666666-6666-4666-8666-666666666666";
const SESSION = {
  id: "11111111-1111-4111-8111-111111111111", role: "operator_member" as const,
  orgId: ORG_ID, orgRole: "owner" as const, manages: [], disabledAt: null, orgMembership: "current" as const,
};

function repository(overrides: Partial<TenancyRepository> = {}): TenancyRepository {
  return {
    async acceptInvite() { throw new Error(); },
    async createInvite() { return { inviteId: INVITE_ID, orgId: ORG_ID, tokenId: TOKEN_ID }; },
    async deactivateMember() { throw new Error(); },
    async expireTrials() { throw new Error(); },
    async findClaimedOrgBySlug() { return null; },
    async findMember() { return null; },
    async provisionTenant() { throw new Error(); },
    async publishBrand() { throw new Error(); },
    async readBrand() { return null; },
    async readPublishedBrand() { return null; },
    async recordInviteDelivery() {},
    async runTenantAction() { throw new Error(); },
    async updateBrand() { throw new Error(); },
    ...overrides,
  };
}

function service(overrides: Partial<TenancyRepository> = {}) {
  return createInviteService({
    repository: repository(overrides),
    inviteSender: { async send() { return { providerUserId: PROVIDER_ID }; } },
    verifier: { async verify() { throw new Error(); } },
    seatSynchronizer: { async sync() { return { reason: "synced" }; } },
  });
}

function request(body: unknown): Request {
  return new Request("http://localhost/api/invites", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": KEY },
    body: JSON.stringify(body),
  });
}

const BODY = { email: "target@example.test", fullName: "Target", kind: "team", orgRole: "member" };

test("feature-off and authorization failures precede invite service construction", async () => {
  let touched = false;
  const off = await handleCreateInvite(request(BODY), {
    enabled: () => false,
    async requireOperator() { touched = true; return SESSION; },
    async service() { touched = true; return service(); },
  });
  assert.equal(off.status, 404);
  assert.equal(touched, false);

  const forbidden = await handleCreateInvite(request(BODY), {
    enabled: () => true,
    async requireOperator() { throw new AuthError(403, "forbidden", "private role detail"); },
    async service() { touched = true; return service(); },
  });
  assert.equal(forbidden.status, 403);
  assert.doesNotMatch(await forbidden.text(), /private role detail/);
});

test("valid owner invite returns only the durable row and org identifiers", async () => {
  const response = await handleCreateInvite(request(BODY), {
    enabled: () => true,
    async requireOperator() { return SESSION; },
    async service() { return service(); },
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json() as { invite: { inviteId: string; orgId: string } };
  assert.equal(body.invite.inviteId, INVITE_ID);
  assert.equal(body.invite.orgId, ORG_ID);
  assert.doesNotMatch(JSON.stringify(body), new RegExp(TOKEN_ID));
});

test("valid client invite uses the same durable delivery rail without an operator role", async () => {
  let received: unknown;
  const response = await handleCreateInvite(request({
    email: "consumer@example.test",
    fullName: "Consumer Client",
    kind: "client",
    orgRole: null,
  }), {
    enabled: () => true,
    async requireOperator() { return SESSION; },
    async service() {
      return service({
        async createInvite(input) {
          received = input;
          return { inviteId: INVITE_ID, orgId: ORG_ID, tokenId: TOKEN_ID };
        },
      });
    },
  });
  assert.equal(response.status, 201);
  assert.equal((received as { kind: string }).kind, "client");
  assert.equal((received as { orgRole: unknown }).orgRole, null);
});

test("malformed input and deactivated wall return typed errors before mutation", async () => {
  let writes = 0;
  const malformed = await handleCreateInvite(request({ ...BODY, orgRole: "root" }), {
    enabled: () => true,
    async requireOperator() { return SESSION; },
    async service() { return service({ async createInvite() { writes += 1; throw new Error(); } }); },
  });
  assert.equal(malformed.status, 400);

  const wall = await handleCreateInvite(request(BODY), {
    enabled: () => true,
    async requireOperator() { return { ...SESSION, orgMembership: "deactivated" as const }; },
    async service() { return service({ async createInvite() { writes += 1; throw new Error(); } }); },
  });
  assert.equal(wall.status, 402);
  assert.match(await wall.text(), /ORG_DEACTIVATED/);
  assert.equal(writes, 0);
});
