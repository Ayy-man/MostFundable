// Which of the three things that can put text in the composer wins.
//
// The whole reason this is a function is that the alternative — an effect writing the insert into
// state — is racy in a way that is invisible until somebody complains that a suggestion chip ate
// what they were halfway through typing. So the cases here are the orderings, driven rather than
// described, and the component is held to using this rather than reimplementing it.
//
// Watched failing: with `editIsCurrent` dropping its token comparison (the natural simplification,
// since the thread check alone looks like it covers everything), 4 pass and 2 fail — "fills the box
// again when the same chip is pressed twice" reports the box still empty on the second press, and
// "treats an edit made before the current insert as stale" names the ordering directly.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { composerValue, editIsCurrent } from "./composer-value";

const REF = "thread-a";

describe("composer value · what the box shows", () => {
  it("shows the saved draft when nothing else has happened", () => {
    assert.equal(composerValue(null, REF, null, "half a question"), "half a question");
  });

  it("lets an insert replace a saved draft, and typing replace the insert", () => {
    const insert = { token: 1, value: "What should I finish first?" };
    assert.equal(composerValue(null, REF, insert, "older text"), insert.value);
    const typed = { ref: REF, token: 1, value: "What should I finish first? Also —" };
    assert.equal(composerValue(typed, REF, insert, "older text"), typed.value);
  });

  it("fills the box again when the same chip is pressed twice", () => {
    // The case a bare string prop gets wrong. Somebody presses a chip, clears the box, presses the
    // same chip: the value is identical and only the token says it happened again.
    const first = { token: 1, value: "What changed since my last refresh?" };
    const cleared = { ref: REF, token: 1, value: "" };
    assert.equal(composerValue(cleared, REF, first, ""), "");
    const second = { token: 2, value: first.value };
    assert.equal(composerValue(cleared, REF, second, ""), second.value);
  });

  it("keeps each thread's draft to itself", () => {
    // Switching threads has to restore the other thread's saved draft, and it has to do it without
    // an effect clearing state — an effect that clears on thread change also clears on a re-render
    // the parent happens to cause.
    const typed = { ref: REF, token: null, value: "for thread a" };
    assert.equal(composerValue(typed, REF, null, "saved a"), "for thread a");
    assert.equal(composerValue(typed, "thread-b", null, "saved b"), "saved b");
  });

  it("treats an edit made before the current insert as stale", () => {
    assert.equal(editIsCurrent({ ref: REF, token: null, value: "x" }, REF, null), true);
    assert.equal(editIsCurrent({ ref: REF, token: null, value: "x" }, REF, { token: 1, value: "y" }), false);
    assert.equal(editIsCurrent({ ref: REF, token: 1, value: "x" }, REF, { token: 1, value: "y" }), true);
  });
});

describe("composer value · the component uses it", () => {
  it("derives its value here rather than keeping a second copy of the rule", () => {
    // Two implementations of this would disagree on exactly the orderings above, and the component
    // is the one that cannot be driven — so what is checked is that it delegates.
    const source = fs.readFileSync(path.join(import.meta.dirname, "composer.tsx"), "utf8");
    assert.match(source, /from "\.\/composer-value"/);
    assert.match(source, /const value = composerValue\(/);
    // And it does not also branch on the thread itself, which is how the two copies start.
    assert.equal(
      /edited\?\.ref === threadRef/.test(source),
      false,
      "the composer still compares the edit's thread itself, so the rule lives in two places",
    );
  });
});
