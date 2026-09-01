import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

describe("consumer applications route", () => {
  it("gates both durable prerequisites and caller-controlled filters before loading the service", () => {
    const ordered = [
      'featureFlag("FEATURE_REAL_AUTH")',
      'featureFlag("FEATURE_APPLICATIONS")',
      "new URL(request.url).searchParams.keys()",
      'import("@/lib/applications/consumer.server")',
    ].map((token) => source.indexOf(token));
    assert.ok(ordered.every((position) => position >= 0));
    assert.deepEqual(ordered, [...ordered].sort((left, right) => left - right));
  });

  it("exports a no-store GET only", () => {
    assert.match(source, /export async function GET/);
    assert.doesNotMatch(source, /export async function (?:POST|PATCH|DELETE)/);
    assert.match(source, /private, no-store/);
  });
});
