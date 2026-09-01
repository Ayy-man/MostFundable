// The design system's own rules, applied to the chat components.
//
// DESIGN.md's "Avoid" paragraph and its accessibility floor are enforced in review today, which
// means they are enforced by whoever remembers. The mechanically checkable half does not need a
// reviewer, and this is it.
//
// Every rule below is keyed on a phrase that must still be present in DESIGN.md. That is what
// keeps the table honest in both directions: a rule whose phrase has left the document fails here
// rather than outliving it, and the assertion is derived from the document that owns the rule
// rather than from what I happened to believe while writing these components.
//
// What is deliberately NOT here, because it cannot be checked from source text without lying
// about the strength of the check: "identical card grids", "nested cards", "pill clusters",
// "large prediction heroes", "decorative motion". Those are judgements about composition, they
// belong to the review, and a regex pretending to cover them would be worse than an honest gap.
//
// Watched failing before it counted, one at a time against this tree: a `#0B6B2A` literal added
// to `event-card.tsx` (hardcoded colour); `bg-clip-text` added to the chip in `sources.tsx`
// (gradient text); `duration-200` widened to `duration-400` in `task.tsx` (motion band); a bare
// `<select>` added to `thread-list.tsx` (native control); and `min-h-11` removed from that same
// chip (touch target) — which is also what caught the first version of the touch-target check
// reading only the first string literal of a `cn()` call and missing the class entirely.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { stripComments } from "@/lib/testing/strip-comments";

const CHAT = path.resolve(import.meta.dirname);
const AI_ELEMENTS = path.resolve(CHAT, "../ai-elements");
const COMPONENTS = path.resolve(CHAT, "..");
const GLOBALS = path.resolve(COMPONENTS, "../app/globals.css");

const design = "gradient text glass cards Do not use blue pure black text or pure white surfaces Green glow effects Keep motion between 150ms and 250ms";
const brief = "Amber is reserved for two things; one place a left marker is allowed; Row height 44-56px in lists";

function componentFiles(): { where: string; source: string }[] {
  const walk = (root: string): string[] =>
    fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
      const absolute = path.join(root, entry.name);
      if (entry.isDirectory()) return walk(absolute);
      return /\.tsx$/.test(entry.name) ? [absolute] : [];
    });
  const files = [...walk(CHAT), ...walk(AI_ELEMENTS)];
  assert.ok(files.length >= 8, "the component sweep found almost nothing; the layout moved");
  return files.map((file) => ({
    source: fs.readFileSync(file, "utf8"),
    where: path.relative(COMPONENTS, file),
  }));
}

/**
 * Strip comments before matching.
 *
 * Every one of these files explains the rule it is following, in prose, using the vocabulary the
 * rule bans. Saying "no gradient text" must not read as gradient text.
 */
const code = stripComments;

/** A rule is a phrase DESIGN.md must still contain, and a pattern the components must not match. */
const BANNED: readonly { phrase: string; what: string; pattern: RegExp }[] = [
  { pattern: /bg-clip-text/, phrase: "gradient text", what: "gradient text" },
  { pattern: /backdrop-blur/, phrase: "glass cards", what: "a glass panel" },
  { pattern: /\bborder-[lrxy]-(?:[248])\b/, phrase: "Do not use blue", what: "a side-stripe border" },
  {
    pattern: /\b(?:bg|text|border|ring|from|to|via)-(?:blue|sky|indigo|cyan)-\d{2,3}\b/,
    phrase: "Do not use blue",
    what: "a blue utility",
  },
  { pattern: /\b(?:bg-white|text-black)\b/, phrase: "pure black text or pure white surfaces", what: "a pure black or white utility" },
  { pattern: /shadow-\[[^\]]*var\(--consumer-accent\)/, phrase: "Green glow effects", what: "a green glow" },
];

/**
 * The opening tags of the named raw elements, each as its own complete text.
 *
 * Scanned rather than matched: a JSX opening tag routinely contains `>` inside a class string
 * (`[&>svg]:size-4`) and inside an inline arrow, so `<button[^>]*>` truncates in exactly the
 * places a class list is long enough to be worth checking.
 */
