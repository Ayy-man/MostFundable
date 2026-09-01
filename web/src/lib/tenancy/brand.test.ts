import assert from "node:assert/strict";
import test from "node:test";

import { createBrandService, createBrandStorage, parseBrandPatch } from "./brand.ts";
import { TenantBillingWallError, TenantError } from "./errors.ts";
import type { InviteActor } from "./invites.ts";
import type { TenancyRepository } from "./repository.ts";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const OBJECT_ID = "33333333-3333-4333-8333-333333333333";
const SUPABASE_URL = "https://project.supabase.test";
const LOGO_URL = `${SUPABASE_URL}/storage/v1/object/public/brand-assets/${ORG_ID}/${OBJECT_ID}.png`;
const ACTOR: InviteActor = {
  disabledAt: null, id: ACTOR_ID, orgId: ORG_ID, orgMembership: "current",
  orgRole: "owner", role: "operator_member",
};

function repository(overrides: Partial<TenancyRepository> = {}): TenancyRepository {
  return {
    async acceptInvite() { throw new Error(); },
    async createInvite() { throw new Error(); },
    async deactivateMember() { throw new Error(); },
    async expireTrials() { throw new Error(); },
    async findClaimedOrgBySlug() { return null; },
    async findMember() { return null; },
    async provisionTenant() { throw new Error(); },
    async publishBrand() { return { publishedAt: "2026-08-17T00:00:00.000Z" }; },
    async readBrand() { return { brand: {}, publishedAt: null, slug: "example-funding" }; },
    async readPublishedBrand() { return null; },
    async recordInviteDelivery() {},
    async runTenantAction() { throw new Error(); },
    async updateBrand(input) { return input.brand; },
    ...overrides,
  };
}

test("brand parser accepts only Studio keys and canonical color/URL forms", () => {
  assert.deepEqual(parseBrandPatch({
    accentColor: "#AABBCC",
    logoUrl: LOGO_URL,
    portalName: "  Apex Funding Portal  ",
    primaryColor: "#112233",
  }, { orgId: ORG_ID, supabaseUrl: SUPABASE_URL }), {
    accentColor: "#aabbcc",
    logoUrl: LOGO_URL,
    portalName: "Apex Funding Portal",
    primaryColor: "#112233",
  });
  for (const value of [
    {},
    { fictional: false },
    { platform_intake: false },
    { primaryColor: "112233" },
    { accentColor: "#abcd" },
    { portalName: "   " },
    { portalName: "x".repeat(121) },
    { portalName: 42 },
    { logoUrl: "javascript:alert(1)" },
  ]) assert.throws(() => parseBrandPatch(value), TenantError);
});

test("brand logos stay on the exact HTTPS organization storage path", () => {
  for (const logoUrl of [
    LOGO_URL.replace("https:", "http:"),
    "https://external.test/logo.png",
    `${SUPABASE_URL}/storage/v1/object/public/brand-assets/${ACTOR_ID}/logo.png`,
    `${SUPABASE_URL}/storage/v1/object/public/brand-assets/${ORG_ID}/logo.png?track=1`,
    `${SUPABASE_URL}/storage/v1/object/public/brand-assets/${ORG_ID}/logo.png#part`,
    `https://user:pass@project.supabase.test/storage/v1/object/public/brand-assets/${ORG_ID}/logo.png`,
    "https://127.0.0.1/logo.png",
    "https://169.254.169.254/logo.png",
  ]) {
    assert.throws(() => parseBrandPatch({ logoUrl }, { orgId: ORG_ID, supabaseUrl: SUPABASE_URL }), TenantError);
  }
  assert.equal(parseBrandPatch({ logoUrl: LOGO_URL }, { orgId: ORG_ID, supabaseUrl: SUPABASE_URL }).logoUrl, LOGO_URL);
  // The local stack serves Storage over plain http on loopback; only that origin may be http.
  const localUrl = `http://127.0.0.1:54321/storage/v1/object/public/brand-assets/${ORG_ID}/logo.png`;
  assert.equal(parseBrandPatch({ logoUrl: localUrl }, { orgId: ORG_ID, supabaseUrl: "http://127.0.0.1:54321" }).logoUrl, localUrl);
  assert.throws(() => parseBrandPatch({ logoUrl: `http://storage.example/storage/v1/object/public/brand-assets/${ORG_ID}/logo.png` }, { orgId: ORG_ID, supabaseUrl: "http://storage.example" }), TenantError);
});

