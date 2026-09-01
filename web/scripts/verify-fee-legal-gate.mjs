#!/usr/bin/env node

// ROADMAP Phase 12, criterion 1, as a check rather than an argument:
//
//   "The package fee model is unreachable — by any writer — until
//    `org_flags.upfront_fee_approved` is true for the org."
//
// The trigger in migration 091 is what actually enforces that, and pgTAP proves
// it against every role including `postgres`. This script guards the things a
// trigger cannot: that the layers above it keep routing through the one gate
// helper, that the SQLSTATE stays in one module, that no migration quietly
// grants itself a way around RLS, and that nothing anywhere ships with the flag
// already open.
//
// Dependency-free on purpose, like every other `verify-*.mjs` here: a gate that
// needs an install step is a gate that gets skipped.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = fileURLToPath(new URL("../", import.meta.url));
const REPO_ROOT = path.join(WEB_ROOT, "..");
const SOURCE_ROOT = path.join(WEB_ROOT, "src");
const FEE_ROUTE_ROOT = path.join(SOURCE_ROOT, "app", "api", "fees");
const FEE_LIB_ROOT = path.join(SOURCE_ROOT, "lib", "fees");
const MIGRATIONS_ROOT = path.join(REPO_ROOT, "supabase", "migrations");
const SUPABASE_ROOT = path.join(REPO_ROOT, "supabase");
const ENV_EXAMPLE = path.join(WEB_ROOT, ".env.example");
const GATE_MODULE = "src/lib/fees/legal-gate.ts";

const EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mts"]);
const PRUNED = new Set([".next", "node_modules"]);
// This phase owns 090–099. A migration outside that range belongs to another
// lane and is not this script's business, which is also why the range is a
// pattern rather than a list of four filenames.
const PHASE_MIGRATION = /^09\d_.*\.sql$/;

function walk(directory, files = []) {
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!PRUNED.has(entry.name)) walk(path.join(directory, entry.name), files);
      continue;
    }
    if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) {
      files.push(path.join(directory, entry.name));
    }
  }
  return files;
}

function relative(file) {
  return path.relative(REPO_ROOT, file).split(path.sep).join("/");
}

function lineAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

const findings = [];
function report(file, source, index, rule) {
  findings.push(`${relative(file)}:${lineAt(source, index)} [${rule}]`);
}
function reportFile(file, rule) {
  findings.push(`${relative(file)} [${rule}]`);
}

// ---------------------------------------------------------------------------
// Rule 1 — a gated write cannot be added without naming the gate.
//
// Scanned: the fee routes, and `src/lib/fees/handlers.ts`, which holds the
// route bodies. Scanning only `app/api/fees/**` would pass on an empty set,
// because those seven files are deliberately three lines of delegation each;
// the file that names `upfrontCents` is the one worth checking.
//
// Both halves of the rule are evaluated against code with comments removed,
// and that is the whole difficulty of this check. The first draft matched raw
// text, and a mutation test caught it passing a handler whose gate call had
// been deleted — because the doc comment above the function still contained the
// word `isGatedFeeChange`. A comment that explains the gate must never be the
// thing that satisfies it.
// ---------------------------------------------------------------------------

/** Strip line and block comments while preserving string and template
 * contents, so `://` in a URL and `/*` inside a literal are left alone. */
function code(source) {
  let out = "";
  let index = 0;
  let quote = null;
  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];
    if (quote) {
      if (character === "\\") {
        out += "  ";
        index += 2;
        continue;
      }
      if (character === quote) quote = null;
      out += character;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      out += character;
      index += 1;
      continue;
    }
    if (character === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        if (source[index] === "\n") out += "\n";
        index += 1;
      }
      index += 2;
      continue;
    }
    out += character;
    index += 1;
  }
  return out;
}