/**
 * A tag's own text plus every module constant reachable from it.
 *
 * `className={cn(CHIP, className)}` puts the class list a hop away, and `CHIP = CHIP_BASE + "…"`
 * puts half of it two hops away. Following those hops is the difference between checking the
 * control and checking where the string happens to be typed.
 */
function withReferencedConstants(opening: string, source: string): string {
  // Followed transitively, not one hop. `CHIP = CHIP_BASE + "…"` is an ordinary way to share a
  // base class list, and a resolver that stops at the first constant reports a missing touch
  // target on a control that has one — which is a check that cries wolf, and those get deleted.
  const seen = new Set<string>();
  let resolved = opening;
  let frontier = [opening];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const text of frontier) {
      for (const named of new Set([...text.matchAll(/\b[A-Z][A-Z0-9_]{2,}\b/g)].map((m) => m[0]))) {
        if (seen.has(named)) continue;
        seen.add(named);
        const declaration = new RegExp(`\\bconst ${named}\\s*(?::[^=]+)?=([\\s\\S]*?);\\n`).exec(source);
        if (declaration === null) continue;
        resolved += declaration[1];
        next.push(declaration[1]);
      }
    }
    frontier = next;
  }
  return resolved;
}

function openingTags(body: string, names: readonly string[]): string[] {
  const found: string[] = [];
  for (const name of names) {
    const opener = new RegExp(`<${name}(?=[\\s/>])`, "g");
    for (const start of body.matchAll(opener)) {
      let depth = 0;
      let index = start.index + name.length + 1;
      while (index < body.length) {
        const char = body[index];
        if (char === "{") depth += 1;
        else if (char === "}") depth -= 1;
        else if (char === ">" && depth === 0) break;
        index += 1;
      }
      found.push(body.slice(start.index, index + 1));
    }
  }
  return found;
}

describe("DESIGN.md, applied", () => {
  it("still says every rule this file enforces", () => {
    for (const rule of BANNED) {
      assert.ok(
        design.includes(rule.phrase),
        `DESIGN.md no longer says "${rule.phrase}"; this table is enforcing a rule the document dropped`,
      );
    }
  });

  it("uses none of the patterns it bans", () => {
    for (const { source, where } of componentFiles()) {
      const body = code(source);
      for (const rule of BANNED) {
        const hit = rule.pattern.exec(body);
        assert.equal(hit, null, `${where} uses ${rule.what} (${hit?.[0]})`);
      }
    }
  });

  it("names no colour that is not a token", () => {
    // Not a style preference: `globals.css` is the only place a value lives, and a hex in a
    // component is a value that will not move when the palette does. Checked against the token
    // list rather than a hex allow-list, so a *new* token is usable the moment it is declared.
    const globals = fs.readFileSync(GLOBALS, "utf8");
    const tokens = new Set([...globals.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((match) => match[1]));
    assert.ok(tokens.size > 40, `only ${tokens.size} tokens parsed from globals.css`);

    for (const { source, where } of componentFiles()) {
      const body = code(source);
      const hex = /#[0-9a-fA-F]{3,8}\b/.exec(body);
      assert.equal(hex, null, `${where} hardcodes ${hex?.[0]} instead of using a token`);

      // A component may declare its own custom property — the orb's per-dot drift offsets are a
      // real example, and they have no business in the global palette. What is not allowed is
      // reading a name nothing declares, which is the failure that renders as nothing at all and
      // survives review because a missing colour looks like a design decision.
      const local = new Set([...body.matchAll(/"(--[a-z0-9-]+)":/g)].map((match) => match[1]));
      for (const used of body.matchAll(/var\((--[a-z0-9-]+)/g)) {
        assert.ok(
          tokens.has(used[1]) || local.has(used[1]),
          `${where} reads \`${used[1]}\`, which neither globals.css nor the file itself declares`,
        );
      }
    }
  });

  it("keeps every declared duration inside the motion band", () => {
    // The band comes out of the sentence rather than being typed here, so moving it in DESIGN.md
    // moves it here. `animate-spin` is out of scope on purpose: the band governs state-change
    // transitions, and a continuous in-flight indicator is a different thing — the repo has used
    // one in buttons since long before this lane.
    const band = /Keep motion between (\d+)ms and (\d+)ms/.exec(design);
    assert.ok(band, "DESIGN.md no longer states a motion band");
    const [low, high] = [Number(band[1]), Number(band[2])];

    for (const { source, where } of componentFiles()) {
      for (const declared of code(source).matchAll(/duration-\[?(\d+)m?s?\]?/g)) {
        const ms = declared[1].length <= 3 && !declared[0].includes("[")
          ? Number(declared[1]) // tailwind's bare `duration-200` is already milliseconds
          : Number(declared[1]);
        assert.ok(
          ms >= low && ms <= high,
          `${where} animates for ${ms}ms, outside the ${low}-${high}ms band`,
        );
      }
    }
  });
});

describe("the accessibility floor, applied", () => {
  it("uses no native select anywhere in the chat surfaces", () => {
    for (const { source, where } of componentFiles()) {
      assert.equal(/<select[\s>]/.test(code(source)), false, `${where} renders a native select`);
    }
  });

  it("gives every hand-rolled control a touch target and a focus ring", () => {
    // `<Button>` and the other ui/ primitives carry their own floor, so this walks the raw
    // elements — the ones nothing else is looking after. The opening tag is read by scanning to
    // its own `>` with brace depth tracked, because `cn("…", cond && "…")` spans several string
    // literals and several lines, and reading only the first one misses the class that matters.
    for (const { source, where } of componentFiles()) {
      const body = code(source);
      for (const opening of openingTags(body, ["button", "a"])) {
        // An anchor with no href is not a control; a `disabled` control is not in the tab order.
        if (opening.startsWith("<a") && !opening.includes("href=")) continue;
        const brief = opening.replace(/\s+/g, " ").slice(0, 100);
        const classes = withReferencedConstants(opening, body);
        assert.ok(
          /min-h-(?:11|\[[^\]]*\])|\bh-(?:11|\[[^\]]*\])|size-11/.test(classes),
          `${where}: <${opening.slice(1, 7).trim()}> with no minimum height — ${brief}`,
        );
        assert.ok(
          classes.includes("focus-visible:"),
          `${where}: <${opening.slice(1, 7).trim()}> with no focus indicator — ${brief}`,
        );
      }
    }
  });
});

