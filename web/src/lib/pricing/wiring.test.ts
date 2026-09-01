import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const PRICING_KEYS = [
  "CONSUMER_MONITORING_PRICE_CENTS",
  "CONSUMER_MONITORING_PRICE_REF",
  "FORCE_PULL_PRICE_CENTS",
  "OPERATOR_BASE_PRICE_CENTS",
  "OPERATOR_SEAT_PRICE_CENTS",
  "STRIPE_PRICE_OPERATOR_BASE",
  "STRIPE_PRICE_OPERATOR_SEAT",
  "MONITORING_SPLIT_PCT",
  "SAAS_REFERRAL_BASE",
] as const;

function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

test("pricing wiring centralizes every runtime pricing environment read", () => {
  const libRoot = join(process.cwd(), "src", "lib");
  const resolver = join(libRoot, "pricing", "resolver.ts");
  for (const path of productionFiles(libRoot)) {
    if (path === resolver) continue;
    const source = readFileSync(path, "utf8");
    for (const key of PRICING_KEYS) {
      const directRead = new RegExp(`(?:process\\.env|env)(?:\\.${key}|\\[["']${key}["']\\])`);
      assert.equal(directRead.test(source), false, `${key} escaped pricing resolver into ${path}`);
    }
  }
  const source = readFileSync(resolver, "utf8");
  for (const key of PRICING_KEYS) assert.equal(source.includes(key), true, `${key} is not resolved centrally`);
});
