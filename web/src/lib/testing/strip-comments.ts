/**
 * The one comment stripper the source-scanning guards share.
 *
 * A guard that reads a `.ts` file as text and asserts something about the content is reading the
 * file's commentary too, and this codebase's commentary is unusually specific: a docblock here
 * routinely quotes the string it replaced, names the panel it deleted, or spells out the mount it
 * explains. That produces two failures and they are not symmetric. A guard asserting a string is
 * present can be satisfied by prose while the code it meant to check is empty, which is silent. A
 * guard asserting a string is absent, or counting occurrences, or checking order, is defeated by
 * the comment that honestly records what a module superseded — so the suite ends up punishing the
 * comment most worth keeping, and the failure reads like a real defect.
 *
 * Before this module every caller carried its own stripper and twelve of them carried the same
 * one: a non-greedy block-comment regex, then `.replace(/^\s*\/\/.*$/gm, " ")`. That pair has a
 * hole and a hazard. The hole is the `^\s*` anchor, which only reaches a comment occupying a whole
 * line, so `const MAX = 216;` followed by a trailing `// per feedback #191` survives — and `#191`
 * is three valid hex digits, which is enough to fail a guard looking for hardcoded colours. The
 * hazard is the other half: a block-comment regex does not know what a string literal is, so the
 * day a source file holds an opening comment marker inside a string, the stripper eats real code
 * from there to the next closing marker. The anchor that leaves the hole is also what was
 * accidentally covering the second hazard, since an anchored `//` cannot match the one inside a
 * `https:` URL. Widening the regex to close the hole would have opened that one.
 *
 * So this is a character scanner rather than a pair of regexes: it walks the file once and knows
 * which construct it is inside, which is the only way to be right about all three at once.
 *
 * ## Where the traversal came from, and why it is not the one this file shipped with
 *
 * The literal walking below — strings, template literals with nested `${}` substitutions, and
 * regex literals — is lane 4b's, taken from `web/src/components/assistant/strip-comments.ts` at
 * `57bd897` and adapted to blank in place. Two scanners were written to F-24 in parallel, neither
 * knowing about the other, and the differential over real files (F-34) is what settled which
 * traversal is correct. This one's original was wrong in a way that mattered: it tracked strings
 * and templates but not regex literals, and a regex whose body ends in an escaped slash presents a
 * bare `//` to a scanner not watching for one. `src/lib/vault/sync.ts:79` is the live case —
 *
 *     if (channel.type === "online" && !/^https:\/\//i.test(value)) return null;
 *
 * — where the old scanner read `\/\/` plus the closing delimiter as the start of a line comment
 * and blanked `.test(value)) return null;` out of the file. Not a comment surviving a strip: a
 * guard handed source with live code missing, which is the false-pass direction, produced by the
 * module written to close false passes. It reached 43 files.
 *
 * ## What this side kept, and why it is not lane 4b's module verbatim
 *
 * **Length is preserved.** Every stripped character becomes a space and newlines are kept, so
 * offsets, line numbers and column numbers still map to the original file. Lane 4b's builds a new
 * string and collapses a comment to a single space, which is fine for its own two callers — they
 * only need line numbers, and newlines survive there too. It is not fine for the three CI
 * scanners, which match against the stripped copy and then call `lineOf(rawSource, matchIndex)`;
 * with offsets shifted every reported line would be wrong. `verify-source-gates.mjs`,
 * `verify-no-auto-send.mjs` and `verify-ai-transport.mjs` all do exactly that.
 *
 * **There are two entry points.** `verify-no-auto-send.mjs` needs strings kept for rule 1, strings
 * blanked for rules 2 to 4, and `--` honoured for rule 1's SQL branch — three behaviours out of
 * one module, which a single exported function cannot give it.
 */

export interface StripOptions {
  /**
   * Also treat `-- …` as a line comment.
   *
   * SQL only, and off by default, because `--` is the decrement operator in TypeScript: a scanner
   * that always honoured it would blank the rest of the line on `while (remaining--)`. That is not
   * hypothetical — it is F-32. `verify-no-auto-send.mjs` carried a copy of this scanner that
   * honoured `--` everywhere, and a `setTimeout` resend sharing a line with a decrement was
   * invisible to the rule that exists to forbid it while the identical statement on its own line
   * was caught. Rail 1 defeated by one character, in the gate that holds it.
   *
   * Turning this on also turns regex-literal detection off, because SQL has no regex literals and
   * does have division: `select 1/2, 3/4` would otherwise read as a regex spanning `2, 3`.
   */
  readonly sql?: boolean;
}

/**
 * Whether a `/` appearing after `previous` starts a regex literal rather than a division.
 *
 * Lane 4b's heuristic, kept with its reasoning. A regex may begin only where an expression may
 * begin — after an operator, an opening bracket, a comma, a semicolon, or nothing at all. After a
 * value (an identifier character, a closing bracket, a string) the slash is division. It is wrong
 * for a few exotic cases (`return /re/` reads as division, since `n` is an identifier character),
 * and those cases are wrong in the safe direction: the scanner then treats the regex body as
 * ordinary text and leaves it alone, which is what a guard reading the source wanted anyway.
 *
 * `adjacent` is the character physically before the slash, which `previous` cannot supply because
 * it skips whitespace — and the difference is the whole point. `<` has to stay in the set, since
 * `a < /re/.test(x)` is legal, but in a `.tsx` file `</` is a closing tag: the scanner would open a
 * regex on `</p>`, find its closing delimiter in the first slash of a trailing `//`, and read the
 * comment marker as regex body while everything after it is scanned as code — so the comment
 * survives the strip, silently, in the false-negative direction. A closing tag never has whitespace
 * between the two characters and a comparison against a regex effectively always does, so refusing
 * only the adjacent case keeps `<` without trading this for a false positive.
 */
