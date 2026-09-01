#!/usr/bin/env node
// verify-demo-script.mjs — keep MILESTONE2-DEMO.md honest as the code moves.
//
// The demo script is the one document somebody reads out loud in front of the client, under time
// pressure, without checking anything first. Every other document in this repository can be a little
// stale for a week and nobody is harmed. This one names commands to type and routes to hit, so a
// renamed npm script or a moved route turns into dead air on camera.
//
// So the file is checked against the code rather than reviewed. Five gates:
//
//   1. Every `npm run <name>` it mentions exists in `web/package.json`.
//   2. Every `/api/...` path it names resolves to a real handler under `web/src/app/api`,
//      with `[param]` segments matched against whatever the document wrote in their place.
//   3. Every `FEATURE_*` and `*_DRIVER` name it uses appears in `web/src/lib/env.ts`.
//   4. No forbidden vocabulary anywhere in the file. `verify-compliance-copy.mjs` also covers this
//      file once it is a scan root, and that duplication is deliberate: this gate is the one a person
//      runs while editing the document, and it should fail before the slower one does.
//   5. No credential-shaped value. The document is supposed to carry key *names* and read every value
//      from stdin; a pasted token is the failure this catches.
//
// Node built-ins only, matching every other verifier in this directory. No new dependency.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = resolve(SCRIPT_DIR, "..");
const REPO_DIR = resolve(WEB_DIR, "..");

// The document under test is overridable so the self-test can run this same code against a mutated
// copy in a temporary directory. Nothing else about the run changes: the same package.json, the same
// route tree and the same env module are the ground truth either way, which is what makes the
// self-test meaningful rather than circular.
const DOC_PATH = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : join(REPO_DIR, "MILESTONE2-DEMO.md");

const PACKAGE_JSON_PATH = join(WEB_DIR, "package.json");
const API_DIR = join(WEB_DIR, "src", "app", "api");
const ENV_MODULE_PATH = join(WEB_DIR, "src", "lib", "env.ts");

// ---------------------------------------------------------------------------------------------
// Forbidden vocabulary
// ---------------------------------------------------------------------------------------------
//
// The regulated-category words. These are spelled out here rather than imported from
// `verify-compliance-copy.mjs`, because that module carries its own exception machinery and a
// shared import would let a broadening of its allow-list silently loosen this gate too. Two
// independent lists that agree is the property worth having.
//
// `\b609\b` is bounded on both sides so a dollar amount or a line number does not trip it. The
// score-gain and odds patterns match the *claim shape* rather than a phrase, because the harm is in
// promising a number, whatever words surround it.
const FORBIDDEN = [
  { id: "F01", label: "dispute language", pattern: /\bdisput(e|es|ed|ing)\b/i },
  { id: "F02", label: "section 609", pattern: /(?<![$\d.])\b609\b(?![\d.])/ },
  { id: "F03", label: "pay-for-delete", pattern: /\bpay[\s-]?for[\s-]?delete\b/i },
  { id: "F04", label: "credit repair", pattern: /\bcredit[\s-]repair\b/i },
  { id: "F05", label: "goodwill letter", pattern: /\bgoodwill\b/i },
  { id: "F06", label: "tradeline removal", pattern: /\bremov(e|es|ed|al|als|ing)\b/i },
  { id: "F07", label: "promised score gain", pattern: /[+＋]\s?\d+\s?(pts?|points?)\b/i },
  { id: "F08", label: "approval-odds percentage", pattern: /\bapprov(al|ed)[\s-](odds|chance|chances|probability)\b/i },
  { id: "F09", label: "deletion of a bureau item", pattern: /\bdelet(e|es|ed|ion|ing)\b[^.\n]{0,40}\b(item|items|account|accounts|tradeline|tradelines|record|records)\b/i },
];

