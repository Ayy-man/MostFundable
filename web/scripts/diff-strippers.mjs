#!/usr/bin/env node

/**
 * Differential between two comment-stripper implementations, over the real tree.
 *
 * F-34's tool. Two scanners were written to F-24 in parallel — this repo's shared module and lane
 * 4b's at `57bd897` — and they disagreed on 43 files. The lesson recorded there is that once two
 * implementations of one rule exist neither is authoritative, and only a differential over real
 * files tells you which text each one keeps. A sentence saying "43 files disagreed and we fixed
 * it" is not re-runnable; this is.
 *
 * So it takes two module paths rather than hard-coding either side, and it can be pointed at any
 * future pair — an extraction against its original, a rewrite against what it replaces, or the
 * shared module against a lane's local copy that nobody noticed.
 *
 *   node scripts/diff-strippers.mjs <baseline.(ts|mjs)> [candidate.(ts|mjs)]
 *
 * `candidate` defaults to `src/lib/testing/strip-comments.ts`. Each module must export
 * `stripComments`, and both entry points are compared when both modules export
 * `stripCommentsAndStrings` too — a differential over half a module's surface reports a zero that
 * reads like a fact about the module, which is how this tool missed a five-file change once.
 * Comparison normalises whitespace, so the two implementations' different padding
 * (one blanks in place, one rebuilds the string) is not counted as a disagreement — only the text
 * that survives is compared, which is the thing a guard actually reads.
 *
 * Exit 0 when the two keep identical text everywhere, 1 otherwise, so it can gate.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, never URL.pathname: this repository's real path contains a space (F-26).
const WEB_ROOT = fileURLToPath(new URL("../", import.meta.url));
const ROOTS = ["src", "scripts"];
const EXTENSIONS = /\.(ts|tsx|mjs|mts|cts)$/;
const PRUNED = new Set(["node_modules", ".next"]);

/** The shape of a disagreement, so the report says what kind of construct caused it. */
const SHAPES = [
  ["regex literal", /\/(?![/*])(?:\\.|\[(?:\\.|[^\]])*\]|[^/\n\\])+\/[gimsuyd]*/],
  ["template literal", /`/],
  ["trailing comment after code", /\S[ \t]+\/\//],
  ["SQL `--`", /--/],
  ["block comment", /\/\*/],
  ["line comment", /\/\//],
];

function walk(directory, files = []) {
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!PRUNED.has(entry.name)) walk(path.join(directory, entry.name), files);
      continue;
    }
    if (entry.isFile() && EXTENSIONS.test(entry.name)) files.push(path.join(directory, entry.name));
  }
  return files;
}

const normalise = (text) => text.replace(/\s+/g, " ").trim();

/** The first raw line whose surviving text differs, which is what a reader needs to see. */
function firstDivergentLine(raw, a, b) {
  const rawLines = raw.split("\n");
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  for (let i = 0; i < rawLines.length; i += 1) {
    if (normalise(aLines[i] ?? "") === normalise(bLines[i] ?? "")) continue;
    return { line: i + 1, raw: rawLines[i], a: aLines[i] ?? "", b: bLines[i] ?? "" };
  }
  return null;
}

function shapeOf(rawLine) {
  for (const [name, pattern] of SHAPES) if (pattern.test(rawLine)) return name;
  return "unclassified";
}

const [baselineArg, candidateArg] = process.argv.slice(2);
if (!baselineArg) {
  console.error("usage: node scripts/diff-strippers.mjs <baseline> [candidate]");
  process.exit(2);
}
const resolve = (value) => (path.isAbsolute(value) ? value : path.resolve(process.cwd(), value));
const baselinePath = resolve(baselineArg);
const candidatePath = candidateArg
  ? resolve(candidateArg)
  : path.join(WEB_ROOT, "src/lib/testing/strip-comments.ts");

const baselineModule = await import(baselinePath);
const candidateModule = await import(candidatePath);

/**
 * Both entry points, because comparing one of them is how a differential lies.
 *
 * This tool reported "0 of 869" across a change that altered five production surfaces, for the
 * simple reason that it only ever called `stripComments`. The change was in the strings-blanked
 * path: a JSX closing tag opened a phantom regex, and text inside a phantom regex is left alone, so
 * the `className` string after `</dt>` escaped blanking. Nothing about the zero was wrong — it
 * answered the question asked, over half the module's surface, and read as an answer about the
 * module. A baseline that exports only `stripComments` is compared on that entry point alone.
 */
const ENTRY_POINTS = ["stripComments", "stripCommentsAndStrings"].filter(
  (name) => typeof baselineModule[name] === "function" && typeof candidateModule[name] === "function",
);

const files = ROOTS.flatMap((root) => walk(path.join(WEB_ROOT, root)));
if (files.length === 0) {
  console.error("differential scanned 0 files; the roots are missing");
  process.exit(2);
}

const divergent = [];
for (const file of files) {
  const raw = fs.readFileSync(file, "utf8");
  for (const entryPoint of ENTRY_POINTS) {
    let a;
    let b;
    try {
      a = baselineModule[entryPoint](raw);
      b = candidateModule[entryPoint](raw);
    } catch (error) {
      divergent.push({ file, entryPoint, shape: "threw", detail: String(error) });
      continue;
    }
    if (normalise(a) === normalise(b)) continue;
    const spot = firstDivergentLine(raw, a, b);
    divergent.push({
      file: path.relative(WEB_ROOT, file).split(path.sep).join("/"),
      entryPoint,
      shape: spot === null ? "whole-file" : shapeOf(spot.raw),
      line: spot?.line ?? 0,
      raw: spot?.raw.trim().slice(0, 120) ?? "",
      a: spot?.a.trim().slice(0, 120) ?? "",
      b: spot?.b.trim().slice(0, 120) ?? "",
    });
  }
}

console.log(`baseline : ${path.relative(WEB_ROOT, baselinePath)}`);
console.log(`candidate: ${path.relative(WEB_ROOT, candidatePath)}`);
console.log(`entry points compared: ${ENTRY_POINTS.join(", ")}`);
console.log(`scanned ${files.length} file(s); ${divergent.length} disagreement(s) across ${new Set(divergent.map((entry) => entry.file)).size} file(s)\n`);

const byShape = new Map();
for (const entry of divergent) byShape.set(entry.shape, (byShape.get(entry.shape) ?? 0) + 1);
for (const [shape, count] of [...byShape].sort((x, y) => y[1] - x[1])) {
  console.log(`  ${String(count).padStart(3)}  ${shape}`);
}
if (divergent.length > 0) console.log("");
for (const entry of divergent) {
  console.log(`${entry.file}:${entry.line}  [${entry.shape}]  via ${entry.entryPoint}`);
  console.log(`    raw      ${entry.raw}`);
  console.log(`    baseline ${entry.a}`);
  console.log(`    candidate${entry.b}`);
}

process.exit(divergent.length === 0 ? 0 : 1);
