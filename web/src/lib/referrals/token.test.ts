import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createOpaqueReferralToken, digestReferralToken, parseReferralToken } from "./token.ts";

test("tokens are 256-bit base64url values and distinct", () => {
  const tokens = new Set(Array.from({ length: 256 }, createOpaqueReferralToken));
  assert.equal(tokens.size, 256);
  for (const token of tokens) {
    assert.equal(token.length, 43);
    assert.match(token, /^[A-Za-z0-9_-]+$/);
    assert.equal(parseReferralToken(token), token);
  }
});

test("parser rejects values outside the exact generated shape", () => {
  for (const value of ["", "a".repeat(42), "a".repeat(44), `${"a".repeat(42)}=`, `${"a".repeat(42)}+`]) {
    assert.equal(parseReferralToken(value), null);
  }
});

test("digest is stable and exactly 32 bytes", () => {
  const token = "a".repeat(43);
  const digest = digestReferralToken(token);
  assert.equal(digest.length, 32);
  assert.deepEqual(digest, createHash("sha256").update(token).digest());
  assert.equal(JSON.stringify({ tokenDigest: digest.toString("hex") }).includes(token), false);
});
