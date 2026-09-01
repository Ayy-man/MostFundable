import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const webRoot = path.resolve(import.meta.dirname, "..", "..");

test("billing operations persisted acceptance verifier", {
  skip: process.env.MF_BILLING_OPS_ACCEPTANCE === "1"
    ? false
    : "set MF_BILLING_OPS_ACCEPTANCE=1 to run the dedicated production verifier",
}, () => {
  const result = spawnSync(process.execPath, ["scripts/verify-billing-ops-api.mjs"], {
    cwd: webRoot,
    encoding: "utf8",
    env: process.env,
    timeout: 180_000,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Billing operations API verification passed:/);
  assert.doesNotMatch(result.stdout + result.stderr, /SUPABASE_SERVICE_ROLE_KEY=|STRIPE_SECRET_KEY=/);
});
