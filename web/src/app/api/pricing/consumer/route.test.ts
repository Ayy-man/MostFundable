import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

describe("consumer pricing route", () => {
  it("checks the paid-refresh flag before privileged imports", () => {
    assert.ok(source.indexOf('featureFlag("FEATURE_PAID_REFRESH")') < source.indexOf("Promise.all"));
    assert.match(source, /if \(!featureFlag\("FEATURE_PAID_REFRESH"\)\) notFound\(\)/);
  });

  it("authorizes only consumers and selects only their catalog", () => {
    assert.match(source, /handlePricingCatalog\("consumer"/);
    assert.match(source, /resolveConsumerPricingCatalog/);
    assert.match(source, /resolveGovernedForcePullPrice/);
    assert.doesNotMatch(source, /operator_member|platform_admin/);
  });

  it("resolves governance inside the post-auth catalog callback", () => {
    assert.ok(source.indexOf("handlePricingCatalog") < source.lastIndexOf("resolveGovernedForcePullPrice"));
  });
});
