#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DETECTORS = Object.freeze([
  ["SUPABASE_PAT", /\bsbp_[A-Za-z0-9_-]{20,}\b/g],
  ["STRIPE_SECRET", /\bsk_(?:test|live)_[A-Za-z0-9]{16,}\b/g],
  ["STRIPE_WEBHOOK", /\bwhsec_[A-Za-z0-9]{16,}\b/g],
  ["JWT", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g],
  ["GITHUB_PAT", /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g],
]);

const BINARY_EXTENSIONS = new Set([
  ".avif", ".bmp", ".gif", ".ico", ".jpeg", ".jpg", ".otf", ".pdf", ".png",
  ".ttf", ".webp", ".woff", ".woff2", ".zip",
]);
const SKIP_SEGMENTS = new Set(["node_modules", ".git", ".cache"]);

function parseArgs(argv) {
  const options = { repo: null, buildDir: null, selfTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--self-test") options.selfTest = true;
    else if (arg === "--repo") options.repo = argv[++index];
    else if (arg === "--build-dir") options.buildDir = argv[++index];
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function isInside(root, candidate) {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function shouldRead(file) {
  return !file.split(/[\\/]/).some((segment) => SKIP_SEGMENTS.has(segment))
    && !BINARY_EXTENSIONS.has(extname(file).toLowerCase());
}

function walkFiles(root, current = root, output = []) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const absolute = join(current, entry.name);
    if (!isInside(root, absolute) || SKIP_SEGMENTS.has(entry.name)) continue;
    if (entry.isDirectory()) walkFiles(root, absolute, output);
    else if (entry.isFile() && shouldRead(absolute)) output.push(absolute);
  }
  return output;
}

function trackedFiles(repoRoot) {
  const output = execFileSync("git", ["-C", repoRoot, "ls-files", "-z"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return output.split("\0").filter(Boolean).map((name) => resolve(repoRoot, name))
    .filter((file) => isInside(repoRoot, file) && shouldRead(file));
}

export function scanFiles(files, displayRoot) {
  const findings = [];
  for (const file of [...new Set(files)].sort()) {
    let buffer;
    try {
      buffer = readFileSync(file);
    } catch {
      findings.push({ detector: "UNREADABLE_FILE", path: relative(displayRoot, file), line: 0 });
      continue;
    }
    if (buffer.includes(0)) continue;
    const text = buffer.toString("utf8");
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      for (const [detector, pattern] of DETECTORS) {
        pattern.lastIndex = 0;
        if (pattern.test(line)) findings.push({ detector, path: relative(displayRoot, file), line: index + 1 });
      }
      if (/\.env\.example$/i.test(file)) {
        const assignment = line.match(/^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.*)$/);
        if (assignment && assignment[1].trim().replace(/^(['"])(.*)\1$/, "$2").trim() !== "") {
          findings.push({ detector: "ENV_EXAMPLE_NONBLANK", path: relative(displayRoot, file), line: index + 1 });
        }
      }
    }
  }
  return findings;
}

export function scanAcceptance({ repo, buildDir }) {
  if (!repo) throw new Error("acceptance mode requires --repo");
  if (!buildDir) throw new Error("acceptance mode requires --build-dir");
  const repoRoot = resolve(repo);
  const buildRoot = resolve(buildDir);
  if (!statSync(repoRoot).isDirectory()) throw new Error("repository root is not a directory");
  if (!isInside(repoRoot, buildRoot)) throw new Error("build directory must be inside the repository root");
  if (!statSync(buildRoot).isDirectory()) throw new Error("build directory is missing");
  return scanFiles([...trackedFiles(repoRoot), ...walkFiles(buildRoot)], repoRoot);
}

function selfTest() {
  const root = mkdtempSync(join(tmpdir(), "mf-secret-self-test-"));
  try {
    const file = join(root, "synthetic.txt");
    mkdirSync(dirname(file), { recursive: true });
    const values = [
      "sb" + "p_" + "a".repeat(24),
      "s" + "k_test_" + "b".repeat(24),
      "wh" + "sec_" + "c".repeat(24),
      "ey" + "J" + "d".repeat(12) + "." + "e".repeat(12) + "." + "f".repeat(12),
      "gh" + "p_" + "g".repeat(24),
    ];
    writeFileSync(file, values.join("\n"));
    const findings = scanFiles([file], root);
    const ids = new Set(findings.map(({ detector }) => detector));
    if (DETECTORS.some(([id]) => !ids.has(id))) throw new Error("a detector did not fire");
    const rendered = JSON.stringify(findings);
    if (values.some((value) => rendered.includes(value))) throw new Error("finding output exposed a value");
    return { verdict: "PASS", detectors: DETECTORS.length, findings: findings.length };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = options.selfTest
      ? selfTest()
      : (() => {
          const findings = scanAcceptance(options);
          return { verdict: findings.length === 0 ? "PASS" : "FAIL", findings };
        })();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.verdict !== "PASS") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ verdict: "FAIL", error: error.message })}\n`);
    process.exitCode = 1;
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main();
