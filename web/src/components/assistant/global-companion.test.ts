// The three defects the 2026-08-23 signed-in browser QA found in the global assistant companion,
// held here as rules rather than as transcriptions of the fixes.
//
// Every assertion below derives its expected value at test time — the close button's gutter from
// `sheet.tsx`, the effective padding from Tailwind's own last-utility-wins rule, the pane's follow
// decision from the module that makes it. That is the round-5 standard: a regression that
// transcribes the reproduction rots the moment the shape around it moves, which is how ten of
// round 4's fixes were defeated with their classes still correctly identified.
//
// Watched failing on the pre-fix tree (856b839), one at a time:
//   1. header gutter — `pl-4 pr-14 sm:pl-5 sm:pr-14` put back to `px-4 pr-14 sm:px-5`: the sm
//      effective padding-right computes to 20px against a 56px gutter and this fails. On the live
//      deployment that was the privacy-and-scope control sitting under the close button, with
//      `elementFromPoint` at its centre returning the close button.
//   2. final focus — `finalFocus={launcher}` deleted: measured on production as `document.body`
//      holding focus after both Escape and Cmd+/.
//   3. pane pinning — `nextScrollTop` made to re-measure instead of taking the latched flag: the
//      production numbers below stop scrolling and the sources row stays off-screen.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { isAtBottom, nextScrollTop, PINNED_SLACK } from "./pane-pinning";

const HERE = path.resolve(import.meta.dirname);
const source = (rel: string) => fs.readFileSync(path.resolve(HERE, rel), "utf8");

/** Tailwind's spacing scale in px, for the `-N` numeric utilities this file cares about. */
const px = (step: number) => step * 4;

/**
 * The square the sheet's own close button occupies on the right edge, in px.
 *
 * Derived from `sheet.tsx`, because that is the element the header has to stay clear of and it is
 * positioned `absolute` — outside the header's flow, so nothing but padding keeps them apart. A
 * change to `right-3` or `size-11` there has to move this number, not break the header silently.
 */
function closeButtonGutterPx(): number {
  const sheet = source("../ui/sheet.tsx");
  const block = sheet.slice(sheet.indexOf("data-slot=\"sheet-close\""));
  const right = /className="[^"]*\bright-(\d+)\b/.exec(block);
  const size = /className="[^"]*\bsize-(\d+)\b/.exec(block);
  assert.ok(right && size, "sheet.tsx no longer positions its close button with right-N size-N");
  return px(Number(right[1])) + px(Number(size[1]));
}

/**
 * The padding-right a Tailwind class list actually produces at a given variant.
 *
 * The rule, not the string: within one variant the last utility touching the property wins, and a
 * variant that never states the property inherits whatever the unprefixed classes settled on. `px-`
 * and `p-` count, which is the whole point — the defect was a later `sm:px-5` quietly outranking an
 * earlier `pr-14`.
 */
function paddingRightPx(classes: string, variant: "" | "sm"): number | null {
  let value: number | null = null;
  for (const pass of variant === "" ? [""] : ["", "sm"]) {
    for (const token of classes.split(/\s+/).filter(Boolean)) {
      const [prefix, utility] = token.includes(":") ? token.split(":") : ["", token];
      if (prefix !== pass) continue;
      const hit = /^(pr|px|p)-(\d+)$/.exec(utility);
      if (hit) value = px(Number(hit[2]));
    }
  }
  return value;
}

describe("the assistant header keeps its own controls clear of the sheet's close button", () => {
  const companion = source("./global-companion.tsx");
  const gutter = /const HEADER_GUTTER_CLASS = "([^"]+)";/.exec(companion);

  it("states a gutter class at all", () => {
    assert.ok(gutter, "HEADER_GUTTER_CLASS is gone; the header's padding is unpinned again");
  });

  for (const variant of ["", "sm"] as const) {
    it(`reserves the close button's width at ${variant === "" ? "every width" : "sm and above"}`, () => {
      assert.ok(gutter);
      const reserved = paddingRightPx(gutter[1], variant);
      assert.ok(reserved !== null, `no padding-right resolves at variant "${variant}"`);
      assert.ok(
        reserved >= closeButtonGutterPx(),
        `padding-right resolves to ${reserved}px at variant "${variant}", under the ${closeButtonGutterPx()}px the close button occupies — header controls will sit beneath it`,
      );
    });
  }

  it("self-test: the pre-fix class list is the failure this catches", () => {
    assert.equal(paddingRightPx("px-4 py-3 pr-14 sm:px-5", ""), 56);
    assert.equal(paddingRightPx("px-4 py-3 pr-14 sm:px-5", "sm"), 20);
    assert.ok(20 < closeButtonGutterPx());
  });
});

