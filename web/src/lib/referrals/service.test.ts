import assert from "node:assert/strict";
import test from "node:test";
import type { SessionProfile } from "../auth/session.ts";
import { ReferralError } from "./errors.ts";
import { createReferralService } from "./service.ts";
import type { ReferralRepository } from "./types.ts";

const sourceOrgId = "a0000000-0000-4000-8000-000000000001";
const platformOrgId = "f0000000-0000-4000-8000-000000000001";
const consumerId = "a1000000-0000-4000-8000-000000000011";
const sourceClientId = "a3000000-0000-4000-8000-000000000001";
const destinationClientId = "f3000000-0000-4000-8000-000000000011";
const actor: SessionProfile = { disabledAt: null, id: consumerId, role: "consumer", orgId: sourceOrgId, orgMembership: null, orgRole: null, manages: [] };
const env = { FEATURE_REFERRALS: "1", REFERRAL_PLATFORM_ORG_ID: platformOrgId, REFERRAL_INTAKE_ORIGIN: "http://localhost:3100" };

function fake(overrides: Partial<ReferralRepository> = {}): ReferralRepository {
  return {
    async resolveSourceClient() { return { clientId: sourceClientId, orgId: sourceOrgId }; },
    async platformOrgIsMarked() { return true; },
    async createReferral() { return { referralId: "r1", sourceOrgId, platformOrgId, createdAt: "2026-08-16T00:00:00Z", clickedAt: null, convertedAt: null, convertedClientId: null }; },
    async markClicked() { return { referralId: "r1", sourceOrgId, platformOrgId, createdAt: "2026-08-16T00:00:00Z", clickedAt: "2026-08-16T00:01:00Z", convertedAt: null, convertedClientId: null }; },
    async markConverted() { return { referralId: "r1", status: "converted", sourceOrgId, platformOrgId, createdAt: "2026-08-16T00:00:00Z", clickedAt: "2026-08-16T00:01:00Z", convertedAt: "2026-08-16T00:02:00Z", convertedClientId: destinationClientId }; },
    async readEvidence() { return null; },
    ...overrides,
  };
}

test("create derives identities and persists only a digest", async () => {
  let observed: Parameters<ReferralRepository["createReferral"]>[0] | undefined;
  const service = createReferralService(fake({ async createReferral(input) { observed = input; return fake().createReferral(input); } }), env);
  const result = await service.createConsumerReferral(actor);
  assert.equal(result.referralId, "r1");
  assert.match(result.url, /^http:\/\/localhost:3100\/api\/referrals\/resolve\/[A-Za-z0-9_-]{43}$/);
  assert.equal(observed?.consumerId, consumerId);
  assert.equal(observed?.sourceClientId, sourceClientId);
  assert.equal(observed?.platformOrgId, platformOrgId);
  assert.equal(observed?.tokenDigest.length, 32);
  assert.equal(JSON.stringify(observed).includes(result.url.split("/").at(-1) ?? "missing"), false);
});

test("unavailable configuration performs no write", async () => {
  let writes = 0;
  const service = createReferralService(fake({ async createReferral(input) { writes += 1; return fake().createReferral(input); } }), { FEATURE_REFERRALS: "1" });
  await assert.rejects(() => service.createConsumerReferral(actor), (error: unknown) => error instanceof ReferralError && error.code === "unavailable");
  assert.equal(writes, 0);
});

test("mismatched PLATFORM row fails availability and mutation", async () => {
  const service = createReferralService(fake({ async platformOrgIsMarked() { return false; } }), env);
  assert.equal(await service.availability(), false);
  await assert.rejects(() => service.createConsumerReferral(actor), (error: unknown) => error instanceof ReferralError && error.code === "unavailable");
});

test("source and destination organization cannot be equal", async () => {
  const service = createReferralService(fake({ async resolveSourceClient() { return { clientId: sourceClientId, orgId: platformOrgId }; } }), env);
  await assert.rejects(() => service.createConsumerReferral(actor), (error: unknown) => error instanceof ReferralError && error.code === "forbidden");
});

test("resolution validates before click and returns canonical intake", async () => {
  let clicks = 0;
  const service = createReferralService(fake({ async markClicked(input) { clicks += 1; return fake().markClicked(input); } }), env);
  await assert.rejects(() => service.resolveConsumerReferral("bad"), (error: unknown) => error instanceof ReferralError && error.code === "invalid_token");
  assert.equal(clicks, 0);
  const result = await service.resolveConsumerReferral("a".repeat(43));
  assert.equal(result.platformOrgId, platformOrgId);
  assert.equal(result.intakeUrl, "http://localhost:3100/consumer?intake=referral");
  assert.equal(clicks, 1);
});

test("conversion derives digest and preserves repository replay status", async () => {
  let observed: Parameters<ReferralRepository["markConverted"]>[0] | undefined;
  const service = createReferralService(fake({ async markConverted(input) { observed = input; return { ...(await fake().markConverted(input)), status: "already_converted" }; } }), env);
  const result = await service.completeConsumerReferral({ token: "b".repeat(43), clientId: destinationClientId, actorId: consumerId });
  assert.deepEqual(result, { referralId: "r1", status: "already_converted" });
  assert.equal(observed?.convertedClientId, destinationClientId);
  assert.equal(observed?.actorId, consumerId);
  assert.equal(observed?.tokenDigest.length, 32);
});

test("invalid conversion input writes nothing", async () => {
  let writes = 0;
  const service = createReferralService(fake({ async markConverted(input) { writes += 1; return fake().markConverted(input); } }), env);
  await assert.rejects(() => service.completeConsumerReferral({ token: "bad", clientId: destinationClientId, actorId: consumerId }), ReferralError);
  assert.equal(writes, 0);
});
