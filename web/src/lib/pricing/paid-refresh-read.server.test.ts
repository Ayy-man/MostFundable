import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./paid-refresh-read.server.ts", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "");

test("real authentication uses the cookie client and leaves actor derivation to the RPC", () => {
  assert.match(source, /session\.role !== "consumer"/);
  assert.match(source, /session\.orgId === null/);
  assert.match(source, /if \(featureFlag\("FEATURE_REAL_AUTH"\)\)/);
  assert.match(source, /actorId: null/);
  assert.match(source, /await createClient\(\)/);
  assert.match(
    source,
    /\.rpc\("consumer_paid_refresh_history", \{\s*p_actor_id: actorId,\s*p_include_mock: process\.env\.NODE_ENV !== "production"/,
  );
});

test("the demo path passes only its resolved session actor through the service client", () => {
  assert.match(source, /await import\("@\/lib\/supabase\/admin"\)/);
  assert.match(source, /actorId: session\.id/);
  assert.doesNotMatch(source, /\.from\(/);
});

test("the authenticated RPC accepts only the closed provider-free DTO columns", () => {
  const rpcColumns = source.slice(
    source.indexOf("const RPC_ROW_KEYS"),
    source.indexOf("function isRecord"),
  );
  for (const column of [
    "amount_cents",
    "completed_at",
    "currency",
    "paid_at",
    "request_id",
    "requested_at",
    "status",
  ]) {
    assert.match(rpcColumns, new RegExp(`"${column}"`));
  }
  assert.match(source, /exactRpcRow\(row\)/);
  assert.match(source, /parseConsumerPaidRefreshHistory\(\{\s*refreshes:\s*\[\{/);
  assert.doesNotMatch(rpcColumns, /\bdriver\b|provider_payment_ref|provider_event_key/);
});
