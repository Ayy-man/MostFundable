/**
 * The static half of the ZDR-transport property (contract rail 2).
 *
 * Every model call in this product goes through `src/lib/llm/chat-transport.ts`, which sends
 * `provider: { zdr: true, data_collection: "deny" }` to OpenRouter, and — for anything a person
 * will read — through the pipeline in `src/lib/kb/chat-driver.ts`, which runs candidate →
 * compliance-code scan → citation-belongs check → supervisor review before returning an answer.
 * Neither of those is a convention somebody remembers. They are the only path that exists.
 *
 * The Vercel AI SDK is a second path. `useChat` posts to its own `/api/chat` route, `streamText`
 * opens its own provider connection, and neither knows anything about ZDR headers, the supervisor,
 * or the eval-gated prompt registry. Adopting AI Elements makes this a live risk rather than a
 * theoretical one, because every component in that registry is written against the SDK and the
 * registry's own install step pulls it in: running `shadcn add` against five AI Elements added
 * `ai` and `streamdown` to `package.json` before anybody typed a line of code. That is the
 * accident this file exists to fail on.
 *
 * Four rules:
 *
 *   1. No SDK dependency  — neither `package.json` nor the lockfile's own top-level dependency
 *                           list may name `ai` or an `@ai-sdk/*` package.
 *   2. No SDK import      — nothing under `web/src` may import from `ai` or `@ai-sdk/*`, by static
 *                           import, `export … from`, dynamic `import()` or `require()`.
 *   3. No SDK entry point — no call to `useChat(`, `streamText(`, `generateText(`, `streamObject(`
 *                           or `generateObject(`, whatever they were imported from. A local
 *                           re-implementation under one of those names is the same second path
 *                           with the dependency filed off.
 *   4. No `/api/chat`     — no route directory named `chat` under `web/src/app/api`, because that
 *                           is the endpoint `useChat` defaults to and the one a copied example
 *                           will reach for.
 *
 * `--self-test` plants one violation of each rule in a temporary tree and fails unless all four
 * are caught. Without it a scanner that quietly stopped matching anything would report a clean
 * tree forever, which is worse than no scanner: a green check with nothing behind it.
 *
 * Written in the shape of `verify-no-auto-send.mjs`, deliberately — same comment-and-string
 * stripping, same self-test-before-scan order, same `file:line` output — so that the two read as
 * one pair of rails rather than two people's habits.
 *
 * This file edits nothing and reads nothing outside the repository.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { stripComments, stripCommentsAndStrings } from "../src/lib/testing/strip-comments.ts";

const WEB_ROOT = path.resolve(import.meta.dirname, "..");

/**
 * The banned specifiers.
 *
 * `ai` is matched exactly and `@ai-sdk/` by prefix. A deep import (`ai/react`) is caught by the
 * same exact-or-slash test, which is why the check is not a bare `startsWith("ai")` — that would
 * also flag `airtable`, and a scanner with false positives gets switched off.
 */
const BANNED_PACKAGES = [
  { name: "ai", test: (specifier) => specifier === "ai" || specifier.startsWith("ai/") },
  { name: "@ai-sdk/*", test: (specifier) => specifier.startsWith("@ai-sdk/") },
];

