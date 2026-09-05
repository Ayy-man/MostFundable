// web/src/components/consumer/plan-narrative.test.ts — the guards a rendering test cannot give.
//
// There is no DOM in this runner, so the card is pinned two ways, the same way `credit-widget`
// is: every decision it makes lives in `lib/optimization/narrative-view.ts` and is asserted
// against directly there, and the properties that are about what this SOURCE may contain are
// asserted against its text here. What matters about this component is that it derives nothing —
// a card that recomputed a number could contradict the checklist rows it sits above.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { stripComments } from "@/lib/testing/strip-comments";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = stripComments(fs.readFileSync(path.join(HERE, "plan-narrative.tsx"), "utf8"));
const VIEW = stripComments(fs.readFileSync(path.join(HERE, "optimization-view.tsx"), "utf8"));

describe("the plan narrative card source", () => {
  it("is a client component", () => {
    assert.ok(SOURCE.trimStart().startsWith('"use client"'));
  });

  it("renders nothing rather than an empty card when there is no narrative", () => {
    assert.match(SOURCE, /if \(plan === null\) return null;/);
  });

  it("takes every value from the mapper and computes none of its own", () => {
    assert.ok(SOURCE.includes("planNarrativeProps"));
    // No arithmetic and no formatting in the markup: if the card needs a derived value it belongs
    // in the mapper, where it can be tested. The step index is the one exception, and it numbers
    // the list rather than saying anything about the consumer's file.
    assert.doesNotMatch(SOURCE, /\bMath\.|toFixed|toLocaleString|new Date\(/);
    assert.doesNotMatch(SOURCE, /\{index \+ 1\}[\s\S]*\{index \+ 1\}/);
  });

  it("links each step at its own anchor rather than at a scroll position", () => {
    assert.ok(SOURCE.includes("href={step.href}"));
    assert.doesNotMatch(SOURCE, /scrollIntoView|scrollTo/);
  });

  it("carries no promise, no lender and no partner link", () => {
    for (const banned of ["guarantee", "will approve", "credit repair", "http://", "https://"]) {
      assert.ok(!SOURCE.toLowerCase().includes(banned), banned);
    }
  });

  it("reuses the view's own card tokens rather than inventing a palette", () => {
    for (const token of [
      "var(--consumer-surface-border,var(--consumer-border))",
      "var(--consumer-border)",
      "var(--consumer-accent-tint)",
      "var(--consumer-accent-ink)",
      "text-muted-foreground",
      "bg-card",
    ]) {
      assert.ok(SOURCE.includes(token), token);
      assert.ok(VIEW.includes(token), `${token} is not a token the optimization view uses`);
    }
    // No hard-coded colours: the card has to follow the viewer's theme like everything around it.
    assert.doesNotMatch(SOURCE, /#[0-9a-fA-F]{3,8}\b|\brgb\(|\bhsl\(/);
  });
});

describe("the optimization view's side of the change", () => {
  it("mounts the card once, above the checklist tracks", () => {
    const mounts = VIEW.match(/<PlanNarrative /g) ?? [];
    assert.equal(mounts.length, 1);
    assert.ok(VIEW.indexOf("<PlanNarrative ") < VIEW.indexOf("<Track"));
  });

  it("gives every factor row the anchor a narrative step links to", () => {
    assert.ok(VIEW.includes("id={factorAnchorId(factor.key)}"));
  });

  it("prefers the narrative's note for a factor and keeps the template as the fallback", () => {
    assert.match(VIEW, /narrativeNoteFor\(narrative, factor\) \?\? signalCopy\(factor\)/);
  });
});
