import assert from "node:assert/strict";
import test from "node:test";

import { AuthError } from "@/lib/auth/errors";
import { createTenantAdminService } from "@/lib/tenancy/admin";
import type { TenancyRepository } from "@/lib/tenancy/repository";
import { handlePatchTenant } from "./route.ts";

const ACTOR = { disabledAt: null, id: "11111111-1111-4111-8111-111111111111", role: "platform_admin" as const, orgId: null, orgMembership: null, orgRole: null, manages: [] };
const ORG_ID = "22222222-2222-4222-8222-222222222222";

function request(body: unknown): Request {
  return new Request(`http://localhost/api/admin/tenants/${ORG_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function service(calls: unknown[], capEnabled = false) {
  const repository: TenancyRepository = {
    async acceptInvite() { throw new Error(); },
    async createInvite() { throw new Error(); },
    async deactivateMember() { throw new Error(); },
    async expireTrials() { throw new Error(); },
    async findClaimedOrgBySlug() { return null; },
    async findMember() { return null; },
    async provisionTenant() { throw new Error(); },
    async publishBrand() { throw new Error(); },
    async readBrand() { return null; },
    async readPublishedBrand() { return null; },
    async recordInviteDelivery() { throw new Error(); },
    async runTenantAction(input) {
      calls.push(input);
      return { membership: "deactivated", orgId: input.orgId, slug: input.slug ?? null, trialEndsAt: input.trialEndsAt ?? null };
    },
    async updateBrand() { throw new Error(); },
  };
  return createTenantAdminService({
    repository,
    inviteSender: { async send() { throw new Error(); } },
    raiseClientCap: capEnabled
      ? async (input) => { calls.push(input); return { clientCap: input.cap }; }
      : undefined,
  });
}

test("feature-off precedes async params, authorization, and service construction", async () => {
  let touched = false;
  const params = {
    then(resolve: (value: { id: string }) => unknown) {
      touched = true;
      return Promise.resolve(resolve({ id: ORG_ID }));
    },
  } as unknown as Promise<{ id: string }>;
  const response = await handlePatchTenant(request({ action: "deactivate" }), {
    params,
  }, {
    enabled: () => false,
    async requirePlatformAdmin() { touched = true; return ACTOR; },
    async service() { touched = true; return service([]); },
  });
  assert.equal(response.status, 404);
  assert.equal(touched, false);
});

test("unauthorized actor cannot enumerate tenant ids", async () => {
  let serviceTouched = false;
  const response = await handlePatchTenant(request({ action: "deactivate" }), { params: Promise.resolve({ id: ORG_ID }) }, {
    enabled: () => true,
    async requirePlatformAdmin() { throw new AuthError(403, "forbidden", "tenant exists"); },
    async service() { serviceTouched = true; return service([]); },
  });
  assert.equal(response.status, 403);
  assert.equal(serviceTouched, false);
  assert.doesNotMatch(await response.text(), /tenant exists/);
});

test("valid action awaits Next 16 params and delegates once", async () => {
  const calls: unknown[] = [];
  const response = await handlePatchTenant(request({ action: "deactivate" }), { params: Promise.resolve({ id: ORG_ID }) }, {
    enabled: () => true,
    async requirePlatformAdmin() { return ACTOR; },
    async service() { return service(calls); },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(calls.length, 1);
  assert.equal((calls[0] as { orgId: string }).orgId, ORG_ID);
});

test("malformed action and flag-off Phase 21 action are typed with zero writes", async () => {
  for (const [body, status] of [[{ action: "unknown" }, 400], [{ action: "raise-cap", cap: 5 }, 501]] as const) {
    const calls: unknown[] = [];
    const response = await handlePatchTenant(request(body), { params: Promise.resolve({ id: ORG_ID }) }, {
      enabled: () => true,
      async requirePlatformAdmin() { return ACTOR; },
      async service() { return service(calls); },
    });
    assert.equal(response.status, status);
    assert.equal(calls.length, 0);
  }
});

test("flag-on raise-cap delegates once and returns the meter", async () => {
  const calls: unknown[] = [];
  const response = await handlePatchTenant(request({ action: "raise-cap", cap: 8 }), { params: Promise.resolve({ id: ORG_ID }) }, {
    enabled: () => true,
    async requirePlatformAdmin() { return ACTOR; },
    async service() { return service(calls, true); },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    tenant: { clientCap: 8, membership: null, orgId: ORG_ID, slug: null, trialEndsAt: null },
  });
  assert.deepEqual(calls, [{ actorId: ACTOR.id, cap: 8, orgId: ORG_ID }]);
});