test("PNG/JPEG/WebP uploads generate one org-scoped insert-only object path", async () => {
  const fixtures = [
    { mime: "image/png", bytes: Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), ext: "png" },
    { mime: "image/jpeg", bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0x00]), ext: "jpg" },
    { mime: "image/webp", bytes: new TextEncoder().encode("RIFF0000WEBP"), ext: "webp" },
  ] as const;
  for (const fixture of fixtures) {
    let upload: unknown;
    let patch: unknown;
    const service = createBrandService({
      id: () => OBJECT_ID,
      supabaseUrl: SUPABASE_URL,
      repository: repository({ async updateBrand(input) { patch = input; return input.brand; } }),
      storage: { async upload(input) { upload = input; return { publicUrl: `${SUPABASE_URL}/storage/v1/object/public/brand-assets/${ORG_ID}/${OBJECT_ID}.${fixture.ext}` }; } },
    });
    await service.uploadLogo(ACTOR, { bytes: fixture.bytes, mimeType: fixture.mime });
    assert.equal((upload as { objectPath: string }).objectPath, `${ORG_ID}/${OBJECT_ID}.${fixture.ext}`);
    assert.equal((patch as { orgId: string }).orgId, ORG_ID);
    assert.deepEqual((patch as { brand: unknown }).brand, { logoUrl: `${SUPABASE_URL}/storage/v1/object/public/brand-assets/${ORG_ID}/${OBJECT_ID}.${fixture.ext}` });
  }
});

test("MIME spoof, SVG, oversize, and deactivated wall fail before Storage mutation", async () => {
  let uploads = 0;
  const service = createBrandService({
    id: () => OBJECT_ID,
    supabaseUrl: SUPABASE_URL,
    repository: repository(),
    storage: { async upload() { uploads += 1; return { publicUrl: "https://local.test/object" }; } },
  });
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  await assert.rejects(service.uploadLogo(ACTOR, { bytes: png, mimeType: "image/jpeg" }), TenantError);
  await assert.rejects(service.uploadLogo(ACTOR, { bytes: new TextEncoder().encode("<svg></svg>"), mimeType: "image/svg+xml" }), TenantError);
  await assert.rejects(service.uploadLogo(ACTOR, { bytes: new Uint8Array(2 * 1024 * 1024 + 1), mimeType: "image/png" }), TenantError);
  await assert.rejects(
    service.uploadLogo({ ...ACTOR, orgMembership: "deactivated" }, { bytes: png, mimeType: "image/png" }),
    TenantBillingWallError,
  );
  assert.equal(uploads, 0);
});

test("storage adapter always uses brand-assets with upsert false", async () => {
  let call: unknown;
  const storage = createBrandStorage({
    storage: { from(bucket) {
      assert.equal(bucket, "brand-assets");
      return {
        async upload(path, _bytes, options) { call = { path, options }; return { error: null }; },
        getPublicUrl(path) { return { data: { publicUrl: `https://local.test/${path}` } }; },
      };
    } },
  });
  const result = await storage.upload({
    bytes: Uint8Array.from([0xff, 0xd8, 0xff]),
    contentType: "image/jpeg",
    objectPath: `${ORG_ID}/${OBJECT_ID}.jpg`,
  });
  assert.deepEqual(call, {
    path: `${ORG_ID}/${OBJECT_ID}.jpg`,
    options: { contentType: "image/jpeg", upsert: false },
  });
  assert.match(result.publicUrl, new RegExp(ORG_ID));
});

test("draft update delegates allow-listed keys and publish requires claimed slug", async () => {
  const calls: unknown[] = [];
  const service = createBrandService({
    supabaseUrl: SUPABASE_URL,
    repository: repository({
      async updateBrand(input) { calls.push(input); return input.brand; },
      async publishBrand(input) { calls.push(input); return { publishedAt: "2026-08-17T00:00:00.000Z" }; },
    }),
    storage: { async upload() { throw new Error(); } },
  });
  await service.update(ACTOR, { primaryColor: "#123456" });
  assert.deepEqual(await service.publish(ACTOR), { publishedAt: "2026-08-17T00:00:00.000Z" });
  assert.equal(calls.length, 2);

  const unclaimed = createBrandService({
    repository: repository({ async readBrand() { return null; } }),
    storage: { async upload() { throw new Error(); } },
  });
  await assert.rejects(unclaimed.publish(ACTOR), TenantError);
});

test("publish rejects a stored logo that does not satisfy the current boundary", async () => {
  const service = createBrandService({
    supabaseUrl: SUPABASE_URL,
    repository: repository({ async readBrand() { return { brand: { logoUrl: "https://external.test/logo.png" }, publishedAt: null, slug: "example-funding" }; } }),
    storage: { async upload() { throw new Error(); } },
  });
  await assert.rejects(service.publish(ACTOR), TenantError);
});
