import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { stripComments } from "@/lib/testing/strip-comments";

const operator = readFileSync(
  new URL("./operator.tsx", import.meta.url),
  "utf8",
);
const fixtures = readFileSync(
  new URL("../../lib/demo/feedback-fixtures.ts", import.meta.url),
  "utf8",
);

/**
 * Everything the fixture module exports as data or as a derivation over data.
 * Read out of the module at test time rather than written down here, because
 * the failure this guards against is precisely a list that was correct on the
 * day it was written: a new fixture rollup added later would be invisible to a
 * transcribed set, which is the shape of regression rounds 4 and 5 kept finding.
 *
 * Formatters are excluded by their `format` prefix — they take a number and
 * return a string and carry no fixture data with them, so the durable render
 * uses them on purpose.
 */
function fixtureDataExports(): string[] {
  const names = new Set<string>();
  for (const [, name] of fixtures.matchAll(/^export const ([A-Za-z0-9_]+)/gm)) {
    names.add(name);
  }
  for (const [, name] of fixtures.matchAll(/^export function ([A-Za-z0-9_]+)/gm)) {
    if (!name.startsWith("format")) names.add(name);
  }
  return [...names];
}

/**
 * Fixture data does not reach the Dashboard under its own name. It arrives
 * through a local — `const homeMetrics = deriveOperatorHomeMetrics(...)` — and
 * an earlier version of this guard, which checked only for the exported names,
 * passed happily while the durable render read `homeMetrics.activeClients`.
 * That is the exact failure mode rounds 4 and 5 kept finding: the class was
 * right and the enumeration standing in for it was not.
 *
 * So the taint is followed instead. Any binding whose declaration line mentions
 * a tainted name is itself tainted, repeated to a fixpoint, which walks
 * `DEMO_CLIENTS` → `clients` and `deriveOperatorHomeMetrics` → `homeMetrics`
 * without any of those three hops being written down here.
 */
// Names that read durable sources, not fixtures: the tracker fetch and the
// fee-ledger sum fetched from /api/fees for Cash Collected.
const DURABLE_READS = ["trackerClients", "collectedCents", "setCollectedCents"] as const;

function fixtureTaintedNames(): string[] {
  const tainted = new Set(fixtureDataExports());
  // A declaration and everything up to the next one, so a name is tainted by
  // its whole initialiser rather than only by the line the `=` sits on. That
  // matters: `const [feeRows] = useState(...)` names its fixture two lines
  // down, and `const feeMetrics = (() => { ... })()` names it inside a body.
  const declaration = /^( {0,6})(?:const|let)\s+(?:\[([^\]]+)\]|\{([^}]+)\}|([A-Za-z0-9_]+))/gm;
  const blocks: Array<{ names: string[]; text: string }> = [];
  const matches = [...operator.matchAll(declaration)];

  matches.forEach((match, index) => {
    const names = (match[2] ?? match[3] ?? match[4] ?? "")
      .split(",")
      .map((part) => part.replace(/[^A-Za-z0-9_].*$/, "").trim())
      .filter(Boolean);
    const from = match.index ?? 0;
    const indent = (match[1] ?? "").length;
    // The block runs to the next declaration at the same nesting or shallower,
    // so an initialiser that opens a scope of its own — `const feeMetrics =
    // (() => { ... })()` — keeps the body that names its fixture.
    const next = matches
      .slice(index + 1)
      .find((candidate) => (candidate[1] ?? "").length <= indent);
    const to = next?.index ?? operator.length;
    blocks.push({ names, text: operator.slice(from, to) });
  });

  for (let pass = 0; pass < 16; pass += 1) {
    const before = tainted.size;
    for (const block of blocks) {
      if (block.names.every((name) => tainted.has(name))) continue;
      const mentions = [...tainted].some((name) =>
        new RegExp(`(?<![.\\w])${name}\\b`).test(block.text),
      );
      if (mentions) for (const name of block.names) tainted.add(name);
    }
    if (tainted.size === before) break;
  }

  // The durable read itself is not fixture data — it is what the render is
  // supposed to use, and the test below pins that. It picks up taint only
  // because its filter arguments read fixture-backed UI state (the stage and
  // team dropdowns), which says nothing about where its rows come from.
  for (const name of DURABLE_READS) tainted.delete(name);

  return [...tainted];
}

