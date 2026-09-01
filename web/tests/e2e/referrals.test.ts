import assert from "node:assert/strict";
import test from "node:test";

import {
  clearReferralFixture,
  provisionReferralFixture,
  readReferralFixtureEvidence,
  REFERRAL_FIXTURE,
} from "../../src/lib/referrals/fixture.ts";

const baseUrl = process.env.REFERRAL_E2E_BASE_URL;

test("referral create, click, and exact-client conversion persist one lifecycle", { skip: !baseUrl }, async () => {
  provisionReferralFixture();
  const sourceHeaders = { "x-mf-demo-profile-id": REFERRAL_FIXTURE.sourceConsumerId };
  const destinationHeaders = {
    "content-type": "application/json",
    "x-mf-demo-profile-id": REFERRAL_FIXTURE.destinationConsumerId,
  };

  try {
    const unauthenticated = await fetch(`${baseUrl}/api/referrals`, { method: "POST" });
    assert.equal(unauthenticated.status, 401);
    const operator = await fetch(`${baseUrl}/api/referrals`, {
      method: "POST",
      headers: { "x-mf-demo-profile-id": "a1000000-0000-0000-0000-000000000001" },
    });
    assert.equal(operator.status, 403);

    const created = await fetch(`${baseUrl}/api/referrals`, { method: "POST", headers: sourceHeaders });
    assert.equal(created.status, 201);
    const createdBody = await created.json() as { referralId: string; url: string };
    const token = createdBody.url.split("/").at(-1);
    assert.match(token ?? "", /^[A-Za-z0-9_-]{43}$/);

    const malformed = await fetch(`${baseUrl}/api/referrals/resolve/bad`, { redirect: "manual" });
    assert.equal(malformed.status, 404);
    assert.equal(malformed.headers.get("location"), null);
    assert.equal(malformed.headers.get("set-cookie"), null);
    const unknown = await fetch(`${baseUrl}/api/referrals/resolve/${"z".repeat(43)}`, { redirect: "manual" });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.headers.get("location"), null);
    assert.equal(unknown.headers.get("set-cookie"), null);

    const clicked = await fetch(createdBody.url, { redirect: "manual" });
    assert.equal(clicked.status, 303);
    assert.equal(clicked.headers.get("location"), `${baseUrl}/consumer?intake=referral`);
    assert.equal(clicked.headers.get("cache-control"), "no-store");
    assert.equal(clicked.headers.get("referrer-policy"), "no-referrer");
    const cookie = clicked.headers.get("set-cookie");
    assert.match(cookie ?? "", /mf_referral_token=/);
    assert.match(cookie ?? "", /HttpOnly/i);
    assert.match(cookie ?? "", /SameSite=Lax/i);
    assert.match(cookie ?? "", /Secure/i);

    const afterClick = readReferralFixtureEvidence(createdBody.referralId);
    assert.ok(afterClick?.clickedAt);
    assert.equal(afterClick?.sourceOrgId, REFERRAL_FIXTURE.sourceOrgId);
    assert.equal(afterClick?.platformOrgId, REFERRAL_FIXTURE.platformOrgId);
    assert.notEqual(afterClick?.sourceOrgId, afterClick?.platformOrgId);
    assert.deepEqual(afterClick?.auditActions, ["referral.created", "referral.clicked"]);
    assert.equal(JSON.stringify(afterClick).includes(token ?? "missing"), false);

    const missingSession = await fetch(`${baseUrl}/api/referrals/convert`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId: REFERRAL_FIXTURE.destinationClientId }),
    });
    assert.equal(missingSession.status, 401);
    const missingCookie = await fetch(`${baseUrl}/api/referrals/convert`, {
      method: "POST",
      headers: destinationHeaders,
      body: JSON.stringify({ clientId: REFERRAL_FIXTURE.destinationClientId }),
    });
    assert.equal(missingCookie.status, 404);

    const converted = await fetch(`${baseUrl}/api/referrals/convert`, {
      method: "POST",
      headers: { ...destinationHeaders, cookie: cookie ?? "" },
      body: JSON.stringify({ clientId: REFERRAL_FIXTURE.destinationClientId }),
    });
    assert.equal(converted.status, 200);
    assert.deepEqual(await converted.json(), { referralId: createdBody.referralId, status: "converted" });

    const afterConversion = readReferralFixtureEvidence(createdBody.referralId);
    assert.equal(afterConversion?.convertedClientId, REFERRAL_FIXTURE.destinationClientId);
    assert.ok(afterConversion?.convertedAt);
    assert.deepEqual(afterConversion?.auditActions, ["referral.created", "referral.clicked", "referral.converted"]);

    const clickReplay = await fetch(createdBody.url, { redirect: "manual" });
    assert.equal(clickReplay.status, 303);
    const conversionReplay = await fetch(`${baseUrl}/api/referrals/convert`, {
      method: "POST",
      headers: { ...destinationHeaders, cookie: cookie ?? "" },
      body: JSON.stringify({ clientId: REFERRAL_FIXTURE.destinationClientId }),
    });
    assert.equal(conversionReplay.status, 200);
    assert.equal((await conversionReplay.json() as { status: string }).status, "already_converted");

    const differentClient = await fetch(`${baseUrl}/api/referrals/convert`, {
      method: "POST",
      headers: { ...destinationHeaders, cookie: cookie ?? "" },
      body: JSON.stringify({ clientId: REFERRAL_FIXTURE.alternateClientId }),
    });
    assert.equal(differentClient.status, 404);
    const finalEvidence = readReferralFixtureEvidence(createdBody.referralId);
    assert.equal(finalEvidence?.clickedAt, afterClick?.clickedAt);
    assert.equal(finalEvidence?.convertedAt, afterConversion?.convertedAt);
    assert.deepEqual(finalEvidence?.auditActions, afterConversion?.auditActions);
  } finally {
    clearReferralFixture();
  }
});
