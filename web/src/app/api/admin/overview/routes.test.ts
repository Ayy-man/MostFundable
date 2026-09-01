import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { GET as overviewGet } from "./route.ts";

describe("admin overview route", () => {
  it("returns an empty 404 while FEATURE_ADMIN is off", async () => {
    const previous = process.env.FEATURE_ADMIN;
    delete process.env.FEATURE_ADMIN;
    try {
      const response = await overviewGet();
      assert.equal(response.status, 404);
      assert.equal(await response.text(), "");
    } finally {
      if (previous === undefined) delete process.env.FEATURE_ADMIN; else process.env.FEATURE_ADMIN = previous;
    }
  });

  it("keeps the flag check before its dynamic handler import and holds no client detail", () => {
    const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
    assert.ok(source.indexOf('if (!featureFlag("FEATURE_ADMIN"))') < source.indexOf('await import("@/lib/admin/handlers")'));
    assert.equal(/supabase|orgs|profiles|analysis_runs/i.test(source), false);
  });
});
