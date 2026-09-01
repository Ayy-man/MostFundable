import assert from "node:assert/strict";
import test from "node:test";

import { AuthError } from "@/lib/auth/errors";
import { createTenantAdminService } from "@/lib/tenancy/admin";
import { TenantError } from "@/lib/tenancy/errors";
import type { TenancyRepository } from "@/lib/tenancy/repository";
import { handlePostTenant } from "./route.ts";

const ACTOR = { disabledAt: null, id: "11111111-1111-4111-8111-111111111111", role: "platform_admin" as const, orgId: null, orgMembership: null, orgRole: null, manages: [] };
const IDEMPOTENCY_KEY = "55555555-5555-4555-8555-555555555555";
const TOKEN_ID = "66666666-6666-4666-8666-666666666666";
const BODY = { email: "owner@example.test", fullName: "First Owner", name: "Example Funding", slug: "example-funding" };

function request(body: unknown = BODY): Request {
  return new Request("http://localhost/api/admin/tenants", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": IDEMPOTENCY_KEY },
    body: JSON.stringify(body),
  });
}

function service(overrides: Partial<TenancyRepository> = {}) {
  const repository: TenancyRepository = {
    async acceptInvite() { throw new Error(); },
    async createInvite() { throw new Error(); },
    async deactivateMember() { throw new Error(); },
    async expireTrials() { throw new Error(); },
    async findClaimedOrgBySlug() { return null; },
    async findMember() { return null; },
    async provisionTenant() { return { inviteId: "33333333-3333-4333-8333-333333333333", orgId: "22222222-2222-4222-8222-222222222222", replayed: false, tokenId: TOKEN_ID }; },
    async publishBrand() { throw new Error(); },
    async readBrand() { return null; },
    async readPublishedBrand() { return null; },
    async recordInviteDelivery() {},
    async runTenantAction(input) { return { membership: "trial", orgId: input.orgId, slug: null, trialEndsAt: null }; },
    async updateBrand() { throw new Error(); },
    ...overrides,
  };
  return createTenantAdminService({
    repository,
    inviteSender: { async send() { return { providerUserId: "44444444-4444-4444-8444-444444444444" }; } },
  });
}

test("feature-off returns 404 before auth or service construction", async () => {
  let touched = false;
  const response = await handlePostTenant(request(), {
    enabled: () => false,
    async requirePlatformAdmin() { touched = true; return ACTOR; },
    async service() { touched = true; return service(); },
  });
  assert.equal(response.status, 404);
  assert.equal(touched, false);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("missing and wrong-role authorization never reach the service", async () => {
  for (const authError of [
    new AuthError(401, "unauthenticated", "raw auth detail"),
    new AuthError(403, "forbidden", "raw role detail"),
  ]) {
    let constructed = false;
    const response = await handlePostTenant(request(), {
      enabled: () => true,
      async requirePlatformAdmin() { throw authError; },
      async service() { constructed = true; return service(); },
    });
    assert.equal(response.status, authError.status);
    assert.equal(constructed, false);
    assert.doesNotMatch(await response.text(), /raw auth detail|raw role detail/);
  }
});

test("valid platform request returns a no-store created result", async () => {
  const response = await handlePostTenant(request(), {
    enabled: () => true,
    async requirePlatformAdmin() { return ACTOR; },
    async service() { return service(); },
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    tenant: {
      inviteId: "33333333-3333-4333-8333-333333333333",
      orgId: "22222222-2222-4222-8222-222222222222",
      replayed: false,
    },
  });
});

test("malformed input and provider failure use typed non-leaking envelopes", async () => {
  const malformed = await handlePostTenant(request({ ...BODY, extra: true }), {
    enabled: () => true,
    async requirePlatformAdmin() { return ACTOR; },
    async service() { return service(); },
  });
  assert.equal(malformed.status, 400);

  const failed = await handlePostTenant(request(), {
    enabled: () => true,
    async requirePlatformAdmin() { return ACTOR; },
    async service() {
      return service({ async provisionTenant() {
        throw new TenantError(502, "TENANT_INVITE_DELIVERY_FAILED", "The invite could not be sent.");
      } });
    },
  });
  assert.equal(failed.status, 502);
  assert.doesNotMatch(await failed.text(), /provider|database/i);
});
