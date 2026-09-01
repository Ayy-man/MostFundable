import assert from "node:assert/strict";
import test from "node:test";

import { createInviteService } from "@/lib/tenancy/invites";
import type { TenancyRepository } from "@/lib/tenancy/repository";
import { handleDeactivateMember } from "./route.ts";

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const TARGET_ID = "77777777-7777-4777-8777-777777777777";
const SESSION = {
  id: "11111111-1111-4111-8111-111111111111", role: "operator_member" as const,
  orgId: ORG_ID, orgRole: "admin" as const, manages: [], disabledAt: null, orgMembership: "current" as const,
};

function service(events: string[], seatReason = "synced") {
  const repository: TenancyRepository = {
    async acceptInvite() { throw new Error(); },
    async createInvite() { throw new Error(); },
    async deactivateMember() { events.push("commit"); return { applied: true, customerRef: "customer_ref", orgId: ORG_ID, profileId: TARGET_ID }; },
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
  };
  return createInviteService({
    repository,
    inviteSender: { async send() { throw new Error(); } },
    verifier: { async verify() { throw new Error(); } },
    seatSynchronizer: { async sync() { events.push("seat"); return { reason: seatReason }; } },
  });
}

test("feature-off precedes auth, params, and service", async () => {
  let touched = false;
  const params = { then() { touched = true; throw new Error(); } } as unknown as Promise<{ id: string }>;
  const response = await handleDeactivateMember({ params }, {
    enabled: () => false,
    async requireOperator() { touched = true; return SESSION; },
    async service() { touched = true; return service([]); },
  });
  assert.equal(response.status, 404);
  assert.equal(touched, false);
});

test("valid offboard commits before seat synchronization", async () => {
  const events: string[] = [];
  const response = await handleDeactivateMember({ params: Promise.resolve({ id: TARGET_ID }) }, {
    enabled: () => true,
    async requireOperator() { return SESSION; },
    async service() { return service(events); },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(events, ["commit", "seat"]);
});

test("deactivated wall prevents offboard and seat failure remains explicit after commit", async () => {
  const blockedEvents: string[] = [];
  const blocked = await handleDeactivateMember({ params: Promise.resolve({ id: TARGET_ID }) }, {
    enabled: () => true,
    async requireOperator() { return { ...SESSION, orgMembership: "deactivated" as const }; },
    async service() { return service(blockedEvents); },
  });
  assert.equal(blocked.status, 402);
  assert.deepEqual(blockedEvents, []);

  const failedEvents: string[] = [];
  const failed = await handleDeactivateMember({ params: Promise.resolve({ id: TARGET_ID }) }, {
    enabled: () => true,
    async requireOperator() { return SESSION; },
    async service() { return service(failedEvents, "driver_rejected"); },
  });
  assert.equal(failed.status, 502);
  assert.deepEqual(failedEvents, ["commit", "seat"]);
});
