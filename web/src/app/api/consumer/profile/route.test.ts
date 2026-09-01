import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const patchSource = source.slice(source.indexOf("export async function PATCH"));

describe("consumer profile route boundary", () => {
  it("offers a no-store self read without accepting caller scope", () => {
    assert.match(source, /export async function GET\(request: Request\)/);
    assert.match(source, /new URL\(request\.url\)\.searchParams\.keys\(\)/);
    assert.match(source, /handleConsumerProfileRead/);
  });

  it("checks real auth and same origin before loading the mutation service", () => {
    const ordered = [
      'featureFlag("FEATURE_REAL_AUTH")',
      "sameOrigin(request)",
      'import("@/lib/profile/consumer-profile.server")',
    ].map((token) => patchSource.indexOf(token));
    assert.ok(ordered.every((position) => position >= 0));
    assert.deepEqual(ordered, [...ordered].sort((left, right) => left - right));
  });
});
