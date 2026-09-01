import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AffiliateError } from "@/lib/affiliates/types";
import {
  parseAffiliateId,
  parseAffiliateLifecyclePatch,
  parseAffiliateSlug,
  parseShareClientBody,
  parseUpdateShareBody,
} from "@/lib/affiliates/validate";

const affiliateId = "21000000-0000-4000-8000-000000000101";

function rejected(fn: () => unknown): AffiliateError {
  try { fn(); } catch (error) {
    assert.ok(error instanceof AffiliateError);
    return error;
  }
  assert.fail("expected AffiliateError");
}

describe("affiliate validators", () => {
  it("validates ids and trims bounded slugs", () => {
    assert.equal(parseAffiliateId(affiliateId), affiliateId);
    // seeded ids have zero version/variant nibbles and must still parse
    assert.equal(parseAffiliateId("a2000000-0000-0000-0000-000000000001"), "a2000000-0000-0000-0000-000000000001");
    assert.equal(parseAffiliateSlug("  affiliate-code  "), "affiliate-code");
    for (const value of ["", "x".repeat(256), null, "not-a-uuid"]) {
      const run = typeof value === "string" && value === "not-a-uuid"
        ? () => parseAffiliateId(value)
        : () => parseAffiliateSlug(value);
      assert.equal(rejected(run).code, "invalid_payload");
    }
  });

  it("accepts only the exact share body", () => {
    assert.deepEqual(parseShareClientBody({ clientId: affiliateId }), { clientId: affiliateId });
    for (const body of [{}, { clientId: affiliateId, other: true }, { clientId: "bad" }]) {
      assert.equal(rejected(() => parseShareClientBody(body)).code, "invalid_payload");
    }
  });

  it("preserves omitted commission separately from explicit null", () => {
    assert.deepEqual(parseUpdateShareBody({ paymentStatus: "paid" }), { paymentStatus: "paid" });
    assert.deepEqual(parseUpdateShareBody({ expectedCommissionCents: null }), { expectedCommissionCents: null });
    assert.deepEqual(
      parseUpdateShareBody({ expectedCommissionCents: 0, paymentStatus: "not_ready" }),
      { expectedCommissionCents: 0, paymentStatus: "not_ready" },
    );
  });

  it("rejects empty, unknown, unsafe, fractional, negative, and unsupported patches", () => {
    for (const body of [
      {},
      { other: true },
      { expectedCommissionCents: -1 },
      { expectedCommissionCents: 1.5 },
      { expectedCommissionCents: Number.MAX_SAFE_INTEGER + 1 },
      { paymentStatus: null },
      { paymentStatus: "other" },
    ]) assert.equal(rejected(() => parseUpdateShareBody(body)).code, "invalid_payload");
  });

  it("accepts only bounded lifecycle and commission-default patches", () => {
    assert.deepEqual(parseAffiliateLifecyclePatch({ active: false }), { active: false });
    assert.deepEqual(
      parseAffiliateLifecyclePatch({ active: true, defaultCommissionBps: 1250 }),
      { active: true, defaultCommissionBps: 1250 },
    );
    for (const body of [
      {},
      { other: true },
      { active: "yes" },
      { defaultCommissionBps: -1 },
      { defaultCommissionBps: 10_001 },
      { defaultCommissionBps: 1.5 },
    ]) assert.equal(rejected(() => parseAffiliateLifecyclePatch(body)).code, "invalid_payload");
  });
});
