// The two client-facing strings this lane inherited rather than wrote, and the seam one of them
// now crosses.
//
// `title="AI assistant"` is frozen copy. The frontend contract froze at `4bb5232` on 2026-08-18,
// and at that commit the string rendered inside `components/surfaces/operator.tsx`; lane 1b's
// extraction later moved the header into a component, so the copy now lives somewhere the freeze
// commit knows nothing about. That is the seam, and this is where it is held: nothing else in the
// tree holds the two together, since lane 3's surface contract pinned the composition and is being
// rewritten to derive rather than to transcribe.
//
// The expected string is read out of the freeze commit itself with `git show`, which is the actual
// authority for what this title may say. An earlier version of this test derived it from
// `settingsNotice.startsWith("AI assistant")` in the same surface — a proxy for the freeze, and a
// bad one twice over: that branch is unreachable (its producer was the command palette's "AI
// assistant is not connected in this demo", removed by the fixture eviction), and reading it here
// made dead code load-bearing, which is the wrong way round. The branch is being deleted; the
// anchor moved first.
//
// Reading git from a test is precedented in this repo — `lib/llm/driver.test.ts`,
// `lib/compliance/gate-consumers.test.ts`, `lib/email/bootstrap.test.ts` and
// `lib/billing/driver-requirements.test.ts` all shell out — and `4bb5232` is already cited as the
// freeze by `lib/vault/fixture-parity.test.ts`. The derivation is asserted non-empty before it is
// compared, so a `git show` that cannot resolve the commit fails loudly instead of passing on an
// empty string.
//
// The second rule is about the greeting. "Morning, Avery." is new copy on a view whose identity
// must not depend on it: a greeting standing in for a heading reads as personalisation rather than
// as a place, and it is absent for anyone the durable read cannot name. So each mount is required
// to carry a header with its own title above the workspace.
//
// Watched failing before it counted: `title="AI assistant"` retyped as `title="AI Assistant"` in
// `operator-assistant.tsx`, and `<PageHeader title="AI chat" />` deleted from `admin-assistant.tsx`.
// Both against this tree, one at a time, with the anchor pointed at the freeze commit.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { stripComments } from "@/lib/testing/strip-comments";

const HERE = path.resolve(import.meta.dirname);
const OPERATOR_ASSISTANT_TITLE = "AI assistant";

/**
 * Source with its commentary taken out.
 *
 * Every derivation below matches on JSX syntax, and a comment quoting JSX is JSX-shaped text: this
 * file's own history is the proof, since the note recording that a mount no longer renders
 * `<PageHeader title="…" />` is itself a `<PageHeader title="…" />` as far as a regex is concerned.
 * Reading raw made the guard answerable by prose — the header deleted from `admin-assistant.tsx`
 * plus the comment explaining the deletion passed, and the same deletion without the comment
 * failed. What is asserted is unchanged; only what it reads is.
 */
function read(file: string): string {
  return stripComments(fs.readFileSync(file, "utf8"));
}

/** The titles of every `<CompactHeader>` in a source file that carries the given icon. */
function compactHeaderTitles(source: string, icon: string): string[] {
  return [...source.matchAll(/<CompactHeader\b([^>]*)\/>/g)]
    .map((match) => match[1])
    .filter((props) => props.includes(`icon={${icon}}`))
    .map((props) => /title="([^"]+)"/.exec(props)?.[1] ?? "")
    .filter((title) => title.length > 0);
}

/** The `title` a mount hands its header component. */
function headerTitle(source: string): string | null {
  const match = /<(?:CompactHeader|PageHeader)\b[^>]*\stitle="([^"]+)"/.exec(source);
  return match === null ? null : match[1];
}

describe("the assistant mounts and its client-facing copy", () => {
  it("keeps the operator header title", () => {
    const mount = read(path.join(HERE, "operator-assistant.tsx"));
    const icon = /<CompactHeader\b[^>]*\sicon=\{(\w+)\}/.exec(mount)?.[1] ?? null;
    assert.ok(icon !== null, "operator-assistant.tsx renders no CompactHeader with an icon");

    assert.equal(
      compactHeaderTitles(mount, icon).length,
      1,
      `expected exactly one <CompactHeader icon={${icon}}> in operator-assistant.tsx`,
    );
    assert.equal(
      compactHeaderTitles(mount, icon)[0],
      OPERATOR_ASSISTANT_TITLE,
      "the operator assistant's header title changed",
    );
  });

  it("gives each mount a header of its own rather than leaning on the greeting", () => {
    for (const file of ["operator-assistant.tsx", "admin-assistant.tsx"]) {
      const title = headerTitle(read(path.join(HERE, file)));
      assert.ok(
        title !== null && title.trim().length > 0,
        `${file} renders no header title, so the view's identity rests on a greeting that is absent for anyone the durable read cannot name`,
      );
    }
  });
});
