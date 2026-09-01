import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { stripComments } from "@/lib/testing/strip-comments";

const webRoot = path.resolve(import.meta.dirname, "../../..");
const repoRoot = path.resolve(webRoot, "..");
const schemaParts = ["amo" + "unt", "curr" + "ency", "perc" + "ent", "rew" + "ard", "pay" + "out", "led" + "ger", "pri" + "ce"];
const copyParts = ["$10 " + "rew" + "ard", "+" + "20 pts", "approval " + "od" + "ds"];

/**
 * Comments are stripped and string bodies are not, and the asymmetry is the point.
 *
 * The scanner looks for seven schema words and three copy phrases, and the copy half only ever
 * lives in a string literal — `$10 reward` is rendered text, so blanking strings would delete the
 * evidence this test exists to find. The comment half is the opposite: `amount`, `price`, `ledger`
 * and `payout` are ordinary English, so a docblock saying this module deliberately has no reward
 * ledger and no payout amount reported five violations at once against the raw file. The guard was
 * failing the comment that documented the property it checks.
 */
function findings(source: string, sql = false): string[] {
  const lower = stripComments(source, { sql }).toLowerCase();
  return [...schemaParts, ...copyParts].filter((part) => lower.includes(part.toLowerCase()));
}

function productionFiles(): string[] {
  const referralRoot = path.join(webRoot, "src/lib/referrals");
  const library = readdirSync(referralRoot)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => path.join(referralRoot, name));
  return [
    path.join(repoRoot, "supabase/migrations/120_consumer_referrals.sql"),
    ...library,
    path.join(webRoot, "src/app/api/referrals/route.ts"),
    path.join(webRoot, "src/app/api/referrals/convert/route.ts"),
    path.join(webRoot, "src/app/api/referrals/resolve/[token]/route.ts"),
    path.join(webRoot, "src/components/consumer/referral-share-control.tsx"),
  ];
}

test("negative-scope scanner catches planted schema and copy cases", () => {
  assert.deepEqual(findings(`create table x (${"rew" + "ard"}_cents bigint)`), ["rew" + "ard"]);
  assert.deepEqual(findings(`button>${"$10 " + "rew" + "ard"}</button>`), ["rew" + "ard", "$10 " + "rew" + "ard"]);
});

test("Phase 15 production sources contain only identity and lifecycle semantics", () => {
  for (const file of productionFiles()) {
    assert.deepEqual(findings(readFileSync(file, "utf8"), file.endsWith(".sql")), [], file);
  }
});

test("Phase 15 imports no neighboring business subsystem", () => {
  const importPattern = new RegExp(`@/lib/(${["bill" + "ing", "fe" + "es", "reve" + "nue", "applica" + "tions", "sup" + "port", "tra" + "cker"].join("|")})(?:/|[\"'])`);
  for (const file of productionFiles().filter((item) => /\.[tj]sx?$/.test(item))) {
    assert.doesNotMatch(stripComments(readFileSync(file, "utf8")), importPattern, file);
  }
});