function durableDashboardSource(): string {
  const start = operator.indexOf("function renderDurableHome(");
  assert.ok(start >= 0, "renderDurableHome is gone — the durable Dashboard was removed or renamed");
  const end = operator.indexOf("\n  function renderHome()", start);
  assert.ok(end > start, "could not find the end of renderDurableHome");
  return operator.slice(start, end);
}

describe("operator Dashboard reads the workspace when the tracker is on", () => {
  /**
   * The defect: with FEATURE_REAL_AUTH on, the first screen after sign-in
   * reported 196 active clients and $2.55M funded from fixtures while the
   * Clients badge beside it read the durable 4. A real login is what turns that
   * from a labelled simulation into a screen that misstates the system, so no
   * fixture datum may appear in the durable render at all.
   */
  it("names no fixture datum in the durable render", () => {
    const source = durableDashboardSource();
    // Prose is stripped first — comments, JSX text and string literals. The
    // render legitimately contains the word "funded" as a stage id, "clients"
    // in the button that navigates to the Clients view, and "attention" in the
    // panel title, and none of the three is a data reference.
    const code = stripComments(source)
      .replace(/>[^<>{}]*</g, "><")
      .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '""');

    // Names the render binds itself are its own, whatever they are called
    // elsewhere in the file.
    const local = new Set<string>();
    for (const [, name] of code.matchAll(/(?:const|let)\s+([A-Za-z0-9_]+)/g)) local.add(name);
    for (const [, name] of code.matchAll(/[(,]\s*([A-Za-z0-9_]+)\s*[),]\s*=>/g)) local.add(name);
    for (const [, name] of code.matchAll(/\{\s*([A-Za-z0-9_,\s]+)\}\s*\)?\s*=>/g)) {
      for (const part of name.split(",")) local.add(part.trim());
    }

    const leaked = fixtureTaintedNames()
      .filter((name) => !local.has(name))
      // Bare references only. `trackerClients.clients` is the durable read; the
      // module-scope fixture array happens to share the property name.
      .filter((name) => new RegExp(`(?<![.\\w])${name}\\b`).test(code));

    assert.deepEqual(
      leaked,
      [],
      `the durable operator Dashboard references fixture data: ${leaked.join(", ")}`,
    );
  });

  it("derives its rollups from the tracker read", () => {
    const source = durableDashboardSource();
    assert.match(source, new RegExp(`${DURABLE_READS[0]}\\.clients`));
    assert.match(operator, /deriveDurableHomeMetrics\(\s*trackerClients\.clients/);
  });

  /**
   * The choice must be made from the server-supplied flag, not from the fetch
   * result, or the fixture numbers paint first and are swapped a moment later —
   * a visible 196 → 4 flash that is worse than either state alone.
   */
  it("chooses the durable branch from the server flag, before the fetch resolves", () => {
    const start = operator.indexOf("\n  function renderHome()");
    const flag = operator.indexOf("if (trackerEnabled)", start);
    const fixtureUse = operator.indexOf("homeMetrics.activeClients", start);
    assert.ok(flag > start, "renderHome no longer branches on trackerEnabled");
    assert.ok(
      fixtureUse > flag,
      "renderHome reaches fixture metrics before consulting trackerEnabled",
    );
  });

  it("passes the tracker flag down from the server page", () => {
    const page = readFileSync(
      new URL("../../app/(surfaces)/operator/page.tsx", import.meta.url),
      "utf8",
    );
    assert.match(page, /featureFlag\("FEATURE_TRACKER"\)/);
    assert.match(page, /trackerEnabled=\{trackerEnabled\}/);
  });
});