// ---------------------------------------------------------------------------------------------
// Credential shapes
// ---------------------------------------------------------------------------------------------
//
// Not an attempt at general secret detection — that belongs in a scanner, not a document gate. These
// are the five shapes this project actually handles, so a copy-paste accident while writing the Arm B
// section lands on one of them. A Supabase personal access token, a JWT (the anon and service-role
// keys are both JWTs), a Stripe key, an OpenRouter key, and a Postgres URI carrying a password.
const CREDENTIAL_SHAPES = [
  { id: "S01", label: "Supabase personal access token", pattern: /\bsbp_[A-Za-z0-9]{20,}/ },
  { id: "S02", label: "Supabase publishable or secret key", pattern: /\bsb_(publishable|secret)_[A-Za-z0-9_-]{16,}/ },
  { id: "S03", label: "JSON Web Token", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { id: "S04", label: "Stripe key", pattern: /\b(sk|pk|rk)_(test|live)_[A-Za-z0-9]{16,}/ },
  { id: "S05", label: "OpenRouter key", pattern: /\bsk-or-v1-[A-Za-z0-9]{16,}/ },
  { id: "S06", label: "Postgres URI with a password", pattern: /\bpostgres(ql)?:\/\/[^\s:@/]+:[^\s@/]+@/ },
];

// ---------------------------------------------------------------------------------------------
// Reading the document
// ---------------------------------------------------------------------------------------------

/**
 * Fenced code blocks are read for commands and routes but excluded from the vocabulary scan, because
 * a shell command is not client-facing copy. Nothing in the current document needs that exemption;
 * it exists so that a future beat which has to `curl` an awkwardly-named endpoint does not force the
 * author to choose between an accurate command and a green gate.
 */
function splitFences(text) {
  const lines = text.split("\n");
  const prose = [];
  const code = [];
  let inFence = false;
  for (const [index, line] of lines.entries()) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    (inFence ? code : prose).push({ number: index + 1, text: line });
  }
  return { prose, code, all: lines.map((text, i) => ({ number: i + 1, text })) };
}

// ---------------------------------------------------------------------------------------------
// Ground truth
// ---------------------------------------------------------------------------------------------

function packageScripts() {
  const parsed = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8"));
  return new Set(Object.keys(parsed.scripts ?? {}));
}

/** Every route handler under `web/src/app/api`, as segment arrays. `[id]` stays as written. */
function routeSegments() {
  const routes = [];
  const walk = (dir, segments) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full, [...segments, entry]);
      } else if (/^route\.(ts|tsx|js|mjs)$/.test(entry)) {
        routes.push(segments);
      }
    }
  };
  walk(API_DIR, []);
  return routes;
}

/**
 * A documented path matches a route when the segment counts agree and every segment either matches
 * literally or sits opposite a `[param]`. That is what lets the document write
 * `/api/enrollments/<id>/idv` while the tree holds `enrollments/[id]/idv` — and it still catches a
 * genuinely wrong path, because `/api/enrollment/<id>/idv` fails on the first segment.
 */
function routeExists(documented, routes) {
  return routes.some(
    (segments) =>
      segments.length === documented.length &&
      segments.every((segment, i) => /^\[.+\]$/.test(segment) || segment === documented[i]),
  );
}

function envNames() {
  const source = readFileSync(ENV_MODULE_PATH, "utf8");
  return new Set(source.match(/\b(FEATURE_[A-Z0-9_]+|[A-Z0-9_]*DRIVER)\b/g) ?? []);
}

// ---------------------------------------------------------------------------------------------
// The gates
// ---------------------------------------------------------------------------------------------

