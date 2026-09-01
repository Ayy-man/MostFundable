import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { monitoringReadSource } from "./read-source.ts";

describe("monitoring durable-read provenance", () => {
  it("never falls back to generated scores in production", () => {
    for (const CRS_DRIVER of [undefined, "mock", "sandbox", "invalid"]) {
      assert.equal(monitoringReadSource({ CRS_DRIVER, NODE_ENV: "production" }), "provider");
    }
  });

  it("does not require live sandbox credentials to classify an existing durable read", () => {
    assert.equal(
      monitoringReadSource({ CRS_DRIVER: "sandbox", NODE_ENV: "production" }),
      "provider",
    );
  });

  it("keeps deterministic mock readings limited to non-production workspaces", () => {
    assert.equal(monitoringReadSource({ NODE_ENV: "test" }), "mock");
    assert.equal(monitoringReadSource({ CRS_DRIVER: "mock", NODE_ENV: "development" }), "mock");
    assert.equal(monitoringReadSource({ CRS_DRIVER: "sandbox", NODE_ENV: "development" }), "provider");
  });
});
