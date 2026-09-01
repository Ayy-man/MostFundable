// The three cases the shared stripper exists to get right, each watched failing against a
// deliberately naive implementation before it counted.
//
// The two naive strippers below are not strawmen. `anchored` is verbatim what twelve guards in
// this tree carried before this module, and `unanchored` is the obvious one-character repair for
// the hole `anchored` has. They fail on opposite inputs, which is the whole argument for a
// character scanner: there is no regex pair that passes all three, because the anchor that lets
// `anchored` survive a URL is the same anchor that lets a trailing comment through, and removing
// it to catch the trailing comment is what eats the URL. Each test asserts the real behaviour and
// then asserts that at least one naive stripper gets it wrong, so if somebody later "simplifies"
// this module back into regexes the case that motivated it fails by name.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { stripComments, stripCommentsAndStrings } from "./strip-comments.ts";

// fileURLToPath, never URL.pathname: the real repository path contains a space, which
// `URL.pathname` percent-encodes, and six guards reported green over ENOENT before F-26 caught it.
const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Every source file in the tree, so the property cases below are derived rather than sampled. */
function treeSources(): Array<{ name: string; source: string }> {
  const found: Array<{ name: string; source: string }> = [];
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== ".next") walk(absolute);
        continue;
      }
      if (!/\.(ts|tsx|mjs)$/.test(entry.name)) continue;
      found.push({
        name: path.relative(WEB_ROOT, absolute).split(path.sep).join("/"),
        source: fs.readFileSync(absolute, "utf8"),
      });
    }
  };
  for (const root of ["src", "scripts"]) walk(path.join(WEB_ROOT, root));
  return found;
}

