import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { buildInventory, parseArguments } from "../../scripts/verify-rls-matrix.mjs";
import { databaseMatrices } from "./acceptance-manifest.mjs";

const roots = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "mf-rls-test-"));
  roots.push(root);
  const directory = join(root, "supabase/tests");
  mkdirSync(directory, { recursive: true });
  for (const file of files) writeFileSync(join(directory, file), "select 1;\n");
  return root;
}

test("the repository inventory is complete, sorted, and includes test 160", () => {
  const result = buildInventory();
  assert.equal(result.verdict, "PASS");
  assert.equal(result.count, databaseMatrices.length);
  assert.deepEqual(result.files, [...result.files].sort());
  assert.equal(result.files.includes("160_hardening_state_machines.test.sql"), true);
  assert.match(result.digest, /^[a-f0-9]{64}$/);
});

test("a newly added SQL file fails as unmapped", () => {
  const root = fixture(["001_known.test.sql", "002_unmapped.test.sql"]);
  const result = buildInventory(root, [{ file: "../supabase/tests/001_known.test.sql", domain: "known" }]);
  assert.equal(result.verdict, "FAIL");
  assert.deepEqual(result.unmapped, ["002_unmapped.test.sql"]);
});

test("a declared but absent SQL file fails as missing", () => {
  const root = fixture(["001_known.test.sql"]);
  const result = buildInventory(root, [
    { file: "../supabase/tests/001_known.test.sql", domain: "known" },
    { file: "../supabase/tests/002_missing.test.sql", domain: "missing" },
  ]);
  assert.equal(result.verdict, "FAIL");
  assert.deepEqual(result.missing, ["002_missing.test.sql"]);
});

test("only complete inventory or complete run modes are accepted", () => {
  assert.equal(parseArguments(["--inventory"]), "--inventory");
  assert.equal(parseArguments(["--run"]), "--run");
  assert.throws(() => parseArguments(["--run", "160"]), /filtered arguments are refused/);
  assert.throws(() => parseArguments(["--filter", "billing"]), /filtered arguments are refused/);
  assert.throws(() => parseArguments([]), /choose exactly one complete mode/);
});

test("run implementation invokes one complete database test command and no stack mutation", () => {
  const source = readFileSync(new URL("../../scripts/verify-rls-matrix.mjs", import.meta.url), "utf8");
  assert.equal((source.match(/spawnSync\("supabase", \["test", "db"\]/g) ?? []).length, 1);
  for (const forbidden of ["db " + "reset", "db " + "push", "migration " + "repair", "supabase " + "start", "supabase " + "stop", "supabase " + "link"]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
