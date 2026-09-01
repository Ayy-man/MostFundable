import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { GET } from "./route.ts";

describe("admin audit route", () => {
  it("returns an empty 404 before loading the handler while FEATURE_ADMIN is off", async () => {
    const previous = process.env.FEATURE_ADMIN;
    delete process.env.FEATURE_ADMIN;
    try {
      const response = await GET(new Request("http://local/api/admin/audit"));
      assert.equal(response.status, 404);
      assert.equal(await response.text(), "");
    } finally {
      if (previous === undefined) delete process.env.FEATURE_ADMIN;
      else process.env.FEATURE_ADMIN = previous;
    }
  });

  it("is GET-only, feature-gated before its dynamic import, and contains no data projection", () => {
    const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
    assert.match(source, /export async function GET/);
    assert.doesNotMatch(source, /export async function (POST|PATCH|PUT|DELETE)/);
    assert.ok(source.indexOf('if (!featureFlag("FEATURE_ADMIN"))') < source.indexOf('await import("@\/lib\/admin\/audit-handler")'));
    assert.doesNotMatch(source, /supabase|profiles|meta|email/i);
  });
});
