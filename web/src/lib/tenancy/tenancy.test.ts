import assert from "node:assert/strict";
import test from "node:test";

import { resolveTrialDays } from "./config.ts";
import {
  readTenantRequestContext,
  TENANT_CONTEXT_HEADERS,
  writeTenantRequestContext,
} from "./context.ts";
import { TenantBillingWallError } from "./errors.ts";
import type { TenancyRepository } from "./repository.ts";
import { createTenantHostResolver } from "./resolve.ts";
import { isTenantSlug, RESERVED_TENANT_SLUGS } from "./slug.ts";
import type { SessionContext, TenantOrganization } from "./types.ts";
import { assertTenantAccessAllowed, assertTenantWriteAllowed } from "./wall.ts";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const organization: TenantOrganization = {
  brandPublishedAt: "2026-08-17T00:00:00.000Z",
  id: ORG_ID,
  membership: "current",
  publishedBrand: { primaryColor: "#112233" },
  slug: "acme-funding",
};

function repository(
  findClaimedOrgBySlug: TenancyRepository["findClaimedOrgBySlug"],
): TenancyRepository {
  return {
    async acceptInvite() { throw new Error("unexpected accept"); },
    async createInvite() { throw new Error("unexpected invite"); },
    async deactivateMember() { throw new Error("unexpected deactivate"); },
    async expireTrials() { throw new Error("unexpected expiry"); },
    findClaimedOrgBySlug,
    async findMember() { return null; },
    async provisionTenant() { throw new Error("unexpected provision"); },
    async publishBrand() { throw new Error("unexpected publish"); },
    async readBrand() { return null; },
    async readPublishedBrand() { return null; },
    async recordInviteDelivery() { throw new Error("unexpected receipt"); },
    async runTenantAction() { throw new Error("unexpected action"); },
    async updateBrand() { throw new Error("unexpected brand"); },
  };
}

test("host resolver normalizes host forms and performs claimed first-label lookup", async () => {
  const seen: string[] = [];
  const resolve = createTenantHostResolver(repository(async (slug) => {
    seen.push(slug);
    return slug === organization.slug ? organization : null;
  }));

  for (const hostname of [
    "ACME-FUNDING.example.test:3000",
    "acme-funding.example.test.",
    "acme-funding",
  ]) {
    assert.deepEqual(await resolve({ hostname }), {
      kind: "organization",
      organization,
    });
  }
  assert.deepEqual(seen, [organization.slug, organization.slug, organization.slug]);
});

test("default org takes precedence over admin and hostname labels", async () => {
  const seen: string[] = [];
  const resolve = createTenantHostResolver(repository(async (slug) => {
    seen.push(slug);
    return slug === organization.slug ? organization : null;
  }));

  assert.equal(
    (await resolve({ hostname: "admin.example.test", defaultOrgSlug: " ACME-FUNDING " })).kind,
    "organization",
  );
  assert.deepEqual(seen, [organization.slug]);
  assert.deepEqual(await resolve({ hostname: "admin.example.test" }), {
    kind: "platform_admin",
  });
});

test("unknown host response is constant and does not reflect its label or brand", async () => {
  const resolve = createTenantHostResolver(repository(async () => null));
  const first = await resolve({ hostname: "secret-customer.example.test" });
  const second = await resolve({ hostname: "another.example.test" });
  assert.deepEqual(first, { kind: "unknown" });
  assert.deepEqual(first, second);
  assert.doesNotMatch(JSON.stringify(first), /secret-customer|another|brand/i);
});

test("context encoder deletes spoofed headers before setting trusted values", () => {
  const incoming = new Headers({
    "x-mf-tenant-kind": "platform_admin",
    "x-mf-org-id": "attacker",
    "x-mf-org-slug": "attacker",
    "x-request-id": "kept",
  });
  const encoded = writeTenantRequestContext(incoming, {
    kind: "organization",
    organization,
  });
  assert.equal(encoded.get("x-request-id"), "kept");
  assert.deepEqual(readTenantRequestContext(encoded), {
    kind: "organization",
    orgId: ORG_ID,
    slug: organization.slug,
  });

  const unknown = writeTenantRequestContext(incoming, { kind: "unknown" });
  for (const name of TENANT_CONTEXT_HEADERS) assert.equal(unknown.has(name), false);
});