/** Rule 3's vocabulary. Bare-word calls, so `chat.streamText()` on our own object is not a hit. */
const ENTRY_POINTS = [
  { name: "useChat", pattern: /(?<![.\w])useChat\s*\(/ },
  { name: "streamText", pattern: /(?<![.\w])streamText\s*\(/ },
  { name: "generateText", pattern: /(?<![.\w])generateText\s*\(/ },
  { name: "streamObject", pattern: /(?<![.\w])streamObject\s*\(/ },
  { name: "generateObject", pattern: /(?<![.\w])generateObject\s*\(/ },
];

/** Rule 4's segment. */
const FORBIDDEN_SEGMENT = /^chat$/;

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

function collectFiles(root, predicate) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(absolute, predicate));
    else if (predicate(absolute)) files.push(absolute);
  }
  return files;
}

function collectDirectories(root) {
  if (!fs.existsSync(root)) return [];
  const directories = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const absolute = path.join(root, entry.name);
    directories.push(absolute, ...collectDirectories(absolute));
  }
  return directories;
}

const isSource = (file) => /\.(ts|tsx|mts|cts|js|jsx|mjs)$/.test(file);

/**
 * Both strips come from `src/lib/testing/strip-comments.ts`, and this file is why that module has
 * two entry points rather than one.
 *
 * Rule 3 needs `stripCommentsAndStrings`, or the scanner reads its own documentation as a
 * violation: this file names every banned entry point in prose, and so does `ai-elements/types.ts`,
 * which explains at length why the package is absent. Stating the rule is not breaking it.
 *
 * Rule 2 needs the *other* strip, and getting that wrong was the actual defect. The reasoning
 * recorded here was that a specifier is a string, so blanking strings would hide every real
 * import — true, and it does not follow that the right input is raw text. Raw text also contains
 * the comments, and a comment naming a banned package is exactly what a module explaining why it
 * does not use one looks like. `stripComments` is the answer to both halves at once: comments
 * gone, string bodies intact, so every real specifier still reads and no prose does.
 *
 * Both preserve length by replacing each stripped character with a space, so `lineOf` still points
 * at the line the reader has open.
 */

function lineOf(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

function matchesIn(source, pattern) {
  const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  const hits = [];
  let match = global.exec(source);
  while (match !== null) {
    hits.push({ index: match.index, text: match[0] });
    if (match.index === global.lastIndex) global.lastIndex += 1;
    match = global.exec(source);
  }
  return hits;
}

/**
 * Every module specifier in a file, with the offset it sits at.
 *
 * Four forms, because all four resolve: `import … from "x"`, `import "x"`, `import("x")` and
 * `require("x")`. A check that only understood the first would be defeated by the exact thing a
 * developer reaches for when the first one is being linted.
 */
const SPECIFIER_PATTERNS = [
  /(?:^|[\n;])\s*(?:import|export)\s[\s\S]*?\sfrom\s*["']([^"']+)["']/g,
  /(?:^|[\n;])\s*import\s*["']([^"']+)["']/g,
  /(?<![.\w])import\s*\(\s*["']([^"']+)["']\s*\)/g,
  /(?<![.\w])require\s*\(\s*["']([^"']+)["']\s*\)/g,
];

function specifiersIn(source) {
  const found = [];
  for (const pattern of SPECIFIER_PATTERNS) {
    const global = new RegExp(pattern.source, pattern.flags);
    let match = global.exec(source);
    while (match !== null) {
      found.push({ specifier: match[1], index: match.index });
      match = global.exec(source);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------------------------
// The scan
// ---------------------------------------------------------------------------------------------

/**
 * @param {{ webRoot: string }} roots
 * @returns {{ findings: Array, fileCount: number }}
 */
function scan(roots) {
  const srcRoot = path.join(roots.webRoot, "src");
  const appRoot = path.join(srcRoot, "app");
  const findings = [];
  const relative = (file) => path.relative(roots.webRoot, file).split(path.sep).join("/");
  const record = (rule, file, line, detail) => findings.push({ rule, file: relative(file), line, detail });

  // -- Rule 1: no SDK dependency ---------------------------------------------------------------
  //
  // Both files, because they fail apart: `npm install` writes the lockfile first, and a
  // hand-edited `package.json` with a stale lock is exactly the state a half-reverted CLI run
  // leaves behind.
  const manifestPath = path.join(roots.webRoot, "package.json");
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      for (const name of Object.keys(manifest[field] ?? {})) {
        const banned = BANNED_PACKAGES.find((entry) => entry.test(name));
        if (banned) record("sdk-dependency", manifestPath, 1, `${field} names ${name}`);
      }
    }
  }
  const lockPath = path.join(roots.webRoot, "package-lock.json");
  if (fs.existsSync(lockPath)) {
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    // The root package's own declared dependencies, not the whole resolved tree: something deep
    // in the graph may legitimately depend on a package we must not import ourselves.
    const root = lock.packages?.[""] ?? {};
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      for (const name of Object.keys(root[field] ?? {})) {
        const banned = BANNED_PACKAGES.find((entry) => entry.test(name));
        if (banned) record("sdk-dependency", lockPath, 1, `the lockfile root names ${name}`);
      }
    }
  }

  // -- Rules 2 and 3 ---------------------------------------------------------------------------
  const sourceFiles = collectFiles(srcRoot, isSource);
  for (const file of sourceFiles) {
    const source = fs.readFileSync(file, "utf8");
    const code = stripCommentsAndStrings(source);
    const imports = stripComments(source);

    for (const { specifier, index } of specifiersIn(imports)) {
      const banned = BANNED_PACKAGES.find((entry) => entry.test(specifier));
      if (banned) {
        record("sdk-import", file, lineOf(source, index), `imports from ${specifier}`);
      }
    }

    for (const { name, pattern } of ENTRY_POINTS) {
      for (const hit of matchesIn(code, pattern)) {
        record("sdk-entry-point", file, lineOf(source, hit.index), `calls ${name}`);
      }
    }
  }

  // -- Rule 4: no /api/chat --------------------------------------------------------------------
  for (const directory of collectDirectories(path.join(appRoot, "api"))) {
    if (FORBIDDEN_SEGMENT.test(path.basename(directory))) {
      record("chat-route", directory, 1, "the SDK's default endpoint could live here");
    }
  }

  return { findings, fileCount: sourceFiles.length };
}

// ---------------------------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------------------------

/**
 * Plant one violation of each rule in a temporary tree and require the scan to catch all four.
 *
 * The tree mirrors the real layout closely enough that the same `scan()` runs over it unchanged —
 * a self-test against a different code path would prove nothing about the scan that runs in CI.
 */
function runSelfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-transport-selftest-"));
  try {
    const write = (relativePath, contents) => {
      const absolute = path.join(root, relativePath);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, contents);
    };

    // 1. The dependency, in both files.
    write("web/package.json", JSON.stringify({ dependencies: { ai: "^7.0.0", react: "19.2.4" } }));
    write(
      "web/package-lock.json",
      JSON.stringify({ packages: { "": { dependencies: { "@ai-sdk/openai": "^2.0.0" } } } }),
    );

    // 2. Imports, in all four forms one file at a time.
    write("web/src/lib/a.ts", 'import { streamText as s } from "ai";\nexport default s;\n');
    write("web/src/lib/b.ts", 'import "@ai-sdk/openai";\n');
    write("web/src/lib/c.ts", 'export const load = () => import("ai/react");\n');
    write("web/src/lib/d.ts", 'const sdk = require("@ai-sdk/anthropic");\nexport default sdk;\n');

    // 3. An entry point with no import at all — the local re-implementation case.
    write("web/src/lib/e.ts", "function useChat() { return null; }\nexport const x = useChat();\n");

    // 4. The route segment.
    write("web/src/app/api/chat/route.ts", "export function POST() { return null; }\n");

    // And the files that must NOT be flagged: prose naming every banned thing, which is what the
    // real `ai-elements/types.ts` and this scanner's own header do. If stripping ever breaks,
    // the gate fails on a clean tree and somebody deletes the explanation to quiet it.
    write(
      "web/src/lib/clean.ts",
      "// Do not call streamText( or useChat( here, and never import from 'ai'.\n" +
        'export const note = "streamText( and useChat( are banned; see @ai-sdk/openai";\n',
    );

    // The same direction for rule 2 specifically, one comment form per file, because `clean.ts`
    // above happened to phrase its prose in the one shape the specifier patterns cannot match and
    // so proved nothing about them. Every form here was watched failing before the rule read
    // stripped text: a comment is not an import, however exactly it quotes one.
    write("web/src/lib/prose-a.ts", 'import { z } from "zod";\n// import { streamText } from "ai";\nexport const a = z;\n');
    write("web/src/lib/prose-b.ts", 'import { z } from "zod";\n/*\nimport { streamText } from "ai";\n*/\nexport const b = z;\n');
    write("web/src/lib/prose-c.ts", '// this module must never reach for import("ai") or require("@ai-sdk/openai")\nexport const c = 1;\n');
    write(
      "web/src/lib/prose-d.ts",
      '/**\n * Components, not transport: we vendor the AI Elements source, and\n * import { streamText } from "ai" is precisely what we do not do.\n */\nexport const d = 1;\n',
    );

    const { findings } = scan({ webRoot: path.join(root, "web") });
    const rules = new Set(findings.map((finding) => finding.rule));

    for (const rule of ["sdk-dependency", "sdk-import", "sdk-entry-point", "chat-route"]) {
      assert.ok(rules.has(rule), `self-test: the scan missed the planted ${rule} violation`);
    }

    // Each import form on its own, so a regex that quietly stopped matching one is caught.
    for (const file of ["src/lib/a.ts", "src/lib/b.ts", "src/lib/c.ts", "src/lib/d.ts"]) {
      assert.ok(
        findings.some((finding) => finding.rule === "sdk-import" && finding.file === file),
        `self-test: the ${file} import form was not caught`,
      );
    }
    assert.ok(
      findings.some((finding) => finding.rule === "sdk-entry-point" && finding.file === "src/lib/e.ts"),
      "self-test: a local re-implementation of an SDK entry point was not caught",
    );
    assert.ok(
      findings.some((finding) => finding.rule === "sdk-dependency" && finding.file === "package.json"),
      "self-test: the manifest dependency was not caught",
    );
    assert.ok(
      findings.some((finding) => finding.rule === "sdk-dependency" && finding.file === "package-lock.json"),
      "self-test: the lockfile dependency was not caught",
    );
    // The other direction: prose about the rule is not a breach of it.
    assert.equal(
      findings.filter((finding) => finding.file === "src/lib/clean.ts").length,
      0,
      "self-test: a file that only talks about the banned vocabulary was flagged",
    );
    for (const file of ["src/lib/prose-a.ts", "src/lib/prose-b.ts", "src/lib/prose-c.ts", "src/lib/prose-d.ts"]) {
      assert.equal(
        findings.filter((finding) => finding.file === file).length,
        0,
        `self-test: a comment quoting a banned import was read as one in ${file}`,
      );
    }

    return findings.length;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

const RULE_COUNT = 4;

try {
  const selfTestFindings = runSelfTest();

  if (process.argv.includes("--self-test")) {
    console.log(
      `AI-transport scanner self-test passed: ${RULE_COUNT} rules, ${selfTestFindings} planted findings caught.`,
    );
  } else {
    const result = scan({ webRoot: WEB_ROOT });
    if (result.findings.length > 0) {
      for (const finding of result.findings) {
        console.error(`${finding.file}:${finding.line} — ${finding.rule} — ${finding.detail}`);
      }
      throw new Error(`${result.findings.length} ungoverned model-call path(s) found.`);
    }
    console.log(
      `AI-transport scan passed: ${result.fileCount} files, ${RULE_COUNT} rules, 0 findings; ` +
        `self-test ${selfTestFindings} findings.`,
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
