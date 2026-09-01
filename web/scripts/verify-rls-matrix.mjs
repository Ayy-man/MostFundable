#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { databaseMatrices } from "../tests/hardening/acceptance-manifest.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = resolve(scriptDir, "../..");

export function parseArguments(argv) {
  if (argv.length !== 1 || !new Set(["--inventory", "--run"]).has(argv[0])) {
    throw new Error("choose exactly one complete mode: --inventory or --run; filtered arguments are refused");
  }
  return argv[0];
}

export function buildInventory(repoRoot = defaultRepoRoot, matrices = databaseMatrices) {
  const testDirectory = resolve(repoRoot, "supabase/tests");
  const actual = readdirSync(testDirectory).filter((name) => name.endsWith(".sql")).sort();
  const declared = matrices.map(({ file }) => basename(file)).sort();
  const missing = declared.filter((name) => !actual.includes(name));
  const unmapped = actual.filter((name) => !declared.includes(name));
  const digest = createHash("sha256").update(actual.join("\n") + "\n").digest("hex");
  return {
    verdict: missing.length === 0 && unmapped.length === 0 ? "PASS" : "FAIL",
    count: actual.length,
    digest,
    files: actual,
    missing,
    unmapped,
  };
}

export function runCompleteSuite(repoRoot = defaultRepoRoot) {
  const inventory = buildInventory(repoRoot);
  if (inventory.verdict !== "PASS") return { inventory, status: 1 };
  const result = spawnSync("supabase", ["test", "db"], { cwd: repoRoot, stdio: "inherit" });
  if (result.error) throw result.error;
  return { inventory, status: result.status ?? 1 };
}

function main() {
  try {
    const mode = parseArguments(process.argv.slice(2));
    if (mode === "--inventory") {
      const inventory = buildInventory();
      process.stdout.write(`${JSON.stringify(inventory)}\n`);
      if (inventory.verdict !== "PASS") process.exitCode = 1;
      return;
    }
    const result = runCompleteSuite();
    if (result.status !== 0) process.exitCode = result.status;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ verdict: "FAIL", error: error.message })}\n`);
    process.exitCode = 1;
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main();
