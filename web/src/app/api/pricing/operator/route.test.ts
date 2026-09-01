import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

describe("operator pricing route", () => {
  it("checks the paid-refresh flag before privileged imports", () => {
    assert.ok(source.indexOf('featureFlag("FEATURE_PAID_REFRESH")') < source.indexOf("Promise.all"));
    assert.match(source, /notFound\(\)/);
  });

  it("authorizes only operator members and selects only their catalog", () => {
    assert.match(source, /handlePricingCatalog\("operator_member"/);
    assert.match(source, /resolveOperatorPricingCatalog/);
    assert.doesNotMatch(source, /platform_admin|handlePricingCatalog\("consumer"/);
  });
});
