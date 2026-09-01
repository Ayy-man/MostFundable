import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { stripComments } from "@/lib/testing/strip-comments";

// Reported from the live panel on 2026-08-24: the trace header read "Composing
// the answer  Composing the answer". `ThinkingOrb` renders `activity.label`
// itself — orb and words are one component — and the trace's trigger rendered
// `activity?.label` again in its own span beside it, so every active stage
// appeared twice, in text and to the screen reader both. The premise and the
// rule are each read off the module that owns it rather than transcribed here.

const HERE = path.resolve(import.meta.dirname);

function source(relative: string): string {
  return stripComments(fs.readFileSync(path.resolve(HERE, relative), "utf8"));
}

describe("the reasoning trace header", () => {
  it("lets the orb carry the stage label alone", () => {
    // Premise, derived: the orb component renders its activity's label as text.
    const orb = source("../chat/thinking-orb/index.tsx");
    assert.match(orb, /\{activity\.label\}/, "ThinkingOrb no longer renders its own label — if that moved, the trace may now carry it instead and this rule inverts");

    // Rule: a component that mounts <ThinkingOrb> must not also interpolate the
    // same activity's label into its own JSX, or the stage reads twice.
    const trace = source("./reasoning-trace.tsx");
    assert.match(trace, /<ThinkingOrb/, "the trace stopped mounting the orb; re-derive this rule against whatever renders the header now");
    assert.doesNotMatch(trace, /\{active \? activity\?\.label/, "the trigger renders the active label beside the orb that already shows it");
    assert.equal((trace.match(/activity\?*\.label/g) ?? []).length, 0, "the trace interpolates the orb's own label into its JSX");
  });
});
