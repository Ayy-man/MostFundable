import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { stripComments } from "../src/lib/testing/strip-comments.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const FORBIDDEN_CONSUMER_IMPORTS = ["tracker", "applications", "analysis", "enrollment", "support"];
const NON_KB_TABLE = /\.from\(["'](?!kb_articles\b|kb_import_runs\b|kb_import_seen\b)[a-z0-9_]+["']\)/;
const RUNTIME_PRIMITIVE = /\b(?:setInterval|setTimeout|cron|drain\w*|scheduler|after)\s*\(/i;

function runtimeKbFiles(root) {
  const kbRoot = path.join(root, "src/lib/kb");
  return fs.existsSync(kbRoot) ? fs.readdirSync(kbRoot).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts")).map((name) => path.join(kbRoot, name)) : [];
}

function routeFiles(root) {
  const routeRoot = path.join(root, "src/app/api/kb");
  if (!fs.existsSync(routeRoot)) return [];
  const output = [];
  const walk = (directory) => { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const target = path.join(directory, entry.name); if (entry.isDirectory()) walk(target); else if (entry.name === "route.ts") output.push(target); } };
  walk(routeRoot);
  return output;
}

function scan(root) {
  const findings = [];
  const kbFiles = runtimeKbFiles(root);
  const routes = routeFiles(root);
  if (kbFiles.length === 0 || routes.length === 0) findings.push("inventory: expected KB runtime and route files");

  // Comments out, strings kept. `RUNTIME_PRIMITIVE` includes `after\s*\(` and `drain\w*\s*\(`,
  // which are English before they are code: "Ranking runs after (and only after) the article set is
  // loaded" in `kb/search.ts` reported `runtime-primitive:search.ts`, reading as though the KB
  // module had grown a scheduler. Strings stay because the import rule matches on `from "…"` and
  // because an RPC or table name reaching this tree as a literal is a real breach, not a mention.
  const code = (file) => stripComments(fs.readFileSync(file, "utf8"));

  const consumerFiles = [path.join(root, "src/lib/kb/consumer.ts"), path.join(root, "src/app/api/kb/consumer/route.ts")].filter(fs.existsSync);
  for (const file of consumerFiles) {
    const source = code(file);
    for (const lane of FORBIDDEN_CONSUMER_IMPORTS) if (new RegExp(`(?:from\\s+["'][^"']*${lane}|import\\s*[({]?["'][^"']*${lane})`).test(source)) findings.push(`consumer-import:${path.basename(file)}:${lane}`);
    if (NON_KB_TABLE.test(source)) findings.push(`consumer-table:${path.basename(file)}`);
  }

  for (const file of kbFiles) {
    const source = code(file);
    if (/sendMessage/.test(source)) findings.push(`send-capability:${path.basename(file)}`);
    if (RUNTIME_PRIMITIVE.test(source)) findings.push(`runtime-primitive:${path.basename(file)}`);
  }

  for (const file of routes) {
    const source = code(file);
    const post = source.indexOf("export async function POST");
    if (post < 0) continue;
    const body = source.slice(post);
    const flag = body.indexOf('featureFlag("FEATURE_KB")');
    const lazyImport = body.indexOf("await import(");
    if (flag < 0 || (lazyImport >= 0 && flag > lazyImport)) findings.push(`route-flag-order:${path.relative(root, file)}`);
  }
  return { findings, kbFiles: kbFiles.length, routes: routes.length };
}

function selfTest() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mf-kb-boundaries-"));
  try {
    fs.mkdirSync(path.join(scratch, "src/lib/kb"), { recursive: true });
    fs.mkdirSync(path.join(scratch, "src/app/api/kb/consumer"), { recursive: true });
    fs.writeFileSync(path.join(scratch, "src/lib/kb/consumer.ts"), 'import "../tracker/index.ts"; db.from("clients");\n');
    fs.writeFileSync(path.join(scratch, "src/lib/kb/bad.ts"), 'sendMessage(); setInterval(() => {}, 1);\n');
    fs.writeFileSync(path.join(scratch, "src/app/api/kb/consumer/route.ts"), 'export async function POST(){ const x = await import("x"); return featureFlag("FEATURE_KB"); }\n');
    const result = scan(scratch);
    for (const prefix of ["consumer-import", "consumer-table", "send-capability", "runtime-primitive", "route-flag-order"]) assert.ok(result.findings.some((finding) => finding.startsWith(prefix)), `self-test missed ${prefix}`);
    process.stdout.write(`KB boundary self-test passed: ${result.findings.length} planted findings caught.\n`);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv.includes("--self-test")) selfTest();
else {
  const result = scan(ROOT);
  if (result.findings.length > 0) { for (const finding of result.findings) process.stderr.write(`${finding}\n`); process.exit(1); }
  process.stdout.write(`KB boundary scan passed: ${result.kbFiles} runtime files, ${result.routes} routes, 0 findings.\n`);
}
