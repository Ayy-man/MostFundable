// The send key, and the one place an AI draft must never be reachable from.
//
// This is the rule with a named cost: a stray Enter firing a half-written reply at somebody's
// client. So it gets driven rather than eyeballed, in both configurations, including the chords
// people bring from the other product.
//
// Watched failing before it counted, one change at a time against this tree: making `modifier`
// also accept a bare Enter — the operator case failed; dropping the `coarse` early return — the
// touch case failed; making `sendHint` a fixed string — the agreement case failed, which is the
// one that matters, because a hint that disagrees with the handler is worse than no hint; and
// putting a `onKeyDown` back on the draft frame in `composer.tsx` — the frame case failed.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { sendHint, sendsOnKey, type SendOn } from "./send-key.ts";

import { stripComments } from "@/lib/testing/strip-comments";

const BOTH: SendOn[] = ["enter", "modifier"];

/**
 * Strip comments before matching source.
 *
 * The frame carries a comment saying it binds no key handler, using the words `onKeyDown` and
 * `submit`. Explaining the rule must not read as breaking it — the same trap
 * `design-rails.test.ts` fell into, which is a good sign this belongs somewhere shared if a third
 * one appears.
 *
 * Block comments go first and a JSX comment needs no rule of its own: `{/* x *\/}` becomes `{ }`,
 * which is inert. The version that tried to match the JSX form directly matched from a JSDoc
 * block's opening brace all the way to the first `*\/}` far below it, swallowing half the
 * component — and it failed loudly rather than quietly only because the anchor it ate was the one
 * the test was looking for.
 */
const code = stripComments;

describe("the send key", () => {
  it("sends on a bare Enter in a consumer thread and never in an operator one", () => {
    assert.equal(sendsOnKey({ key: "Enter" }, "enter", false), true);
    assert.equal(sendsOnKey({ key: "Enter" }, "modifier", false), false);
  });

  it("sends on the chord in an operator composer and never in a consumer one", () => {
    for (const chord of [{ metaKey: true }, { ctrlKey: true }]) {
      assert.equal(sendsOnKey({ key: "Enter", ...chord }, "modifier", false), true);
      // Somebody arriving from Slack will try this. Sending on both keys means sending twice.
      assert.equal(sendsOnKey({ key: "Enter", ...chord }, "enter", false), false);
    }
  });

  it("never sends on Shift+Enter, whichever way round it is set", () => {
    for (const sendOn of BOTH) {
      assert.equal(sendsOnKey({ key: "Enter", shiftKey: true }, sendOn, false), false);
    }
  });

  it("never sends on a touch pointer, because the return key is the only newline there", () => {
    for (const sendOn of BOTH) {
      assert.equal(sendsOnKey({ key: "Enter" }, sendOn, true), false);
      assert.equal(sendsOnKey({ key: "Enter", metaKey: true }, sendOn, true), false);
    }
  });

  it("ignores every key that is not Enter", () => {
    for (const key of ["a", " ", "Escape", "Tab", "NumpadEnter"]) {
      for (const sendOn of BOTH) {
        assert.equal(sendsOnKey({ key }, sendOn, false), false, `${key} sent under ${sendOn}`);
      }
    }
  });
});

describe("the hint agrees with the handler", () => {
  it("names the key that actually sends, in every configuration", () => {
    // Derived from the function rather than compared against a transcribed sentence: what is
    // being checked is agreement between two functions, and a literal here would only prove that
    // the sentence has not changed.
    for (const sendOn of BOTH) {
      const hint = sendHint(sendOn, false);
      const bareEnterSends = sendsOnKey({ key: "Enter" }, sendOn, false);
      const chordSends = sendsOnKey({ key: "Enter", metaKey: true }, sendOn, false);

      assert.ok(hint.includes("Enter"), `${sendOn} hint never mentions Enter: ${hint}`);
      const mentionsChord = /⌘|Ctrl/.test(hint);
      assert.equal(
        mentionsChord,
        chordSends,
        `${sendOn} hint ${mentionsChord ? "names" : "omits"} the chord but the handler disagrees`,
      );
      // The one that sends is the one named first, because that is the sentence people read.
      const first = hint.split("·")[0];
      assert.equal(
        /⌘|Ctrl/.test(first),
        !bareEnterSends,
        `${sendOn} hint leads with the wrong key: ${hint}`,
      );
    }
  });

  it("says something true on touch, where neither key sends", () => {
    for (const sendOn of BOTH) {
      const hint = sendHint(sendOn, true);
      assert.doesNotMatch(hint, /Enter/, `the touch hint names a key that does nothing: ${hint}`);
    }
  });
});