const GATE_SYMBOLS = /\b(?:assertFeeChangeAllowed|isGatedFeeChange)\b/;
const GATED_FIELDS = [
  ["a package model literal", /(["'])package\1/g],
  ["an upfront amount field", /\b(?:upfrontCents|upfront_cents)\b/g],
  ["a trigger amount field", /\b(?:triggerCents|trigger_cents)\b/g],
];

const routeFiles = walk(FEE_ROUTE_ROOT);
const handlerFile = path.join(FEE_LIB_ROOT, "handlers.ts");
const gatedWriteFiles = [...routeFiles];
if (fs.existsSync(handlerFile)) gatedWriteFiles.push(handlerFile);

if (routeFiles.length === 0) {
  findings.push(
    "web/src/app/api/fees [scanned 0 route files; the fee routes moved or were deleted]",
  );
}

for (const file of gatedWriteFiles) {
  const source = code(fs.readFileSync(file, "utf8"));
  if (GATE_SYMBOLS.test(source)) continue;
  for (const [label, pattern] of GATED_FIELDS) {
    for (const match of source.matchAll(pattern)) {
      report(
        file,
        source,
        match.index,
        `${label} is written here, but neither assertFeeChangeAllowed nor isGatedFeeChange is named in this file`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Rule 2 — the SQLSTATE lives in exactly one module.
//
// `legal-gate.ts` exports it as LEGAL_GATE_SQLSTATE. Every other file that
// needs to talk about it names the constant, so there is one place to change if
// PostgREST's mapping ever moves.
// ---------------------------------------------------------------------------

for (const file of walk(SOURCE_ROOT)) {
  const rel = path.relative(WEB_ROOT, file).split(path.sep).join("/");
  if (rel === GATE_MODULE) continue;
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(/\bPT403\b/g)) {
    report(file, source, match.index, `PT403 belongs only in ${GATE_MODULE}`);
  }
}

// ---------------------------------------------------------------------------
// Rule 3 — no Phase-12 migration creates a definer function.
//
// D-01/D-16: the gate is a trigger precisely because `service_role` bypasses
// RLS, and a security definer function would hand back the privileged write
// path the trigger exists to close. Whitespace is collapsed so that
// `security\n  definer` cannot slip through a two-word grep.
// ---------------------------------------------------------------------------

const migrationFiles = fs.existsSync(MIGRATIONS_ROOT)
  ? fs
      .readdirSync(MIGRATIONS_ROOT)
      .filter((name) => PHASE_MIGRATION.test(name))
      .map((name) => path.join(MIGRATIONS_ROOT, name))
  : [];

for (const file of migrationFiles) {
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.replace(/\s+/g, " ").matchAll(/security definer/gi)) {
    reportFile(
      file,
      `security definer at collapsed offset ${match.index}; Phase 12 functions are all invoker (D-01, D-16)`,
    );
  }
}

// ---------------------------------------------------------------------------
// Rule 4 — no seed opens the gate.
//
// A seeded `org_flags` row would mean the demo data ships with legal sign-off
// nobody gave, and every environment restored from it would start approved.
// ---------------------------------------------------------------------------

const seedFiles = fs.existsSync(SUPABASE_ROOT)
  ? fs
      .readdirSync(SUPABASE_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.startsWith("seed"))
      .map((entry) => path.join(SUPABASE_ROOT, entry.name))
  : [];

for (const file of seedFiles) {
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(/\borg_flags\b|\bupfront\w*/gi)) {
    report(file, source, match.index, "a seed must not mention the legal gate, let alone set it");
  }
}

// ---------------------------------------------------------------------------
// Rule 5 — the environment example carries no upfront switch.
//
// The gate is a per-org database row set by a named platform admin with a
// sign-off reference. An environment variable that looked like it could open it
// would be an invitation to open it in a deploy config, unattributed and
// unaudited.
// ---------------------------------------------------------------------------

if (fs.existsSync(ENV_EXAMPLE)) {
  const source = fs.readFileSync(ENV_EXAMPLE, "utf8");
  for (const match of source.matchAll(/UPFRONT/gi)) {
    report(
      ENV_EXAMPLE,
      source,
      match.index,
      "the legal gate is a database row set by a platform admin, never an environment key",
    );
  }
}

// ---------------------------------------------------------------------------
// Rule 6 — the fee layer never holds the service-role key.
//
// This deliberately overlaps `verify-source-gates.mjs`, whose allow-list a
// future lane may widen for its own reasons. Written as an import-statement
// regex rather than a substring search, because two files in this directory
// explain the rule in prose and a blunt grep would ban documenting the
// constraint it enforces.
// ---------------------------------------------------------------------------

const ADMIN_IMPORT = /(?:import|export)[^;]*?from\s*["']@\/lib\/supabase\/admin["']|\bimport\s*\(\s*["']@\/lib\/supabase\/admin["']\s*\)/g;
const feeLibFiles = walk(FEE_LIB_ROOT);

for (const file of [...feeLibFiles, ...routeFiles]) {
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(ADMIN_IMPORT)) {
    report(
      file,
      source,
      match.index,
      "the fee layer reads and writes through the RLS-bound client only",
    );
  }
}

// ---------------------------------------------------------------------------

console.log(
  `fee legal gate scanned ${routeFiles.length} route file(s), ` +
    `${feeLibFiles.length} fee module(s), ${migrationFiles.length} migration(s), ` +
    `${seedFiles.length} seed file(s)`,
);

if (findings.length > 0) {
  for (const finding of findings) console.error(finding);
  console.error(`fee legal gate failed with ${findings.length} finding(s)`);
  process.exit(1);
}
console.log("fee legal gate passed with 0 findings");