/** What twelve guards carried before this module. */
function anchored(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

/** The tempting repair for `anchored`'s hole: drop the line anchor so trailing comments go too. */
function unanchored(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

// Built at runtime so this file can describe the markers without containing them: a block-comment
// terminator written literally inside a docblock ends the docblock, which is the same class of
// mistake as the one under test and cost a first draft of the module it guards.
const OPEN = `${"/"}*`;
const CLOSE = `*${"/"}`;

describe("the shared stripper", () => {
  it("removes a comment trailing real code on the same line", () => {
    // The hole proved on `chat/composer.tsx`: `#191` is a client feedback item, and it is also
    // three valid hex digits, so a guard hunting hardcoded colours read it as one.
    const source = 'const MAX_TEXTAREA_PX = 216; // wording per client feedback #191';

    assert.equal(stripComments(source).includes("#191"), false);
    assert.equal(anchored(source).includes("#191"), true, "the anchored stripper has stopped leaking trailing comments, so this case no longer motivates the scanner");
  });

  it("leaves a `//` inside a string literal alone", () => {
    const source = 'const platformTrainingsUrl = "https://example.invalid/trainings";';

    assert.equal(stripComments(source), source, "a URL is code, not commentary");
    assert.equal(unanchored(source).includes("example.invalid"), false, "the unanchored stripper has stopped eating URLs, so the anchor trade-off this module resolves no longer exists");
  });

  it("leaves a block-comment marker inside a string literal alone", () => {
    // Not live in the tree today, which is exactly why it is pinned here: the regex strippers
    // would eat every character from the literal to the next terminator, and the first file to
    // hold this string would take real code with it silently.
    const source = `const glob = "${OPEN}"; const stillHere = "load-bearing"; const end = "${CLOSE}";`;

    assert.equal(stripComments(source).includes("load-bearing"), true);
    assert.equal(anchored(source).includes("load-bearing"), false, "the anchored stripper has learned about string literals, which would make this module redundant");
  });

  it("preserves offsets so a reported position still maps to the source", () => {
    const source = "const a = 1;\nconst b = 2; // note\nconst c = 3;";
    const stripped = stripComments(source);

    assert.equal(stripped.length, source.length);
    assert.equal(stripped.split("\n").length, source.split("\n").length);
    assert.equal(stripped.indexOf("const c"), source.indexOf("const c"));
  });

  it("blanks string bodies only when asked, and keeps the quotes either way", () => {
    const source = 'const table = "profiles"; // the roster';

    assert.equal(stripComments(source).includes("profiles"), true, "the default strip must not blind a guard to a string it is looking for");
    assert.equal(stripCommentsAndStrings(source).includes("profiles"), false);
    assert.match(stripCommentsAndStrings(source), /"\s{8}"/, "the delimiters survive, spanning the width of what they held, so the shape of the expression and every later offset still line up");
  });

  it("treats `--` as a comment only for SQL, because TypeScript spells decrement that way", () => {
    const ts = "while (remaining--) drain();";
    const sql = "select 1; -- migration 101 adds the send function";

    assert.equal(stripComments(ts), ts);
    assert.equal(stripComments(sql, { sql: true }).includes("migration 101"), false);
    assert.equal(stripComments(sql).includes("migration 101"), true, "the SQL rule must stay opt-in");
  });

  it("walks a regex literal whole, so a slash inside one cannot open a comment", () => {
    // F-34, and the reason this module's traversal is lane 4b's rather than its first draft. The
    // pattern ends `\/\/` before its closing delimiter, which presents a bare `//` to a scanner
    // that is not tracking regex literals — and the rest of the line goes. Live at
    // `src/lib/vault/sync.ts:79` for as long as the old scanner was the shared one.
    const source = 'if (channel.type === "online" && !/^https:\\/\\//i.test(value)) return null;';

    assert.equal(stripComments(source), source, "a regex body is code and nothing in it is a comment");
    assert.equal(
      stripComments(source).includes(".test(value)) return null;"),
      true,
      "the scanner has stopped tracking regex literals and is deleting live code again",
    );
    assert.equal(
      unanchored(source).includes(".test(value)) return null;"),
      false,
      "the unanchored stripper has learned about regex literals, which would make this case moot",
    );
  });

  it("does not mistake division for a regex, in either language", () => {
    // The heuristic only opens a regex where an expression may begin. After a value a slash is
    // division, and an unterminated candidate falls back to a lone slash rather than eating the
    // line — which is what keeps SQL safe, where `--` is on and regex literals do not exist.
    const division = "const ratio = total / count; // the note";
    const sql = "select 1/2, 3/4 from t; -- the note";

    assert.equal(stripComments(division).includes("total / count"), true);
    assert.equal(stripComments(division).includes("the note"), false);
    assert.equal(stripComments(sql, { sql: true }).includes("1/2, 3/4"), true, "SQL division read as a regex would blank real columns");
    assert.equal(stripComments(sql, { sql: true }).includes("the note"), false);
  });

  it("does not let a JSX closing tag open a regex that swallows a trailing comment", () => {
    // `</` is a closing tag, not a comparison against a regex. Reading it as one finds the closing
    // delimiter in the first slash of a trailing `//`, so the comment marker becomes regex body and
    // the comment survives — a false negative in the direction that ships. Both directions here:
    // the tag must strip, and a genuine `<`-preceded regex must still be walked whole.
    const tag = "<p>{label}</p> // the note";
    const bare = "</p> // the note";
    // The comparison carries an apostrophe on purpose. Asserting the pattern text merely survives
    // proves nothing, because text nobody recognises is left alone too — dropping `<` from the set
    // wholesale, the fix this one was chosen over, passes that assertion. A quote inside the body
    // discriminates: read as a regex it is inert, read as ordinary code it opens a string literal
    // that runs to the newline and takes the trailing comment inside it, so the comment survives.
    const comparison = "const ok = n < /don't/.test(s); // the note";

    assert.equal(stripComments(tag).includes("the note"), false, "a closing tag opened a phantom regex");
    assert.equal(stripComments(tag).includes("{label}</p>"), true, "the markup itself is code and stays");
    assert.equal(stripComments(bare).includes("the note"), false);
    assert.equal(stripComments(comparison).includes("/don't/"), true, "a real regex after `<` must survive whole");
    assert.equal(stripComments(comparison).includes("the note"), false, "the regex body was read as code and opened a string");
  });

  it("keeps a comment inside a template substitution strippable, and the template text intact", () => {
    const source = "const label = `client ${/* the id, never shown */ name} is ready`;";
    const stripped = stripComments(source);

    assert.equal(stripped.includes("never shown"), false, "a comment is a comment inside `${}` too");
    assert.equal(stripped.includes("client "), true, "template text is not commentary");
    assert.equal(stripped.includes("is ready"), true);
    assert.equal(stripped.includes("name"), true, "a substitution is code and must survive the default strip");
  });

  /**
   * The property the three CI scanners depend on, asserted the way they use it.
   *
   * `verify-source-gates.mjs`, `verify-no-auto-send.mjs` and `verify-ai-transport.mjs` all match a
   * pattern against the stripped copy and then report `lineOf(rawSource, matchIndex)`. That is only
   * sound while offsets are preserved, and it is the single reason this module blanks in place
   * rather than rebuilding the string the way lane 4b's does. A stripped comment sits above the
   * match here on purpose: that is the arrangement that shifts an index if anything does.
   */
  it("maps a match index in the stripped copy to the right line of the raw source", () => {
    const lineOf = (source: string, offset: number) => source.slice(0, offset).split("\n").length;
    const source = [
      "const a = 1;",
      "/**",
      " * A docblock that mentions setTimeout( without calling it, and runs on for a while so that",
      " * any length change between the raw file and the stripped copy would move what follows.",
      " */",
      "const b = 2; // and a trailing comment naming setTimeout( as well",
      "queueMicrotask(() => send());",
    ].join("\n");

    const stripped = stripComments(source);
    const index = stripped.indexOf("queueMicrotask(");

    assert.notEqual(index, -1, "the call the scanners would match on is gone from the stripped copy");
    assert.equal(stripped.length, source.length, "offsets only survive while length does");
    assert.equal(lineOf(source, index), 7, "the reported line must be the line the reader has open");
    assert.equal(source.split("\n")[lineOf(source, index) - 1], "queueMicrotask(() => send());");
    // And the prose above it is genuinely gone, so the scanners are not matching on it.
    assert.equal(stripped.includes("setTimeout("), false);
  });
});

/**
 * The two properties asserted over the real tree rather than over examples.
 *
 * Both exist because the alternative is an emergent property, and a scanner that keeps offsets by
 * accident will lose them in the next edit with nothing to say so. Derived from the tree for the
 * round-5 reason: a fixed list of sample strings is a transcription of the cases somebody thought
 * of, and the interesting input is always the one nobody thought of.
 */
describe("the shared stripper, over every source file in the tree", () => {
  const sources = treeSources();

  it("reads a tree at all, so neither case below can pass over nothing", () => {
    assert.ok(sources.length > 500, `only ${sources.length} source files found; the walk is broken`);
  });

  it("preserves length and line count on every file, which is what makes `lineOf` valid", () => {
    // `verify-source-gates.mjs`, `verify-no-auto-send.mjs` and `verify-ai-transport.mjs` match
    // against the stripped copy and report `lineOf(rawSource, matchIndex)`. Blanking in place is
    // what makes that sound; a rewrite to splicing would break all three silently.
    const wrong = sources.filter(
      ({ source }) =>
        stripComments(source).length !== source.length ||
        stripCommentsAndStrings(source).length !== source.length ||
        stripComments(source).split("\n").length !== source.split("\n").length,
    );
    assert.deepEqual(wrong.map(({ name }) => name), [], "the scanner has stopped blanking in place");
  });

  it("never eats a division, which is the failure the regex heuristic invites", () => {
    // The inverse of the regex-literal case and the one a fix for it is most likely to introduce:
    // `regexCanStart` decides from the preceding token whether a `/` opens a literal, and an
    // over-eager `yes` swallows `a / b` forward to the next slash. Same blanking, opposite trigger,
    // and invisible to any check that only exercises the case just fixed.
    //
    // The sites are the tree's own divisions, so this grows as the codebase does.
    const DIVISION = /[\w)\]]\s*\/\s*[\w(]/;
    const damaged: string[] = [];
    let sites = 0;

    for (const { name, source } of sources) {
      const rawLines = source.split("\n");
      const outLines = stripComments(source).split("\n");
      for (let index = 0; index < rawLines.length; index += 1) {
        const raw = rawLines[index];
        if (!DIVISION.test(raw)) continue;
        // A line the scanner blanked entirely was commentary, not code with a division in it.
        if (outLines[index].trim() === "") continue;
        // A JSX comment opens with `{` before its marker, so the surviving `{` is not damage.
        if (/^\s*\{\s*\/\*/.test(raw)) continue;
        sites += 1;
        const commentAt = raw.indexOf("//");
        const codeWidth = commentAt >= 0 ? commentAt : raw.length;
        if (raw.slice(0, codeWidth) !== outLines[index].slice(0, codeWidth)) {
          damaged.push(`${name}:${index + 1}  ${raw.trim().slice(0, 90)}`);
        }
      }
    }

    assert.ok(sites > 1000, `only ${sites} division sites found; the derivation is not finding them`);
    assert.deepEqual(damaged, [], "the regex heuristic has become over-eager and is eating divisions");
  });
});
