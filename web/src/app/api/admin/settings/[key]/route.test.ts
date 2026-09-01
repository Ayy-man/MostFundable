import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { GET, PATCH } from "./route.ts";

describe("admin settings route", () => {
  it("returns an empty 404 before params or body work while disabled", async () => {
    const previous = process.env.FEATURE_ADMIN;
    delete process.env.FEATURE_ADMIN;
    let parsed = false;
    const context = { params: { then() { throw new Error("params touched"); } } } as never;
    try {
      const get = await GET(new Request("http://local"), context);
      const patch = await PATCH({ async json() { parsed = true; return {}; } } as Request, context);
      assert.equal(get.status, 404);
      assert.equal(await get.text(), "");
      assert.equal(patch.status, 404);
      assert.equal(parsed, false);
    } finally {
      if (previous === undefined) delete process.env.FEATURE_ADMIN; else process.env.FEATURE_ADMIN = previous;
    }
  });

  it("keeps the flag check before the dynamic handler import and awaits params", () => {
    const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
    assert.ok(source.indexOf('if (!featureFlag("FEATURE_ADMIN"))') < source.indexOf('await import("@/lib/admin/handlers")'));
    assert.equal(source.split("await context.params").length - 1, 2);
  });
});