function verify(docPath) {
  const findings = [];
  const counts = { commands: 0, routes: 0, envNames: 0, lines: 0 };

  let text;
  try {
    text = readFileSync(docPath, "utf8");
  } catch {
    return {
      findings: [{ line: 0, message: `cannot read ${docPath}` }],
      counts,
    };
  }

  const { prose, all } = splitFences(text);
  counts.lines = all.length;

  const scripts = packageScripts();
  const routes = routeSegments();
  const known = envNames();

  const seenCommands = new Set();
  const seenRoutes = new Set();
  const seenEnv = new Set();

  for (const { number, text: line } of all) {
    for (const match of line.matchAll(/\bnpm run ([a-z0-9:_-]+)/g)) {
      const name = match[1];
      seenCommands.add(name);
      if (!scripts.has(name)) {
        findings.push({ line: number, message: `\`npm run ${name}\` is not a script in web/package.json` });
      }
    }

    // Trailing punctuation and a closing backtick are stripped so `/api/enroll`. and `/api/enroll`,
    // both resolve; a trailing slash is dropped for the same reason.
    for (const match of line.matchAll(/\/api\/[A-Za-z0-9[\]<>:_-]+(?:\/[A-Za-z0-9[\]<>:_-]+)*/g)) {
      const raw = match[0].replace(/[.,;:)`]+$/, "").replace(/\/$/, "");
      seenRoutes.add(raw);
      const documented = raw.split("/").filter(Boolean).slice(1);
      if (documented.length === 0) continue;
      if (!routeExists(documented, routes)) {
        findings.push({ line: number, message: `${raw} has no handler under web/src/app/api` });
      }
    }

    for (const match of line.matchAll(/\b(FEATURE_[A-Z0-9_]+|[A-Z0-9_]*DRIVER)\b/g)) {
      const name = match[1];
      seenEnv.add(name);
      if (!known.has(name)) {
        findings.push({ line: number, message: `${name} does not appear in web/src/lib/env.ts` });
      }
    }

    for (const shape of CREDENTIAL_SHAPES) {
      if (shape.pattern.test(line)) {
        findings.push({ line: number, message: `[${shape.id}] ${shape.label} — this document carries key names only` });
      }
    }
  }

  for (const { number, text: line } of prose) {
    for (const term of FORBIDDEN) {
      if (term.pattern.test(line)) {
        findings.push({ line: number, message: `[${term.id}] forbidden vocabulary: ${term.label}` });
      }
    }
  }

  counts.commands = seenCommands.size;
  counts.routes = seenRoutes.size;
  counts.envNames = seenEnv.size;
  return { findings, counts };
}

// ---------------------------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------------------------
//
// Three mutations, one per gate that can plausibly rot, run against a copy in the OS temp directory
// and deleted immediately. A gate nobody has watched fail is a gate nobody should trust, and the
// alternative — trusting that the regexes are right because they look right — is how a document gate
// ends up passing on an empty file.

async function selfTest() {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");

  const original = readFileSync(DOC_PATH, "utf8");
  const dir = mkdtempSync(join(tmpdir(), "verify-demo-script-"));
  const mutantPath = join(dir, "MILESTONE2-DEMO.md");

  const mutations = [
    { label: "a command that does not exist", body: `${original}\n\nRun \`npm run demo:resett\` first.\n` },
    { label: "a route that does not exist", body: `${original}\n\nThen call /api/enrolment/status.\n` },
    { label: "an unknown feature flag", body: `${original}\n\nSet FEATURE_TRACKR before you start.\n` },
    { label: "forbidden vocabulary", body: `${original}\n\nWe help clients with credit repair.\n` },
    { label: "a pasted credential", body: `${original}\n\nUse sk_test_${"A1b2C3d4E5f6G7h8"} for billing.\n` },
  ];

  let failures = 0;
  try {
    for (const mutation of mutations) {
      writeFileSync(mutantPath, mutation.body);
      const { findings } = verify(mutantPath);
      const caught = findings.length > 0;
      console.log(`  self-test: ${mutation.label} -> ${caught ? "caught" : "MISSED"}`);
      if (!caught) failures += 1;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------

const { findings, counts } = verify(DOC_PATH);
const selfTestFailures = await selfTest();

for (const finding of findings) {
  console.error(`MILESTONE2-DEMO.md:${finding.line} ${finding.message}`);
}

if (findings.length > 0 || selfTestFailures > 0) {
  console.error(
    `demo script gate FAILED: ${findings.length} finding(s), ${selfTestFailures} self-test miss(es)`,
  );
  process.exit(1);
}

console.log(
  `demo script gate passed: ${counts.lines} lines, ${counts.commands} npm command(s), ` +
    `${counts.routes} route path(s), ${counts.envNames} env name(s), 5 self-test mutations all caught`,
);
