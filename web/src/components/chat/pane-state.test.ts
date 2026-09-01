// No pane in any of the four views may render blank.
//
// This is not a hypothetical. The consumer Team Chat ships today rendering the literal sentence
// "Loading the conversation..." as unstyled text in a 600px void for a measured 3.5 seconds, and
// then resolving to an empty box — a loading state with no geometry, followed by an empty state
// that says nothing. Both are what a props bag of optionals allows and what a discriminated union
// forbids, and this file is what stops the union quietly going back to a props bag.
//
// The type half is verified by `tsc` and asserted here against the source. The other half is a
// sweep: every component in the foundation that can be handed an empty collection must route
// through `PaneState`, because a `.map` over an empty array renders nothing at all and looks
// exactly like a component that is still loading.
//
// Watched failing before it counted, one change at a time against this tree: making `skeleton`
// optional on the loading member — the loading case failed; making `action` optional on the empty
// member — the teaching case failed; removing `PaneState` from `thread-list.tsx` — the sweep
// failed; and adding a sixth value to `PaneStatus` in `types.ts` — the coverage case failed.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { stripComments } from "@/lib/testing/strip-comments";

const HERE = path.resolve(import.meta.dirname);
const read = (file: string) => fs.readFileSync(path.join(HERE, file), "utf8");
const code = stripComments;

/** The members of the union, parsed out of the file that owns them. */
function members(): Map<string, string> {
  const source = code(read("pane-state.tsx"));
  const union = /export type PaneStateProps =([\s\S]*?)\n\);/.exec(source);
  assert.ok(union, "PaneStateProps is no longer a union; the guarantees below are gone with it");
  const found = new Map<string, string>();
  for (const member of union[1].split(/\n\s*\|\s*\{/)) {
    const status = /status: Extract<PaneStatus, "(\w+)">/.exec(member);
    if (status) found.set(status[1], member);
  }
  return found;
}

describe("the states a pane can be in", () => {
  it("covers every status the vocabulary declares, and no more", () => {
    // Derived from `types.ts` rather than listed here: a sixth status added there with nothing to
    // render it is exactly the gap that ends as a blank pane.
    const declared = /export type PaneStatus =([\s\S]*?);/.exec(read("types.ts"));
    assert.ok(declared, "PaneStatus is gone");
    const statuses = [...declared[1].matchAll(/"(\w+)"/g)].map((match) => match[1]);
    assert.ok(statuses.length >= 5, `only ${statuses.length} statuses parsed`);

    const covered = members();
    for (const status of statuses) {
      assert.ok(covered.has(status), `"${status}" has no member and therefore nothing to render`);
    }
    assert.equal(covered.size, statuses.length, "a member exists for a status nothing declares");
  });

  it("will not let a loading pane exist without geometry to stand in", () => {
    const loading = members().get("loading");
    assert.ok(loading, "the loading member is gone");
    // Required, not optional. `skeleton?:` is the version that ships a sentence in a void.
    assert.match(loading, /readonly skeleton: ReactNode;/, "the skeleton is optional again");
    assert.doesNotMatch(loading, /readonly skeleton\?/, "the skeleton is optional again");
  });

  it("will not let an empty pane exist without teaching and a way forward", () => {
    const empty = members().get("empty");
    assert.ok(empty, "the empty member is gone");
    for (const required of ["title", "description", "action"]) {
      assert.match(
        empty,
        new RegExp(`readonly ${required}: `),
        `an empty pane can be built without a ${required}, which is how "No conversations yet" happens`,
      );
    }
  });

  it("will not let an error pane exist without a way out", () => {
    const failed = members().get("error");
    assert.ok(failed, "the error member is gone");
    assert.match(failed, /readonly action: PaneAction;/, "an error can be rendered with no retry");
  });

  it("offers a disabled pane nothing to press, because it cannot act", () => {
    const off = members().get("disabled");
    assert.ok(off, "the disabled member is gone");
    assert.doesNotMatch(off, /action/, "a disabled pane offers an action it cannot perform");
    assert.match(off, /readonly description: string;/, "a disabled pane does not say why");
  });
});

describe("nothing in the foundation can render an empty collection as nothing", () => {
  it("gives every required collection prop a fallback, and leaves adornments alone", () => {
    // The distinction is mechanical rather than a skip list, because a skip list is the
    // enumeration that rots while the class it stands for stays true.
    //
    // A *required* collection prop is the pane's subject: the caller must hand one over, so an
    // empty one means "there is nothing", and rendering that as literally nothing is the blank
    // pane. An *optional* one defaulting to `[]` is an adornment — no attachments and no slash
    // commands genuinely mean nothing should be drawn, and a fallback there would be noise.
    //
    // So the rule reads the props: map a required collection, owe a fallback.
    const files = fs.readdirSync(HERE).filter((name) => name.endsWith(".tsx"));
    assert.ok(files.length >= 5, `only ${files.length} components swept`);

    let owing = 0;
    for (const file of files) {
      const source = code(read(file));
      for (const props of source.matchAll(/export interface (\w+Props) \{([\s\S]*?)\n\}/g)) {
        for (const field of props[2].matchAll(/readonly (\w+)(\??): readonly [^;]*\[\];/g)) {
          const [, name, optional] = field;
          if (optional === "?") continue;
          // Required, and actually rendered as rows rather than only counted or searched.
          if (!new RegExp(`${name}\\.map\\(`).test(source)) continue;
          owing += 1;
          assert.match(
            source,
            /PaneState|PaneFallback/,
            `${file}: \`${name}\` is required, so it can arrive empty, and ${props[1]} has no fallback`,
          );
        }
      }
    }
    assert.ok(owing >= 2, `the sweep found only ${owing} subject collections; the layout moved`);
  });
});