test("request context decoder refuses malformed and mixed shapes", () => {
  const malformed: HeadersInit[] = [
    {},
    { "x-mf-tenant-kind": "root" },
    { "x-mf-tenant-kind": "platform_admin", "x-mf-org-id": ORG_ID },
    { "x-mf-tenant-kind": "organization" },
    { "x-mf-tenant-kind": "organization", "x-mf-org-id": "bad", "x-mf-org-slug": "acme" },
    { "x-mf-tenant-kind": "organization", "x-mf-org-id": ORG_ID, "x-mf-org-slug": "Bad_Slug" },
  ];
  for (const shape of malformed) {
    assert.equal(readTenantRequestContext(new Headers(shape)), null);
  }
  assert.deepEqual(
    readTenantRequestContext(new Headers({ "x-mf-tenant-kind": "platform_admin" })),
    { kind: "platform_admin" },
  );
  // Seeded org ids have zero version/variant nibbles and must still decode
  // (GAPS G-3B-07): the demo's Northbridge workspace is a0000000-…-0001.
  assert.deepEqual(
    readTenantRequestContext(new Headers({
      "x-mf-tenant-kind": "organization",
      "x-mf-org-id": "a0000000-0000-0000-0000-000000000001",
      "x-mf-org-slug": "northbridge",
    })),
    { kind: "organization", orgId: "a0000000-0000-0000-0000-000000000001", slug: "northbridge" },
  );
});

test("deactivated team and affiliate writes receive the exact typed 402 contract", async () => {
  for (const role of ["operator_member", "affiliate"] as const) {
    const session: SessionContext = { role, orgMembership: "deactivated" };
    await assertTenantAccessAllowed(session, "own-book-read");
    await assert.rejects(
      assertTenantWriteAllowed(session),
      (error: unknown) =>
        error instanceof TenantBillingWallError &&
        error.status === 402 &&
        error.code === "ORG_DEACTIVATED",
    );
  }
});

test("non-deactivated team writes and every consumer/platform operation stay outside the wall", async () => {
  for (const role of ["operator_member", "affiliate"] as const) {
    for (const membership of ["trial", "current", "past_due", "grace", null] as const) {
      await assertTenantWriteAllowed({ role, orgMembership: membership });
    }
  }
  for (const role of ["consumer", "platform_admin"] as const) {
    for (const operation of ["own-book-read", "write"] as const) {
      await assertTenantAccessAllowed({ role, orgMembership: "deactivated" }, operation);
    }
  }
});

test("reserved slug data and format validation stay aligned", () => {
  assert.deepEqual(RESERVED_TENANT_SLUGS, [
    "www", "admin", "app", "api", "mail", "platform", "help", "status", "docs",
  ]);
  for (const value of RESERVED_TENANT_SLUGS) assert.equal(isTenantSlug(value), false);
  for (const value of ["ab", "-acme", "acme-", "Acme", "acme_org", "a".repeat(41)]) {
    assert.equal(isTenantSlug(value), false);
  }
  assert.equal(isTenantSlug("acme-funding"), true);
});

test("trial configuration is lazy, defaults to 14, and fails closed", () => {
  assert.equal(resolveTrialDays({}), 14);
  assert.equal(resolveTrialDays({ TRIAL_DAYS: " 21 " }), 21);
  for (const value of ["0", "-1", "1.5", "many", "9007199254740992"]) {
    assert.throws(() => resolveTrialDays({ TRIAL_DAYS: value }), /TRIAL_DAYS_INVALID/);
  }
});
