import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { describe, it } from "node:test";

import { resolveStackEnv, stackSkipReason } from "./billing-support";

const execute = promisify(execFile);
const stack = resolveStackEnv();
const skip = stack === null ? `KB API verification skipped: ${stackSkipReason()}` : false;

describe("KB surfaces", { skip }, () => {
  it("proves flag, role, grounding, citation, scope, footer, and held-draft behavior on the built app", { timeout: 180_000 }, async () => {
    const webRoot = path.resolve(import.meta.dirname, "../..");
    const { stdout, stderr } = await execute(process.execPath, [
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      "--import",
      path.join(webRoot, "scripts/ts-resolve-hook.mjs"),
      path.join(webRoot, "scripts/verify-kb-api.mjs"),
    ], { cwd: webRoot, timeout: 175_000, maxBuffer: 2 * 1024 * 1024 });
    assert.equal(stderr, "");
    // The verifier exits nonzero when any internal assertion fails. Its exact
    // count grows with that script, so this wrapper checks for a positive run
    // receipt instead of maintaining a second, immediately stale inventory.
    assert.match(stdout, /^KB API verification passed: [1-9]\d* assertions\.\n$/);
  });
});
