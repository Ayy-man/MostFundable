import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("create exports POST only and accepts no browser identity", () => {
  assert.match(source, /export async function POST\(\)/);
  assert.doesNotMatch(source, /export async function (?:GET|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(source, /request\.json|clientId|orgId|actorId/);
});

test("create checks availability before session and service mutation", () => {
  assert.ok(source.indexOf("resolveReferralAvailability()") < source.indexOf("requireRole(\"consumer\")"));
  assert.ok(source.indexOf("requireRole(\"consumer\")") < source.indexOf("createConsumerReferral(actor)"));
  assert.match(source, /status: 201/);
  assert.match(source, /Cache-Control/);
});
