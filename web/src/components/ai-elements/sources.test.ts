// A citation with nowhere to go is a first-class state, not an empty href.
//
// The assistant cites knowledge articles that have no page — the fixture host serves nothing, and
// an internal article is not a URL in production either (findings F-05, F-06). Without a member
// for that, the only way to render one is `onOpen={() => {}}`, which is a dead control: it looks
// pressable, it takes focus, it announces as a button, and it does nothing.
//
// Watched failing before it counted, one change at a time against this tree: deleting the
// `{ href?: never; onOpen?: never }` member — the three-shapes case failed; rendering the no-link
// chip as a `<button>` — the not-a-control case failed; and giving `CHIP_STATIC` a
// `focus-visible:` treatment — the same case failed, because a focus ring on a thing that cannot
// be focused is the invitation this state exists to withhold.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { stripComments } from "@/lib/testing/strip-comments";

const source = fs.readFileSync(path.join(import.meta.dirname, "sources.tsx"), "utf8");
const code = stripComments(source);

describe("a source chip", () => {
  it("offers all three fates a citation can have", () => {
    const union = /export type SourceProps = SourceCommon &\s*\(([\s\S]*?)\n  \);/.exec(code);
    assert.ok(union, "SourceProps is no longer a union");
    const members = union[1].split("|").filter((member) => member.trim().length > 0);
    assert.equal(members.length, 3, `${members.length} shapes; the no-link citation is one of them`);

    const shapes = members.map((member) => ({
      href: /href: string/.test(member),
      open: /onOpen: \(\) => void/.test(member),
    }));
    assert.ok(
      shapes.some((shape) => !shape.href && !shape.open),
      "there is no member for a citation with no destination, so callers must fake one",
    );
  });

  it("renders the no-destination case as a label rather than a control", () => {
    // The branch that runs when neither prop is present.
    const fallback = code.slice(code.lastIndexOf("return ("));
    assert.match(fallback, /<span/, "the no-link chip is not a span");
    assert.doesNotMatch(fallback, /<button|onClick|href=/, "the no-link chip is still a control");
    // It still says what kind of thing it is, so the label is not the only channel.
    assert.match(fallback, /aria-label=\{label\}/, "the no-link chip loses its accessible name");
  });

  it("gives the static chip no affordance it cannot honour", () => {
    const chip = /const CHIP_STATIC =([\s\S]*?);/.exec(code);
    assert.ok(chip, "CHIP_STATIC is gone");
    for (const affordance of ["focus-visible:", "hover:", "cursor-pointer"]) {
      assert.ok(
        !chip[1].includes(affordance),
        `the un-openable chip carries \`${affordance}\`, which invites a press it cannot answer`,
      );
    }
  });

  it("keeps the openable chip a real control, with a target and a ring", () => {
    const chip = /const CHIP =([\s\S]*?);\n/.exec(code);
    assert.ok(chip, "CHIP is gone");
    const full = chip[1] + (/const CHIP_BASE =([\s\S]*?);/.exec(code)?.[1] ?? "");
    assert.match(full, /min-h-11/, "the source chip is under the touch floor");
    assert.match(full, /focus-visible:/, "the source chip has no focus indicator");
  });
});
