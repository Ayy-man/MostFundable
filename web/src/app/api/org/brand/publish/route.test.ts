import assert from "node:assert/strict";
import test from "node:test";

import { createBrandService } from "@/lib/tenancy/brand";
import type { TenancyRepository } from "@/lib/tenancy/repository";
import { handlePublishBrand } from "./route.ts";

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const SESSION = {
  id: "11111111-1111-4111-8111-111111111111", role: "operator_member" as const,
  orgId: ORG_ID, orgRole: "admin" as const, manages: [], disabledAt: null, orgMembership: "current" as const,
};

function service(published: unknown[]) {
  const repository: TenancyRepository = {
    async acceptInvite() { throw new Error(); }, async createInvite() { throw new Error(); },
    async deactivateMember() { throw new Error(); }, async expireTrials() { throw new Error(); },
    async findClaimedOrgBySlug() { return null; }, async findMember() { return null; },
    async provisionTenant() { throw new Error(); },
    async publishBrand(input) { published.push(input); return { publishedAt: "2026-08-17T00:00:00.000Z" }; },
    async readBrand() { return { brand: { primaryColor: "#123456" }, publishedAt: null, slug: "example-funding" }; },
    async readPublishedBrand() { return null; }, async recordInviteDelivery() {},
    async runTenantAction() { throw new Error(); }, async updateBrand() { throw new Error(); },
  };
  return createBrandService({ repository, storage: { async upload() { throw new Error(); } } });
}

test("flag-off skips auth and publish service", async () => {
  let touched = false;
  const response = await handlePublishBrand({
    enabled: () => false,
    async requireOperator() { touched = true; return SESSION; },
    async service() { touched = true; return service([]); },
  });
  assert.equal(response.status, 404);
  assert.equal(touched, false);
});

test("enabled admin publishes once and returns timestamp without review claims", async () => {
  const published: unknown[] = [];
  const response = await handlePublishBrand({
    enabled: () => true,
    async requireOperator() { return SESSION; },
    async service() { return service(published); },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { brand: { publishedAt: "2026-08-17T00:00:00.000Z" } });
  assert.equal(published.length, 1);
});
