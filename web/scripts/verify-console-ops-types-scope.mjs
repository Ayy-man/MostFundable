#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const webRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(webRoot, "..");
const committed = path.join(webRoot, "src/lib/db/types.ts");
const allowedObjects = new Set([
  "clients", "trainings", "client_status", "tracker_client_health",
  "tracker_client_health_batch", "set_client_status", "update_training", "unpublish_training",
]);
const allowedColumns = new Map([
  ["clients", new Set(["status", "archived_at", "archived_by", "last_activity_at"])],
  ["trainings", new Set(["takedown_reason", "taken_down_by", "taken_down_at"])],
]);

function findings(diff) {
  const problems = [];
  let object = null;
  for (const line of diff.split("\n")) {
    const content = line.startsWith("+") || line.startsWith(" ") ? line.slice(1) : "";
    const header = /^ {6}([a-z_]+):/.exec(content);
    if (header) object = header[1];
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    if (header && !allowedObjects.has(header[1])) problems.push(`unexpected object ${header[1]}`);
    const column = /^ {10}([a-z_]+)[?:]:/.exec(content);
    if (column && allowedColumns.has(object) && !allowedColumns.get(object).has(column[1])) {
      problems.push(`unexpected ${object} column ${column[1]}`);
    }
  }
  return [...new Set(problems)];
}

const poison = `diff --git a/types.ts b/types.ts\n@@\n   public: {\n     Tables: {\n+      sibling_private_table: {\n+          secret_value: string\n`;
assert.deepEqual(findings(poison), ["unexpected object sibling_private_table"]);
if (process.argv.includes("--self-test")) {
  console.log("Console operations types scope self-test passed: sibling object rejected.");
  process.exit(0);
}

const generated = process.argv[2];
if (!generated || !fs.existsSync(generated)) throw new Error("Pass the temporary generated types path.");
const diffResult = spawnSync("git", ["diff", "--no-index", "--unified=3", "--", committed, generated], { cwd: repoRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
assert.ok(diffResult.status === 0 || diffResult.status === 1, diffResult.stderr);
const problems = findings(diffResult.stdout);
assert.equal(problems.length, 0, problems.join("; "));
console.log("Console operations generated type diff is bounded to Phase 22 objects.");
