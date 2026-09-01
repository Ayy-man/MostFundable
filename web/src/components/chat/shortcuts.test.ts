// The inbox keyboard vocabulary.
//
// Two things are worth checking and one of them is not the key list. That it says `j` is a
// decision, and a test asserting `j` would only prove the decision has not changed.
//
// What matters is that the overlay and the handler cannot disagree — a help screen listing a key
// that does nothing is worse than no help screen, because a person who has been told a shortcut
// exists and finds it inert stops trusting the whole set — and that a single letter never fires
// while somebody is typing a reply, which is the bug that eats a word mid-sentence.
//
// The hook and the overlay live in `shortcut-overlay.tsx`; the table and the matcher live here.
// Two files called `shortcuts` would have been one import away from resolving to the wrong one.
//
// Watched failing before it counted, one change at a time against this tree: dropping the
// `typing` guard from `matchShortcut` — the typing case failed; letting a modifier through — the
// browser-shortcut case failed; adding a row to `CHAT_SHORTCUTS` with a group the overlay does not
// render — the coverage case failed; and making `useChatShortcuts` call `preventDefault` before
// looking the handler up — the unbound case failed.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  CHAT_SHORTCUTS,
  isTypingTarget,
  matchShortcut,
  shortcutGroups,
  type ShortcutId,
} from "./shortcuts.ts";

import { stripComments } from "@/lib/testing/strip-comments";

const HERE = path.resolve(import.meta.dirname);

describe("the vocabulary is one table", () => {
  it("shows every bound key in the overlay, and binds every key it shows", () => {
    // Both sides derived from the table, so neither can drift from it.
    const grouped = shortcutGroups().flatMap((section) => section.shortcuts);
    assert.deepEqual(
      [...grouped].map((shortcut) => shortcut.id).sort(),
      [...CHAT_SHORTCUTS].map((shortcut) => shortcut.id).sort(),
      "a shortcut exists that the overlay's groups do not reach",
    );
  });

  it("gives every row a key nothing else claims and a label a person can read", () => {
    const keys = CHAT_SHORTCUTS.map((shortcut) => shortcut.key.toLowerCase());
    assert.equal(new Set(keys).size, keys.length, "two shortcuts claim the same key");
    for (const shortcut of CHAT_SHORTCUTS) {
      assert.ok(shortcut.label.length > 3, `${shortcut.id} has no readable label`);
      // A label that is just the key teaches nothing.
      assert.notEqual(shortcut.label.toLowerCase(), shortcut.key.toLowerCase());
    }
  });

  it("carries a way to discover itself", () => {
    const help = CHAT_SHORTCUTS.find((shortcut) => shortcut.id === "help");
    assert.ok(help, "there is no shortcut that opens the shortcut list");
  });
});

describe("a keystroke only counts when it is one", () => {
  it("matches every key the table declares", () => {
    for (const shortcut of CHAT_SHORTCUTS) {
      assert.equal(
        matchShortcut({ key: shortcut.key }, false),
        shortcut.id,
        `${shortcut.key} does not reach ${shortcut.id}`,
      );
    }
  });

  it("refuses every key the table does not", () => {
    for (const key of ["z", "F5", "ArrowDown", "1"]) {
      assert.equal(matchShortcut({ key }, false), null, `${key} matched something`);
    }
  });

  it("leaves the browser's and the OS's own chords alone", () => {
    // A single-letter shortcut that swallows ⌘R is the kind of bug that gets an app uninstalled.
    for (const modifier of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }]) {
      for (const shortcut of CHAT_SHORTCUTS) {
        assert.equal(
          matchShortcut({ key: shortcut.key, ...modifier }, false),
          null,
          `${shortcut.key} still fired under ${Object.keys(modifier)[0]}`,
        );
      }
    }
  });

  it("stays out of the way while somebody is typing, except for the way out", () => {
    // Without this, `n` in the middle of a reply starts an internal note and eats the word.
    const survivors: ShortcutId[] = [];
    for (const shortcut of CHAT_SHORTCUTS) {
      if (matchShortcut({ key: shortcut.key }, true) !== null) survivors.push(shortcut.id);
    }
    assert.deepEqual(survivors, ["back"], "a shortcut fires while a field has focus");
  });

  it("knows a field when it sees one", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
      assert.equal(isTypingTarget({ tagName }), true, `${tagName} is not treated as a field`);
    }
    assert.equal(isTypingTarget({ isContentEditable: true, tagName: "DIV" }), true);
    assert.equal(isTypingTarget({ tagName: "BUTTON" }), false);
    assert.equal(isTypingTarget(null), false);
  });
});

describe("the hook", () => {
  it("never swallows a key this surface has no handler for", () => {
    // A surface binding two of the ten must not break the browser's use of the other eight.
    const source = stripComments(
      fs.readFileSync(path.join(HERE, "shortcut-overlay.tsx"), "utf8"),
    );
    const lookup = source.indexOf("handlers[id]");
    const prevent = source.indexOf("event.preventDefault()", lookup);
    const bail = source.indexOf("handler === undefined) return", lookup);
    assert.ok(lookup > 0, "the hook no longer looks the handler up");
    assert.ok(bail > 0 && bail < prevent, "preventDefault runs before the unbound check");
  });
});
