import assert from "node:assert/strict";
import test from "node:test";

import { createBrandService } from "@/lib/tenancy/brand";
import type { TenancyRepository } from "@/lib/tenancy/repository";
import { handlePatchBrand } from "./route.ts";

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const SESSION = {
  id: "11111111-1111-4111-8111-111111111111", role: "operator_member" as const,
  orgId: ORG_ID, orgRole: "owner" as const, manages: [], disabledAt: null, orgMembership: "current" as const,
};

function repository(calls: unknown[]): TenancyRepository {
  return {
    async acceptInvite() { throw new Error(); }, async createInvite() { throw new Error(); },
    async deactivateMember() { throw new Error(); }, async expireTrials() { throw new Error(); },
    async findClaimedOrgBySlug() { return null; }, async findMember() { return null; },
    async provisionTenant() { throw new Error(); }, async publishBrand() { throw new Error(); },
    async readBrand() { return { brand: {}, publishedAt: null, slug: "example-funding" }; },
    async readPublishedBrand() { return null; }, async recordInviteDelivery() {},
    async runTenantAction() { throw new Error(); },
    async updateBrand(input) { calls.push(input); return input.brand; },
  };
}

function service(calls: unknown[]) {
  return createBrandService({ repository: repository(calls), storage: { async upload() { throw new Error(); } } });
}

function request(body: unknown): Request {
  return new Request("http://localhost/api/org/brand", {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

test("feature-off returns before auth or Brand service construction", async () => {
  let touched = false;
  const response = await handlePatchBrand(request({ primaryColor: "#123456" }), {
    enabled: () => false,
    async requireOperator() { touched = true; return SESSION; },
    async service() { touched = true; return service([]); },
  });
  assert.equal(response.status, 404);
  assert.equal(touched, false);
});

test("owner draft update returns only Studio projection", async () => {
  const calls: unknown[] = [];
  const response = await handlePatchBrand(request({ primaryColor: "#123456" }), {
    enabled: () => true,
    async requireOperator() { return SESSION; },
    async service() { return service(calls); },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { brand: { primaryColor: "#123456" } });
  assert.equal(calls.length, 1);
});

test("unknown internal key and deactivated wall fail before repository write", async () => {
  const calls: unknown[] = [];
  const internal = await handlePatchBrand(request({ fictional: false }), {
    enabled: () => true,
    async requireOperator() { return SESSION; },
    async service() { return service(calls); },
  });
  assert.equal(internal.status, 400);
  const wall = await handlePatchBrand(request({ primaryColor: "#123456" }), {
    enabled: () => true,
    async requireOperator() { return { ...SESSION, orgMembership: "deactivated" as const }; },
    async service() { return service(calls); },
  });
  assert.equal(wall.status, 402);
  assert.equal(calls.length, 0);
});

