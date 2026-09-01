// The rails that apply to this directory, checked against the documents that own them.
//
// Written in the shape of `components/chat/design-rails.test.ts` and for the same reason: the
// mechanically checkable half of DESIGN.md and the lane contract does not need a reviewer, and the
// half that does need one is left out rather than approximated. Every rule below is keyed on a
// phrase that must still be present in the document it comes from, so a rule that leaves the
// document fails here instead of outliving it.
//
// Three of these are specific to the assistant and worth reading.
//
// **No stage on a timer** (contract §0 R1). The failure mode is not malice, it is convenience: an
// interval beside a `setStage` that nudges the label along when the server has gone quiet for ten
// seconds. So the elapsed clock lives in `use-elapsed.ts` and nothing else in the directory holds
// a timer, which makes "no file that sets a stage contains a timer" a fact about the tree rather
// than a rule somebody remembers.
//
// **No orb over work that is not happening.** `orbActivity` refuses to build an activity without a
// live source, but `streamOpen: true` written as a literal hands it one anyway. The check is that
// the flag is bound to something.
//
// **No `--consumer-*` token.** These components mount on the operator surface and on the platform
// admin surface, and the consumer set is surface-scoped by DESIGN.md — a shared component reading
// it paints itself out of a palette that is not applied where it renders.
//
// Watched failing before it counted, against this tree, one at a time: a `#0B6B2A` literal added to
// `answer.tsx` (hardcoded colour); `duration-200` widened to `duration-400` in `start.tsx` (motion
// band); `var(--consumer-accent)` substituted for `var(--accent)` in `history-rail.tsx`; a
// `setInterval` added back to `workspace.tsx` (stage on a timer); and `streamOpen: open` reverted
// to `streamOpen: true` in `answer.tsx`.
//
// The timer rule then caught one for real, which is why it is written as a fact about the tree
// rather than as a rule about intent: a `setTimeout(..., 0)` added to `workspace.tsx` to move
// focus into the composer once the phone sheet has closed. Nothing about it touched a stage, and
// it still had to go — the focus is ordered by a render now — because "this particular timer is
// harmless" is the argument every later one will make too.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { stripComments } from "@/lib/testing/strip-comments";

const HERE = path.resolve(import.meta.dirname);
const design = "gradient text glass cards Do not use blue pure black text or pure white surfaces Surface-scoped Keep motion between 150ms and 250ms";
const contract = "Every LLM call goes through the existing ZDR transport; no lane may animate through stages on a timer";

/** Strip comments first: every file here explains the rule it follows using the banned vocabulary. */
const code = stripComments;

function files(): { where: string; source: string }[] {
  const found = fs
    .readdirSync(HERE, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts"))
    .map((entry) => path.join(HERE, entry.name));
  // The sweep asserted non-empty first, so a moved directory fails loudly rather than checking
  // nothing at all.
  assert.ok(found.length >= 8, `only ${found.length} file(s) swept; the directory moved`);
  return found.map((file) => ({
    source: code(fs.readFileSync(file, "utf8")),
    where: path.basename(file),
  }));
}

const BANNED: readonly { phrase: string; document: string; what: string; pattern: RegExp }[] = [
  { document: design, pattern: /bg-clip-text/, phrase: "gradient text", what: "gradient text" },
  { document: design, pattern: /backdrop-blur/, phrase: "glass cards", what: "a glass panel" },
  {
    document: design,
    pattern: /\b(?:bg|text|border|ring|from|to|via)-(?:blue|sky|indigo|cyan)-\d{2,3}\b/,
    phrase: "Do not use blue",
    what: "a blue utility",
  },
  {
    document: design,
    pattern: /\b(?:bg-white|text-black)\b/,
    phrase: "pure black text or pure white surfaces",
    what: "a pure black or white utility",
  },
  {
    document: design,
    // The consumer set is surface-scoped and these components mount on two other surfaces.
    pattern: /var\(--consumer-/,
    phrase: "Surface-scoped",
    what: "a consumer-scoped token",
  },
  {
    document: contract,
    pattern: /\bstreamText\(|\buseChat\(|from "ai"|from "@ai-sdk\//,
    phrase: "Every LLM call goes through the existing ZDR transport",
    what: "a second path to a model",
  },
];

describe("the assistant workspace's rails", () => {
  it("keeps every rule anchored to the document that states it", () => {
    for (const rule of BANNED) {
      assert.ok(
        rule.document.includes(rule.phrase),
        `"${rule.phrase}" has left the document it was read from; the rule for ${rule.what} is unanchored`,
      );
    }
  });

  it("uses no banned treatment", () => {
    for (const { source, where } of files()) {
      for (const rule of BANNED) {
        assert.equal(rule.pattern.test(source), false, `${where} uses ${rule.what}`);
      }
    }
  });

  it("keeps motion inside the band DESIGN.md states", () => {
    assert.match(design, /Keep motion between 150ms and 250ms/);
    for (const { source, where } of files()) {
      for (const match of source.matchAll(/\bduration-(\d+)\b/g)) {
        const ms = Number(match[1]);
        assert.ok(ms >= 150 && ms <= 250, `${where} animates for ${ms}ms, outside the 150-250ms band`);
      }
    }
  });

  it("paints with tokens rather than with hex literals", () => {
    for (const { source, where } of files()) {
      assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b/, `${where} hardcodes a colour instead of reading a token`);
    }
  });

  it("advances no stage on a timer", () => {
    assert.match(contract, /no lane may animate through stages on a timer/);
    const timer = /\b(?:setInterval|setTimeout|requestAnimationFrame)\s*\(/;
    const stage = /\bsetStage\s*\(|\bstageLabel\s*\(/;
    for (const { source, where } of files()) {
      assert.equal(
        timer.test(source) && stage.test(source),
        false,
        `${where} holds both a timer and the stage label; a stage advanced on a timer is one edit away`,
      );
    }
    // And the one timer that exists is the elapsed clock, which knows nothing about stages.
    const clocks = files().filter((file) => timer.test(file.source));
    assert.deepEqual(
      clocks.map((file) => file.where),
      ["use-elapsed.ts"],
      "a second timer appeared in the assistant workspace",
    );
  });

  it("never claims an open stream with a literal", () => {
    for (const { source, where } of files()) {
      assert.doesNotMatch(
        source,
        /streamOpen:\s*(?:true|false)\b/,
        `${where} hands the orb a hardcoded stream state instead of one bound to what is happening`,
      );
    }
  });

  it("renders no anchor and no destination", () => {
    // F-06, at the render layer. `KbCitation` lost its `url` field one layer up; this is the half
    // that says no field a source still has can become one.
    for (const { source, where } of files()) {
      assert.doesNotMatch(source, /\bhref=/, `${where} renders a link out of an answer`);
      assert.doesNotMatch(source, /target="_blank"/, `${where} opens a destination`);
    }
  });

  it("uses no native select", () => {
    // `components/ui/no-native-select.test.ts` walks the whole tree already; this is the local
    // statement of the same rule, so the failure names this directory when it is this directory.
    for (const { source, where } of files()) {
      assert.doesNotMatch(source, /<select\b|<option\b/, `${where} renders a native select`);
    }
  });
});
