import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("conversion derives actor and token outside the body", () => {
  assert.match(source, /requireRole\("consumer"\)/);
  assert.match(source, /cookieStore\.get\("mf_referral_token"\)/);
  assert.match(source, /actorId: actor\.id/);
  assert.doesNotMatch(source, /body\.(?:actorId|token|orgId)/);
});

test("conversion deletes context only after stable success", () => {
  assert.ok(source.indexOf("completeConsumerReferral") < source.indexOf("cookieStore.delete"));
  assert.match(source, /return response\(result, 200\)/);
});
