import assert from "node:assert/strict";
import test from "node:test";
import { parseReferralConfiguration } from "./config.ts";

const good = {
  FEATURE_REFERRALS: "1",
  REFERRAL_PLATFORM_ORG_ID: "f0000000-0000-4000-8000-000000000001",
  REFERRAL_INTAKE_ORIGIN: "http://127.0.0.1:3000",
};

test("empty configuration is disabled without throwing", () => {
  assert.deepEqual(parseReferralConfiguration({}), { enabled: false, explicitlyEnabled: false });
});

test("valid configuration is canonical", () => {
  assert.deepEqual(parseReferralConfiguration(good), {
    enabled: true,
    explicitlyEnabled: true,
    intakeOrigin: "http://127.0.0.1:3000",
    platformOrgId: good.REFERRAL_PLATFORM_ORG_ID,
  });
});

test("flag-on malformed values fail closed", () => {
  for (const replacement of [
    { REFERRAL_PLATFORM_ORG_ID: "not-a-uuid" },
    { REFERRAL_INTAKE_ORIGIN: "relative/path" },
    { REFERRAL_INTAKE_ORIGIN: "https://user:pass@example.com" },
    { REFERRAL_INTAKE_ORIGIN: "https://example.com/path" },
    { REFERRAL_INTAKE_ORIGIN: "https://example.com?query=yes" },
  ]) {
    assert.deepEqual(parseReferralConfiguration({ ...good, ...replacement }), {
      enabled: false,
      explicitlyEnabled: true,
    });
  }
});
