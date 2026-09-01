// Rail 3, checked against the components rather than remembered.
//
// "No UUID, no client_id, no thread_id, no draft_id rendered as text, in a title attribute, in a
// `data-` attribute a screen reader can reach, or in a copy button." The rule is easy to agree
// with and easy to break by accident: an opaque handle is right there on the object, it is
// unique, and it makes a perfect React key — so the day somebody wants a tooltip that
// distinguishes two identical rows, the handle is the nearest thing to hand.
//
// The set of fields this applies to is derived from the `@opaque` doc tags in `types.ts`, not
// listed here. That is the round-5 point: a list would pin today's fields, and the next opaque
// handle added to the contract would be one nobody thought to add to it. The derivation is
// asserted to be non-empty first, so a rename of the tag fails loudly instead of quietly checking
// nothing.
//
// **What this does not catch, stated plainly so nobody reads five swept roots as a clean tree.**
//
// The guard keys off the `@opaque` vocabulary, which today is the single name `ref`. The whole
// component tree is swept, and the view directories matter most in it — a primitive renders what
// it is handed, a view is where somebody reaches for the nearest unique string to tell two
// identical rows apart. But the extracted legacy views do not use that vocabulary: they carry
// `.id`, `.clientId`, `.threadId` and `.ownerId`, none of which is tagged, so this finds nothing
// in them today and is not meant to. The sweep passing is not evidence those files are clean.
//
// That is deliberate rather than a gap to close by adding those names here. Listing `id` would
// fire on every React key and every callback argument in the repo — a check that cries wolf, and
// those get muted rather than fixed. The design is that lanes 2, 3 and 4 adopt `ChatThreadSummary`
// and the rest of the `ref` vocabulary as they replace the legacy views, and the guard starts
// biting on each file the moment it does. It is standing early on purpose: a guard added at
// integration is a guard added when there is already something to fix.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const CHAT = path.resolve(import.meta.dirname);
const COMPONENTS = path.resolve(CHAT, "..");

// Every component in the tree, and deliberately not a list of roots.
//
// The first version of this swept two directories, then five. Both were lists, and a list is a
// thing somebody shortens: deleting one entry narrows the sweep and the suite still reports green,
// which is the failure mode this whole file exists to avoid one level up. Deriving the roots from
// disk was the obvious repair and does not work either — the view directories do not import the
// foundation yet, so "everything that imports the chat barrel" is empty today and would quietly
// sweep nothing at all.
//
// So there is no radius to get wrong. `@opaque` is already the filter, and it is a precise one;
// scanning two hundred files as source text costs milliseconds and removes the only moving part.

function filesUnder(root: string): string[] {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const absolute = path.join(root, entry.name);
      if (entry.isDirectory()) return filesUnder(absolute);
      return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [absolute] : [];
    });
}

/**
 * Every field documented `@opaque` in `types.ts`.
 *
 * The tag sits in the doc comment immediately above the field, so the parse is: find the tag,
 * then take the next `readonly <name>:` after it.
 */
function opaqueTags(): string[] {
  const types = fs.readFileSync(path.join(CHAT, "types.ts"), "utf8");
  const found: string[] = [];
  const tag = /@opaque[^*]*(?:\*(?!\/)[^*]*)*\*\/\s*readonly (\w+)\s*[:?]/g;
  let match = tag.exec(types);
  while (match !== null) {
    found.push(match[1]);
    match = tag.exec(types);
  }
  return found;
}

describe("no raw identifiers reach the DOM", () => {
  it("finds the opaque fields the contract declares", () => {
    // Tag sites, not distinct names: every opaque handle in this vocabulary is deliberately
    // called `ref`, so counting names would count one however many the contract grows. Counting
    // sites is what catches a `types.ts` where the tags were dropped.
    // Counted against the tag's own occurrences rather than a floor. `>= 4` was the first
    // version and it is too slack to notice a partial rename: six sites minus one still clears
    // it, so the parse would go on quietly checking five of six. Equality catches both halves —
    // a tag renamed out of the vocabulary, and a regex that has stopped matching one.
    // Counted after the module header, because the header *explains* the rule and says `@opaque`
    // twice doing it. Counting the whole file made this fail with "6 written, 4 parsed" on a tree
    // where all four real tags parse fine — a check accusing the parse of a bug the prose caused.
    // Same trap as a comment that names the thing it forbids, which this suite has now hit three
    // times; the tell is that the count is off by exactly the number of times the rule is
    // described.
    const types = fs.readFileSync(path.join(CHAT, "types.ts"), "utf8");
    const declarations = types.slice(types.indexOf("export "));
    const written = (declarations.match(/@opaque\b/g) ?? []).length;
    const tags = opaqueTags();
    assert.ok(written >= 4, `only ${written} @opaque tag(s) in types.ts; the vocabulary shrank`);
    assert.equal(
      tags.length,
      written,
      `${written} @opaque tags written, ${tags.length} parsed; the parse is missing some`,
    );
    // `ref` is the vocabulary contract §3.4 uses for an opaque handle. If it stops appearing, the
    // shape changed and everything below is checking the wrong name.
    assert.ok(tags.includes("ref"), `the opaque set is ${tags.join(", ")}`);
  });

  it("never renders one as text, a label, or a data attribute", () => {
    const fields = [...new Set(opaqueTags())];

    const files = filesUnder(COMPONENTS);
    // A floor against the sweep silently finding nothing — a moved directory, a changed
    // extension filter. It is deliberately far below the real count rather than tracking it,
    // because a number that has to be edited on every added component is a number people edit
    // without reading.
    assert.ok(files.length >= 50, `only ${files.length} components swept; the layout moved`);
    // And the three view directories the extraction created are reachable from here, which is the
    // part the radius was actually about.
    for (const view of ["operator/inbox", "consumer/team-chat", "assistant"]) {
      assert.ok(
        files.some((file) => path.relative(COMPONENTS, file).startsWith(view)),
        `\`components/${view}\` is not in the sweep`,
      );
    }

    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      const where = path.relative(COMPONENTS, file);

      for (const field of fields) {
        const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const rules: [string, RegExp][] = [
          // An attribute a person or a screen reader reads.
          [
            "a readable attribute",
            new RegExp(
              `(?:title|aria-label|aria-labelledby|alt|placeholder)=\\{[^{}]*\\.${escaped}\\b`,
            ),
          ],
          // A `data-` attribute, which is reachable from the accessibility tree in some tooling
          // and is copyable from devtools by anyone screen-sharing.
          ["a data attribute", new RegExp(`data-[a-z-]+=\\{[^{}]*\\.${escaped}\\b`)],
          // Rendered as a child, which is the plain "printed it on the screen" case. Anchored
          // on both sides — `>{…}<` — because the loose version matches every arrow function
          // whose body happens to touch the field, and a check that cries wolf gets deleted.
          [
            "a text node",
            new RegExp(`(?<!=)>\\s*\\{[^{}]*\\.${escaped}\\b[^{}]*\\}\\s*<`),
          ],
        ];

        for (const [what, pattern] of rules) {
          assert.equal(
            pattern.test(source),
            false,
            `${where} puts \`.${field}\` in ${what}`,
          );
        }
      }
    }
  });
});
