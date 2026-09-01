import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const consumer = readFileSync(new URL("./consumer/privacy-requests/route.ts", import.meta.url), "utf8");
const adminList = readFileSync(new URL("./admin/privacy-requests/route.ts", import.meta.url), "utf8");
const adminAction = readFileSync(new URL("./admin/privacy-requests/[id]/route.ts", import.meta.url), "utf8");

describe("privacy request route contracts", () => {
  it("keeps consumer requests behind real auth and same-origin mutation", () => {
    assert.match(consumer, /featureFlag\("FEATURE_REAL_AUTH"\)/);
    assert.match(consumer, /sameOrigin\(request\)/);
    assert.match(consumer, /handleConsumerPrivacyRequests/);
  });

  it("keeps admin reads and mutations behind both admin and real auth", () => {
    for (const source of [adminList, adminAction]) {
      assert.match(source, /featureFlag\("FEATURE_ADMIN"\)/);
      assert.match(source, /featureFlag\("FEATURE_REAL_AUTH"\)/);
    }
    assert.match(adminAction, /sameOrigin\(request\)/);
    assert.match(adminAction, /UUID\.test\(id\)/);
  });

  it("never accepts storage coordinates or provider references from HTTP", () => {
    for (const source of [consumer, adminList, adminAction]) {
      assert.doesNotMatch(source, /bucket|objectPath|subscriptionRef|memberRef/);
    }
  });
});
