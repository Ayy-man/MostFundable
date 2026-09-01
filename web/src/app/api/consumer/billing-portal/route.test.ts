import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

describe("consumer billing portal route boundary", () => {
  it("orders the enrollment gate and same-origin check before the billing service", () => {
    const ordered = [
      'featureFlag("FEATURE_ENROLLMENT")',
      "sameOrigin(request)",
      'import("@/lib/billing/consumer-portal.server")',
    ].map((token) => source.indexOf(token));
    assert.ok(ordered.every((position) => position >= 0));
    assert.deepEqual(ordered, [...ordered].sort((left, right) => left - right));
  });
});
