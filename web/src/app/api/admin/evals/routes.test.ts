import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { GET as historyGet } from "./route.ts";
import { GET as detailGet } from "./[id]/route.ts";

describe("admin eval routes", () => {
  it("is an empty read-only 404 while disabled", async () => {
    const previous = process.env.FEATURE_ADMIN;
    delete process.env.FEATURE_ADMIN;
    const context = { params: { then() { throw new Error("params touched"); } } } as never;
    try {
      assert.equal((await historyGet(new Request("http://local"))).status, 404);
      assert.equal((await detailGet(new Request("http://local"), context)).status, 404);
    } finally {
      if (previous === undefined) delete process.env.FEATURE_ADMIN; else process.env.FEATURE_ADMIN = previous;
    }
  });

  it("exports GET only and dynamically loads after the flag", () => {
    for (const relative of ["./route.ts", "./[id]/route.ts"]) {
      const source = readFileSync(new URL(relative, import.meta.url), "utf8");
      assert.match(source, /export async function GET/);
      assert.doesNotMatch(source, /export async function (POST|PATCH|PUT|DELETE)/);
      assert.ok(source.indexOf('if (!featureFlag("FEATURE_ADMIN"))') < source.indexOf('await import("@/lib/admin/handlers")'));
    }
  });
});
