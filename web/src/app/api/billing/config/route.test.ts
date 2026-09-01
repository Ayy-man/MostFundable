import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GET, handleBillingConfig } from "./route.ts";

describe("billing config route", () => {
  it("returns 404 before auth while the flag is off", async () => {
    const previous = process.env.FEATURE_BILLING_OPS;
    delete process.env.FEATURE_BILLING_OPS;
    try { assert.equal((await GET()).status, 404); }
    finally {
      if (previous === undefined) delete process.env.FEATURE_BILLING_OPS;
      else process.env.FEATURE_BILLING_OPS = previous;
    }
  });

  it("requires platform-admin authority before reading mode", async () => {
    const poisonedTestKey = ["sk", "test", "private"].join("_");
    for (const status of [401, 403] as const) {
      const response = await handleBillingConfig({
        env: { STRIPE_SECRET_KEY: poisonedTestKey },
        async requirePlatformAdmin() { throw { status }; },
      });
      assert.equal(response.status, status);
      assert.equal((await response.text()).includes("sk_test"), false);
    }
  });

  it("returns exactly one boolean for test, live, missing and mock configurations", async () => {
    for (const [key, expected] of [
      [["sk", "test", "private", "poison"].join("_"), true],
      [["sk", "live", "private", "poison"].join("_"), false],
      [undefined, false],
      ["mock_key_private_poison", false],
    ] as const) {
      const response = await handleBillingConfig({
        env: { STRIPE_SECRET_KEY: key },
        async requirePlatformAdmin() { return {}; },
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { testMode: expected });
      assert.equal(response.headers.get("cache-control"), "private, no-store");
    }
  });
});