function regexCanStart(previous: string, adjacent: string): boolean {
  if (previous === "<" && adjacent === "<") return false;
  return previous === "" || "(,=:[!&|?{};+-*%~^<>".includes(previous);
}

function scan(source: string, blankStrings: boolean, sql: boolean): string {
  const out = source.split("");
  const blank = (from: number, to: number): void => {
    for (let i = from; i < to && i < out.length; i += 1) if (out[i] !== "\n") out[i] = " ";
  };
  const toLineEnd = (index: number): number => {
    const end = source.indexOf("\n", index);
    return end === -1 ? source.length : end;
  };

  let index = 0;
  /** The last non-whitespace character passed over as code, which is all the regex heuristic needs. */
  let previous = "";
  const note = (character: string): void => {
    if (!/\s/.test(character)) previous = character;
  };
  /** One entry per open `${`, holding the brace depth at which that substitution closes. */
  const substitutions: number[] = [];
  let braceDepth = 0;
  let templateDepth = 0;

  /**
   * Walk a template literal's text until it ends or a substitution opens.
   *
   * Returns when `templateDepth` has dropped (the template closed) or a `${` was consumed, at
   * which point control belongs to the main loop again so the substitution's own expression is
   * scanned as code — a comment inside `${}` is a comment, and a string inside it is a string.
   */
  const walkTemplateText = (): void => {
    while (index < source.length && templateDepth > 0) {
      if (source[index] === "\\") {
        if (blankStrings) blank(index, index + 2);
        index += 2;
        continue;
      }
      if (source[index] === "`") {
        index += 1;
        templateDepth -= 1;
        previous = "`";
        return;
      }
      if (source[index] === "$" && source[index + 1] === "{") {
        index += 2;
        substitutions.push(braceDepth);
        braceDepth += 1;
        previous = "{";
        return;
      }
      if (blankStrings) blank(index, index + 1);
      index += 1;
    }
  };

  while (index < source.length) {
    const character = source[index];
    const following = source[index + 1] ?? "";

    if ((character === "/" && following === "/") || (sql && character === "-" && following === "-")) {
      const end = toLineEnd(index);
      blank(index, end);
      index = end;
      continue;
    }

    if (character === "/" && following === "*") {
      const close = source.indexOf("*/", index + 2);
      const end = close === -1 ? source.length : close + 2;
      blank(index, end);
      index = end;
      continue;
    }

    if (character === '"' || character === "'") {
      const start = index;
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += 2;
          continue;
        }
        if (source[index] === character) {
          index += 1;
          break;
        }
        // An unterminated string ends at the newline rather than eating the rest of the file.
        if (source[index] === "\n") break;
        index += 1;
      }
      if (blankStrings) blank(start + 1, index - 1 >= start + 1 ? index - 1 : start + 1);
      previous = character;
      continue;
    }

    if (character === "`") {
      index += 1;
      templateDepth += 1;
      walkTemplateText();
      continue;
    }

    if (character === "{") {
      braceDepth += 1;
      note("{");
      index += 1;
      continue;
    }

    if (character === "}") {
      braceDepth -= 1;
      note("}");
      index += 1;
      if (substitutions.length > 0 && substitutions[substitutions.length - 1] === braceDepth) {
        substitutions.pop();
        // The substitution closed, so the rest of the template resumes as literal text.
        walkTemplateText();
      }
      continue;
    }

    if (!sql && character === "/" && regexCanStart(previous, source[index - 1] ?? "")) {
      const start = index;
      index += 1;
      let inClass = false;
      let closed = false;
      while (index < source.length) {
        const inner = source[index];
        if (inner === "\\") {
          index += 2;
          continue;
        }
        if (inner === "\n") break;
        if (inner === "[") inClass = true;
        else if (inner === "]") inClass = false;
        else if (inner === "/" && !inClass) {
          index += 1;
          closed = true;
          break;
        }
        index += 1;
      }
      if (!closed) {
        // Not a regex after all — a lone slash. Step back and carry on from the next character.
        index = start + 1;
        previous = "/";
        continue;
      }
      // A regex body is code, not text: it is left alone even by the stronger strip, because the
      // guards that blank strings are looking for call shapes and a pattern is part of one.
      previous = "/";
      continue;
    }

    note(character);
    index += 1;
  }

  return out.join("");
}

/**
 * Blank comments; leave string bodies as they are.
 *
 * The default for a guard that asserts about code, because in TypeScript the thing being looked
 * for is very often a string literal — a route path, a table name, an RPC name, a piece of copy —
 * and blanking strings would blind the guard to the call sites it exists to find. Rule 1 of
 * `verify-no-auto-send.mjs` is the worked example: the send RPC reaches the client as a string, so
 * the stronger strip would have hidden every real caller while the raw text let any comment naming
 * the seam fail the gate.
 */
export function stripComments(source: string, options: StripOptions = {}): string {
  return scan(source, false, options.sql === true);
}

/**
 * Blank comments and string bodies both.
 *
 * For a guard whose subject is structure rather than content — an import graph, a call shape, a
 * schema — where a literal that happens to contain the pattern is a false positive rather than the
 * hit being looked for. Use it only when a match inside a string would be wrong, since it is the
 * strip that can hide a real answer.
 */
export function stripCommentsAndStrings(source: string, options: StripOptions = {}): string {
  return scan(source, true, options.sql === true);
}
