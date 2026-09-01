import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { GET as analyticsGet } from "./route.ts";
import { GET as layoutGet, PATCH as layoutPatch } from "./layout/route.ts";
import { POST as runNowPost } from "./run-now/route.ts";

describe("admin analytics routes", () => {
  it("returns the same empty 404 from every method while disabled", async () => {
    const previous = process.env.FEATURE_ADMIN;
    delete process.env.FEATURE_ADMIN;
    try {
      const responses = await Promise.all([
        analyticsGet(new Request("http://local")),
        layoutGet(),
        layoutPatch(new Request("http://local", { method: "PATCH", body: "{" })),
        runNowPost(new Request("http://local", { method: "POST", body: "{" })),
      ]);
      for (const response of responses) {
        assert.equal(response.status, 404);
        assert.equal(await response.text(), "");
      }
    } finally {
      if (previous === undefined) delete process.env.FEATURE_ADMIN; else process.env.FEATURE_ADMIN = previous;
    }
  });

  it("keeps every flag check before its dynamic handler import", () => {
    for (const relative of ["./route.ts", "./layout/route.ts", "./run-now/route.ts"]) {
      const source = readFileSync(new URL(relative, import.meta.url), "utf8");
      assert.ok(source.indexOf('if (!featureFlag("FEATURE_ADMIN"))') < source.indexOf('await import("@/lib/admin/handlers")'), relative);
      assert.equal(/supabase|kpi_rollups|admin_layouts/i.test(source), false, relative);
    }
  });
});