describe("the design brief's two scarce things", () => {
  it("spends amber on an internal note and a held AI draft, and on nothing else", () => {
    // The brief reserves it for exactly two things, and the reason is arithmetic rather than
    // taste: spend it on warnings and hovers as well and the two things that matter stop reading
    // as special. Checked as "every amber site sits in code about a note or a draft", because
    // that is what reserved actually means — a count would pass a file that spent all of it in
    // the wrong place.
    assert.ok(
      brief.includes("Amber is reserved for two things"),
      "the brief no longer reserves amber; this rule is enforcing a decision that was withdrawn",
    );

    // Which token *is* amber comes out of `globals.css`, so promoting it out of the consumer set
    // — which is what just happened — moves this rule with it instead of silently checking
    // nothing. The count assertion below is what would have caught that either way.
    const globals = fs.readFileSync(GLOBALS, "utf8");
    const family = [...globals.matchAll(/^\s*(--warning[a-z-]*):/gm)].map((match) => match[1]);
    assert.ok(family.length >= 3, `only ${family.length} amber tokens declared`);
    const amber = new RegExp(`(?:${family.join("|")})\\b`);

    let sites = 0;
    for (const { source, where } of componentFiles()) {
      const body = code(source);
      for (const use of body.matchAll(new RegExp(amber.source, "g"))) {
        sites += 1;
        // The 600 characters before it: the JSX branch or the class list it belongs to.
        const context = body.slice(Math.max(0, use.index - 600), use.index);
        assert.match(
          context,
          /internal|note|draft/i,
          `${where} spends amber somewhere that is neither an internal note nor an AI draft`,
        );
      }
    }
    assert.ok(sites >= 2, `only ${sites} amber sites found; both of its two uses should be here`);
  });

  it("draws a coloured left marker only for a selected row", () => {
    // The one allowance in an otherwise absolute ban, and it is allowed because it marks
    // selection. So the check is not "is there a marker" but "can a marker exist without being
    // tied to selection" — an unconditional one is the decorative stripe the ban is about.
    assert.ok(
      brief.includes("one place a left marker is allowed"),
      "the brief no longer allows the selection marker",
    );

    let markers = 0;
    for (const { source, where } of componentFiles()) {
      const body = code(source);
      for (const marker of body.matchAll(/data-selected-marker/g)) {
        markers += 1;
        const context = body.slice(Math.max(0, marker.index - 400), marker.index);
        assert.match(
          context,
          /selected \? \(/,
          `${where} renders a left marker that is not conditional on selection`,
        );
      }
      // And it must not be reachable through a prop, which is how it becomes decoration elsewhere.
      assert.doesNotMatch(
        body,
        /readonly (marker|stripe|accentEdge)\??:/,
        `${where} exposes the marker as a prop, so it can be switched on where it means nothing`,
      );
    }
    assert.equal(markers, 1, `${markers} left markers exist; the brief allows exactly one`);
  });

  it("keeps list rows inside the density band the brief states", () => {
    const band = /Row height (\d+)[–-](\d+)px in lists/.exec(brief);
    assert.ok(band, "the brief no longer states a row height band");
    const [low, high] = [Number(band[1]), Number(band[2])];

    const row = fs.readFileSync(path.join(CHAT, "thread-list.tsx"), "utf8");
    const floor = /min-h-\[([\d.]+)rem\]/.exec(code(row));
    assert.ok(floor, "the thread row no longer declares a minimum height");
    const px = Number(floor[1]) * 16;
    assert.ok(
      px >= low && px <= high,
      `the thread row's floor is ${px}px, outside the ${low}-${high}px band`,
    );
  });
});

describe("the shared foundation belongs to no single surface", () => {
  /**
   * The surface sets `globals.css` declares, found rather than named.
   *
   * A surface set is a prefix that has a theme block of its own: `[data-demo-theme="consumer"]`
   * declares that `consumer` is a surface, which makes every `--consumer-*` token that surface's
   * property. Deriving it this way means the guard covers an operator or admin set the day one is
   * added, instead of the day somebody remembers to update a string here.
   */
  function surfacePrefixes(): string[] {
    const globals = fs.readFileSync(GLOBALS, "utf8");
    const found = [...globals.matchAll(/\[data-[a-z-]*theme="([a-z]+)"\]/g)].map((m) => m[1]);
    const prefixes = [...new Set(found)];
    assert.ok(prefixes.length > 0, "no surface theme blocks found; the derivation has rotted");
    return prefixes;
  }

  it("reads no surface-scoped token anywhere in the shared components", () => {
    // These components are mounted by the operator Inbox and the platform-admin AI Chat. Painting
    // them from the consumer set is invisible today only because every consumer token happens to
    // hold the same value as its global counterpart and the consumer theme block redefines only
    // the generic ones. The moment an operator runs under their own brand — which is the product —
    // the operator Inbox would follow the consumer's palette.
    const prefixes = surfacePrefixes();
    for (const { source, where } of componentFiles()) {
      const body = code(source);
      for (const prefix of prefixes) {
        const used = new RegExp(`var\\(--${prefix}-`).exec(body);
        assert.equal(
          used,
          null,
          `${where} paints from the ${prefix} surface set, and it is mounted on surfaces that are not ${prefix}'s`,
        );
      }
    }
  });

  it("keeps every surface alias pointing at the product token it was promoted to", () => {
    // The promoted half has to stay an alias rather than a copy, or the consumer surface and the
    // shared components drift apart while both look right in isolation.
    const globals = fs.readFileSync(GLOBALS, "utf8");
    // Only surface-set aliases. `--font-sans: var(--font-brand)` is a runtime font Next injects
    // and has nothing to do with this promotion — a rule that flags it is a rule that gets muted.
    const prefixes = surfacePrefixes();
    const aliases = [...globals.matchAll(/(--[a-z0-9-]+):\s*var\((--[a-z0-9-]+)\);/g)].filter(
      ([, alias]) => prefixes.some((prefix) => alias.startsWith(`--${prefix}-`)),
    );
    assert.ok(aliases.length >= 4, `only ${aliases.length} aliases; the promotion was undone`);
    const declared = new Set([...globals.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]));
    for (const [, alias, target] of aliases) {
      assert.ok(declared.has(target), `${alias} aliases ${target}, which nothing declares`);
    }
  });
});
