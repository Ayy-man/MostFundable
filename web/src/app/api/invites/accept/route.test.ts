import assert from "node:assert/strict";
import test from "node:test";

import { createInviteService } from "@/lib/tenancy/invites";
import { TenantError } from "@/lib/tenancy/errors";
import type { TenancyRepository } from "@/lib/tenancy/repository";
import { handleAcceptInvite } from "./route.ts";

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const PROVIDER_ID = "44444444-4444-4444-8444-444444444444";
const TOKEN_ID = "66666666-6666-4666-8666-666666666666";

function service(kind: "affiliate" | "client" | "team", overrides: Partial<TenancyRepository> = {}) {
  const repository: TenancyRepository = {
    async acceptInvite() { return { affiliateId: kind === "affiliate" ? PROVIDER_ID : null, clientId: kind === "client" ? PROVIDER_ID : null, kind, orgId: ORG_ID, profileId: PROVIDER_ID }; },
    async createInvite() { throw new Error(); },
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
  return createInviteService({
    repository,
    inviteSender: { async send() { throw new Error(); } },
    verifier: { async verify() { return { email: "target@example.test", metadataInviteId: TOKEN_ID, providerUserId: PROVIDER_ID }; } },
    seatSynchronizer: { async sync() { return { reason: "synced" }; } },
  });
}

function request(params: Record<string, string>): Request {
  const url = new URL("http://localhost/api/invites/accept");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return new Request(url);
}

const VALID = { token_hash: "otp-token-value", type: "invite", invite_id: TOKEN_ID };

test("feature-off returns before service construction", async () => {
  let touched = false;
  const response = await handleAcceptInvite(request(VALID), {
    enabled: () => false,
    async service() { touched = true; return service("team"); },
  });
  assert.equal(response.status, 404);
  assert.equal(touched, false);
});

test("accepted team, affiliate, and client links redirect without carrying correlation values", async () => {
  for (const [kind, path] of [["team", "/operator"], ["affiliate", "/affiliate"], ["client", "/consumer"]] as const) {
    const response = await handleAcceptInvite(request(VALID), {
      enabled: () => true,
      async service() { return service(kind); },
    });
    assert.equal(response.status, 303);
    assert.equal(new URL(response.headers.get("location")!).pathname, path);
    assert.doesNotMatch(response.headers.get("location")!, /token_hash|invite_id/);
  }
});

test("malformed, mismatched, expired, and replayed links share one outward redirect", async () => {
  const cases = [
    request({ ...VALID, type: "magiclink" }),
    request({ ...VALID, invite_id: "wrong" }),
    request(VALID),
  ];
  for (const [index, candidate] of cases.entries()) {
    const response = await handleAcceptInvite(candidate, {
      enabled: () => true,
      async service() {
        if (index === 2) return service("team", { async acceptInvite() {
          throw new TenantError(409, "TENANT_INVITE_INVALID", "The invitation is invalid.");
        } });
        return service("team");
      },
    });
    assert.equal(response.status, 303);
    assert.equal(new URL(response.headers.get("location")!).pathname + new URL(response.headers.get("location")!).search, "/sign-in?error=link_invalid");
  }
});

test("seat failure after durable acceptance returns typed queued result", async () => {
  const instance = service("team");
  const failing = {
    ...instance,
    async accept() {
      throw new TenantError(502, "TENANT_SEAT_SYNC_FAILED", "The membership change is saved and its seat update is queued.");
    },
  };
  const response = await handleAcceptInvite(request(VALID), {
    enabled: () => true,
    async service() { return failing; },
  });
  assert.equal(response.status, 502);
  assert.match(await response.text(), /TENANT_SEAT_SYNC_FAILED/);
});
