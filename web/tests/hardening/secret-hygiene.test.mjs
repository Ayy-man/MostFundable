import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { scanAcceptance, scanFiles } from "../../scripts/verify-secret-hygiene.mjs";

const roots = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), "mf-secret-test-"));
  roots.push(root);
  return root;
}

const secretValues = () => [
  "sb" + "p_" + "a".repeat(24),
  "s" + "k_live_" + "b".repeat(24),
  "wh" + "sec_" + "c".repeat(24),
  "ey" + "J" + "d".repeat(12) + "." + "e".repeat(12) + "." + "f".repeat(12),
  "gh" + "o_" + "g".repeat(24),
];

test("all credential detectors fire and output is value-redacted", () => {
  const root = tempRoot();
  const file = join(root, "positive.txt");
  const values = secretValues();
  writeFileSync(file, values.join("\n"));
  const findings = scanFiles([file], root);

  assert.deepEqual(
    new Set(findings.map(({ detector }) => detector)),
    new Set(["SUPABASE_PAT", "STRIPE_SECRET", "STRIPE_WEBHOOK", "JWT", "GITHUB_PAT"]),
  );
  const rendered = JSON.stringify(findings);
  for (const value of values) assert.equal(rendered.includes(value), false);
  assert.deepEqual(Object.keys(findings[0]).sort(), ["detector", "line", "path"]);
});

test("blank example key names pass without creating an allowlist for values", () => {
  const root = tempRoot();
  const file = join(root, ".env.example");
  writeFileSync(file, "SUPABASE_ACCESS_TOKEN=\nSTRIPE_SECRET_KEY=\"\"\n# names only\n");
  assert.deepEqual(scanFiles([file], root), []);
});

test("a nonblank example value fails by location without echoing the value", () => {
  const root = tempRoot();
  const file = join(root, ".env.example");
  const value = "synthetic-nonblank-value";
  writeFileSync(file, `API_KEY=${value}\n`);
  const findings = scanFiles([file], root);
  assert.deepEqual(findings, [{ detector: "ENV_EXAMPLE_NONBLANK", path: ".env.example", line: 1 }]);
  assert.equal(JSON.stringify(findings).includes(value), false);
});

test("acceptance mode fails closed when its build directory is absent", () => {
  const root = tempRoot();
  assert.throws(
    () => scanAcceptance({ repo: root, buildDir: join(root, ".next") }),
    /build directory is missing|ENOENT/,
  );
});

test("binary files are ignored", () => {
  const root = tempRoot();
  const file = join(root, "image.png");
  writeFileSync(file, Buffer.from([0, 1, 2, 3]));
  assert.deepEqual(scanFiles([file], root), []);
});

test("a build root outside the repository is refused", () => {
  const repo = tempRoot();
  const build = tempRoot();
  mkdirSync(build, { recursive: true });
  assert.throws(() => scanAcceptance({ repo, buildDir: build }), /inside the repository/);
});
