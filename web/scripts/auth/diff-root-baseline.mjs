#!/usr/bin/env node
// AUTH-03: with FEATURE_REAL_AUTH unset, `/` must render exactly as it did
// before this phase touched anything.
//
// The plans spell this as
//   diff -q .next/server/app/index.html scripts/auth/baseline/root-flag-off.html
// and that literal command cannot pass. Three build artifacts move underneath
// it, none of which is a render change, and all three were measured in this
// worktree rather than assumed:
//
//   1. BUILD_ID. Next 16.2.10 mints a fresh random one on EVERY build and
//      embeds it in the flight payload. Two consecutive builds of a
//      byte-identical tree produced `cfe7ZB3C-3sQhp5figOfl` and
//      `ijZ8dIIorwtR7mI0Ggc_D` and differed in nothing else. So the literal
//      diff fails even with zero source changes.
//   2. Content-addressed chunk filenames. Adding one module to the graph
//      renames a CSS chunk without changing a byte of markup or of the
//      stylesheet.
//   3. Chunk membership. Adding a client component anywhere in the app — the
//      sign-in form, the four surface wrappers — re-splits Turbopack's shared
//      chunks, so the root page's preload <script> tags and the per-component
//      chunk lists inside the flight payload gain entries. The DOM is
//      identical; the manifest describing how to load it is not.
//
// What this comparator does instead, in two independent passes:
//
//   PASS 1 — THE DOCUMENT. Every <script> element is removed and stylesheet
//   hrefs are masked; everything else is compared byte for byte. That is the
//   whole served DOM: title, meta, every element, every class, every string.
//   A changed word, an extra div, a dropped attribute all fail here.
//
//   PASS 2 — THE FLIGHT PAYLOAD. Compared byte for byte with only the build id
//   and the chunk-membership arrays masked. Module ids, component names, props
//   and rendered text all still compare, so a new client component mounting on
//   `/` fails even though its chunk churn does not.

import { readFileSync } from "node:fs";
import path from "node:path";

const CURRENT = path.join(process.cwd(), ".next/server/app/index.html");
const BASELINE = path.join(
  process.cwd(),
  "scripts/auth/baseline/root-flag-off.html",
);

const CHUNK_PATH = /\/_next\/static\/chunks\/[A-Za-z0-9_./-]+\.(css|js)/g;
const BUILD_ID = /(\\?")b\\?":\\?"[A-Za-z0-9_-]{8,}\\?"/g;
/** `I[46798,[,,,],"TooltipProvider"]` — mask only the chunk list. */
const CLIENT_REF = /I\[(\d+),\[[^\]]*\],/g;
const SCRIPT_ELEMENT = /<script\b[^>]*>[\s\S]*?<\/script>/g;
const INLINE_FLIGHT = /self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g;
/** The preload <script> elements, as React nodes inside the flight payload. */
const FLIGHT_SCRIPT_NODE = /\[\\"\$\\",\\"script\\",\\"script-\d+\\",\{[^}]*\}\],?/g;
/** Chunk preload hints, e.g. :HL["/_next/static/chunks/<CHUNK>.js","script"]. */
const FLIGHT_PRELOAD_HINT = /:HL\[\\"\/_next\/static\/chunks\/<CHUNK>\.js\\"[^\]]*\]\\n/g;

function maskBuildArtifacts(value) {
  return value
    .replaceAll(CHUNK_PATH, "/_next/static/chunks/<CHUNK>.$1")
    .replaceAll(BUILD_ID, '$1b":"<BUILD_ID>"')
    .replaceAll(CLIENT_REF, "I[$1,[<CHUNKS>],")
    .replaceAll(FLIGHT_SCRIPT_NODE, "")
    .replaceAll(FLIGHT_PRELOAD_HINT, "");
}

/** Pass 1: the served DOM, with every script element removed. */
function documentOf(html) {
  return maskBuildArtifacts(html.replaceAll(SCRIPT_ELEMENT, ""));
}

/** Pass 2: the concatenated flight payload. */
function flightOf(html) {
  const parts = [];

  for (const match of html.matchAll(INLINE_FLIGHT)) {
    parts.push(match[1]);
  }

  return maskBuildArtifacts(parts.join("\n"));
}

function firstDifference(built, baseline) {
  let at = 0;

  while (at < built.length && built[at] === baseline[at]) {
    at += 1;
  }

  const from = Math.max(0, at - 120);

  return [
    `  first difference at normalized offset ${at}`,
    `  built:    …${built.slice(from, at + 160)}…`,
    `  baseline: …${baseline.slice(from, at + 160)}…`,
  ].join("\n");
}

const builtHtml = readFileSync(CURRENT, "utf8");
const baselineHtml = readFileSync(BASELINE, "utf8");

const passes = [
  ["document", documentOf(builtHtml), documentOf(baselineHtml)],
  ["flight payload", flightOf(builtHtml), flightOf(baselineHtml)],
];

const failures = passes.filter(([, built, baseline]) => built !== baseline);

if (failures.length > 0) {
  for (const [name, built, baseline] of failures) {
    process.stdout.write(
      `AUTH-03 FAILED: the flag-off / ${name} differs from the wave-1 baseline.\n${firstDifference(built, baseline)}\n`,
    );
  }

  process.exitCode = 1;
} else {
  const [, doc] = passes[0];
  const [, flight] = passes[1];
  process.stdout.write(
    `AUTH-03 ok: / renders identically to the wave-1 baseline ` +
      `(document ${doc.length} chars, flight payload ${flight.length} chars; ` +
      `build id and chunk membership masked)\n`,
  );
}