/**
 * The frame's own source, found by what it is rather than by the line above it.
 *
 * This used to slice between `if (draft && !locked) {` and the next `\n  }`, which is a locator
 * made of neighbours: the guard was rewritten to keep a locked conversation's draft on screen, the
 * literal stopped matching, and a rail this important would have gone quiet if the slice had
 * merely come back empty instead of failing. The region's `aria-label` is what the frame *is*, so
 * that is the anchor, and the enclosing block is taken by counting braces.
 */
function draftFrame(composer: string): string {
  const marker = composer.indexOf('aria-label="AI draft, awaiting your review"');
  assert.notEqual(marker, -1, "the draft frame's region is gone or has been renamed");

  const guard = composer.lastIndexOf("if (", marker);
  assert.notEqual(guard, -1, "the draft frame is not inside a guarded branch any more");

  // The condition is the presence of a draft and nothing else. Text cannot show reachability, but
  // it can show that the branch is not gated on something that could switch it off — which is the
  // only way the ordering below could hold while both were reachable at once.
  const close = composer.indexOf(")", guard);
  assert.equal(
    composer.slice(guard + "if (".length, close).trim(),
    "draft",
    "the draft frame is guarded on more than whether there is a draft",
  );

  const open = composer.indexOf("{", close);
  let depth = 0;
  for (let index = open; index < composer.length; index += 1) {
    if (composer[index] === "{") depth += 1;
    else if (composer[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        const body = composer.slice(open + 1, index);
        assert.ok(body.includes(marker === -1 ? "" : "AI draft"), "the frame sliced to the wrong block");
        assert.ok(body.length > 400, "the draft frame sliced to almost nothing");
        return body;
      }
    }
  }
  assert.fail("the draft frame's branch is not closed");
}

describe("a framed AI draft has no keyboard path to Send", () => {
  it("gives the frame no key handling and no form to submit", () => {
    // Contract §2 rule 1: an AI-assisted message reaches a consumer only by a human act, and a
    // reflex is not an act. The frame is checked as source because the guarantee is structural —
    // there is no textarea inside it — and structure is what source text can honestly show.
    const composer = code(fs.readFileSync(path.join(import.meta.dirname, "composer.tsx"), "utf8"));
    const body = draftFrame(composer);

    assert.doesNotMatch(body, /<textarea/, "the frame contains a text field, which is a key path");
    assert.doesNotMatch(body, /<form/, "the frame is a form, whose implicit submission Enter reaches");
    assert.doesNotMatch(body, /onKeyDown|onKeyUp|onKeyPress/, "the frame binds a key handler");
    assert.doesNotMatch(body, /type="submit"/, "the frame has a submit control");
    // And the send is a real control, not a bare div somebody wired a click to.
    assert.match(body, /onClick=\{draft\.onSend\}/, "the frame has no pointer path to send either");
  });

  it("returns before the composer's own key handling can be reached", () => {
    const composer = code(fs.readFileSync(path.join(import.meta.dirname, "composer.tsx"), "utf8"));
    const frameAt = composer.indexOf(draftFrame(composer));
    const textareaAt = composer.indexOf("<textarea");
    assert.ok(frameAt > 0 && textareaAt > 0, "the composer no longer has both branches");
    assert.ok(
      frameAt < textareaAt,
      "the textarea renders before the draft frame returns, so both can be on screen at once",
    );
  });
});