describe("a surface's own floating action stays clear of the launcher", () => {
  const companion = source("./global-companion.tsx");
  const lane = (name: string) => {
    const hit = new RegExp(`${name} =\\s*\n?\\s*"([^"]+)"`).exec(companion);
    assert.ok(hit, `${name} is gone`);
    return hit[1];
  };

  /** A bottom-anchored offset in px for a given variant, falling back to the unprefixed value. */
  const offset = (classes: string, prop: "bottom" | "min-h", variant: "" | "lg"): number | null => {
    let value: number | null = null;
    for (const pass of variant === "" ? [""] : ["", "lg"]) {
      for (const token of classes.split(/\s+/).filter(Boolean)) {
        const [prefix, utility] = token.includes(":") ? token.split(":") : ["", token];
        if (prefix !== pass) continue;
        const arbitrary = new RegExp(`^${prop}-\\[([\\d.]+)rem\\]$`).exec(utility);
        if (arbitrary) value = Number(arbitrary[1]) * 16;
        const step = new RegExp(`^${prop}-(\\d+)$`).exec(utility);
        if (step) value = px(Number(step[1]));
      }
    }
    return value;
  };

  // The launcher is a text pill, so its WIDTH is content and no other component can know it. Its
  // height is not: `min-h-12` is stated, and stacking above it needs only that plus its offset.
  for (const variant of ["", "lg"] as const) {
    it(`leaves vertical clearance above the launcher at ${variant === "" ? "every width" : "lg and above"}`, () => {
      const launcher = lane("LAUNCHER_PLACEMENT_CLASS");
      const adjacent = lane("ASSISTANT_LAUNCHER_ADJACENT_CLASS");
      const launcherBottom = offset(launcher, "bottom", variant);
      const launcherHeight = offset(launcher, "min-h", variant);
      const adjacentBottom = offset(adjacent, "bottom", variant);
      assert.ok(launcherBottom !== null && launcherHeight !== null && adjacentBottom !== null);
      const clearance = adjacentBottom - (launcherBottom + launcherHeight);
      assert.ok(
        clearance > 0,
        `a surface's floating action sits ${adjacentBottom}px off the bottom while the launcher reaches ${launcherBottom + launcherHeight}px — they overlap by ${-clearance}px at variant "${variant}"`,
      );
    });
  }

  it("shares the launcher's right edge instead of guessing its width", () => {
    const adjacent = lane("ASSISTANT_LAUNCHER_ADJACENT_CLASS");
    const launcher = lane("LAUNCHER_PLACEMENT_CLASS");
    const rights = (classes: string) => classes.split(/\s+/).filter((t) => /(^|:)right-/.test(t)).sort();
    assert.deepEqual(rights(adjacent), rights(launcher));
  });

  for (const surface of ["consumer", "operator"] as const) {
    it(`${surface}.tsx routes its floating action through the shared lane`, () => {
      const text = source(`../surfaces/${surface}.tsx`);
      // A floating action is what is pinned to a corner: bottom- and right-anchored, and not
      // stretched across the viewport. That last clause is what keeps the consumer's full-bleed
      // mobile pane (`fixed bottom-0 left-0 right-0`) out of this rule — it is a pane, not a pill.
      const literal = [...text.matchAll(/className="([^"]*\bfixed\b[^"]*)"/g)]
        .map((hit) => hit[1])
        .filter((classes) => /(^|\s)(lg:)?bottom-/.test(classes))
        .filter((classes) => /(^|\s)(lg:)?right-/.test(classes))
        .filter((classes) => !/(^|\s)(lg:)?left-/.test(classes));
      assert.deepEqual(
        literal,
        [],
        `${surface}.tsx still places a floating action with its own literal offsets; a hand-measured offset beside a content-width launcher is the defect this lane replaces`,
      );
      assert.ok(
        text.includes("ASSISTANT_LAUNCHER_ADJACENT_CLASS"),
        `${surface}.tsx does not use the shared lane`,
      );
    });
  }
});

describe("closing the assistant returns focus to the launcher", () => {
  const companion = source("./global-companion.tsx");

  it("hands the sheet the same ref the launcher carries", () => {
    const launcherRef = /const (\w+) = useRef<HTMLButtonElement \| null>\(null\);/.exec(companion);
    assert.ok(launcherRef, "no launcher ref is declared");
    const name = launcherRef[1];
    const button = companion.slice(companion.indexOf('aria-label="Open AI assistant"'));
    const buttonEnd = button.indexOf("</Button>");
    assert.ok(
      button.slice(0, buttonEnd).includes(`ref={${name}}`),
      "the launcher button does not carry the ref that focus is returned to",
    );
    assert.ok(
      companion.includes(`finalFocus={${name}}`),
      "the sheet does not name the launcher as its final focus, so closing drops focus to the body",
    );
  });
});

describe("the answer pane follows a new answer for a reader who was at the bottom", () => {
  // The pane as measured signed-in against production at 1440x900, the moment the answer landed:
  // 664px of pane, 750px of content, and a scrollTop still at 0 because nothing had scrolled. The
  // sources block spanned 643-832 against a window ending at 766.
  const grown = { clientHeight: 664, scrollHeight: 750, scrollTop: 0 };

  it("scrolls to the new bottom when nothing had scrolled away from it", () => {
    assert.equal(nextScrollTop(true, grown), grown.scrollHeight);
  });

  it("does not re-measure at resize time, because growth alone reads as 'not at the bottom'", () => {
    assert.equal(isAtBottom(grown), false, "the grown pane is not at its bottom — that is the trap");
    assert.equal(nextScrollTop(isAtBottom(grown), grown), null);
  });

  it("leaves a reader who scrolled up where they were", () => {
    const scrolledUp = { clientHeight: 664, scrollHeight: 1400, scrollTop: 200 };
    assert.equal(isAtBottom(scrolledUp), false);
    assert.equal(nextScrollTop(isAtBottom(scrolledUp), scrolledUp), null);
  });

  it("treats a pane that has never overflowed as already at its bottom", () => {
    assert.equal(isAtBottom({ clientHeight: 664, scrollHeight: 664, scrollTop: 0 }), true);
  });

  it("allows one line of slack rather than an exact landing", () => {
    const near = { clientHeight: 664, scrollHeight: 750, scrollTop: 750 - 664 - PINNED_SLACK };
    assert.equal(isAtBottom(near), true);
  });
});
