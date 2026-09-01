import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { GET as familiesGet } from "./route.ts";
import { GET as versionsGet, POST as versionsPost } from "./[key]/versions/route.ts";
import { POST as activatePost } from "./[key]/activate/route.ts";
import { POST as evaluatePost } from "./[key]/[version]/evaluate/route.ts";

describe("admin prompt routes", () => {
  it("is dependency-inert with an empty 404 while disabled", async () => {
    const previous = process.env.FEATURE_ADMIN;
    delete process.env.FEATURE_ADMIN;
    const context = { params: { then() { throw new Error("params touched"); } } } as never;
    try {
      const responses = await Promise.all([
        familiesGet(),
        versionsGet(new Request("http://local"), context),
        versionsPost(new Request("http://local", { method: "POST", body: "{" }), context),
        activatePost(new Request("http://local", { method: "POST", body: "{" }), context),
        evaluatePost(new Request("http://local", { method: "POST", body: "{" }), context),
      ]);
      for (const response of responses) assert.equal(response.status, 404);
    } finally {
      if (previous === undefined) delete process.env.FEATURE_ADMIN; else process.env.FEATURE_ADMIN = previous;
    }
  });

  it("exports only the ratified read, append, and activate methods", () => {
    const versions = readFileSync(new URL("./[key]/versions/route.ts", import.meta.url), "utf8");
    const activate = readFileSync(new URL("./[key]/activate/route.ts", import.meta.url), "utf8");
    const evaluate = readFileSync(new URL("./[key]/[version]/evaluate/route.ts", import.meta.url), "utf8");
    assert.match(versions, /export async function GET/);
    assert.match(versions, /export async function POST/);
    assert.doesNotMatch(versions, /export async function (PATCH|PUT|DELETE)/);
    assert.match(activate, /export async function POST/);
    assert.doesNotMatch(activate, /export async function (GET|PATCH|PUT|DELETE)/);
    assert.match(evaluate, /export async function POST/);
    assert.doesNotMatch(evaluate, /export async function (GET|PATCH|PUT|DELETE)/);
    assert.doesNotMatch(evaluate, /\.json\(\)|evaluator|dataset|result/);
    for (const source of [versions, activate, evaluate]) {
      assert.ok(source.indexOf('if (!featureFlag("FEATURE_ADMIN"))') < source.indexOf('await import("@/lib/admin/handlers")'));
      assert.match(source, /await context.params/);
    }
  });
});
