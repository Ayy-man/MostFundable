/**
 * The two draft-send rules, driven rather than described.
 *
 * The statuses come out of the parser's own closed set at test time, so a fifth status added to
 * `held_drafts` fails here until somebody decides whether it may be sent — which is the property
 * the old single-line `draft.status === "approved"` check inside a component could not have.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { canSendHeldDraft, pairingFor, type SendableDraft } from "./draft-send";

/** Every status the rail's parser accepts, read where it is declared. */
const STATUSES: SendableDraft["status"][] = (() => {
  const rail = readFileSync(
    new URL("../operator/support-inbox.client.ts", import.meta.url),
    "utf8",
  );
  const declared = /const DRAFT_STATUSES = new Set\(\[([^\]]*)\]\)/.exec(rail);
  assert.ok(declared, "the rail no longer declares DRAFT_STATUSES");
  const statuses = [...declared[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(statuses.length > 2, "DRAFT_STATUSES parsed as almost nothing");
  return statuses as SendableDraft["status"][];
})();

const BODY = "Thanks for the update. I will look at it after the next scheduled source update.";

function draft(over: Partial<SendableDraft> = {}): SendableDraft {
  return { body: BODY, id: "draft-handle", status: "approved", ...over };
}

describe("a draft that is not approved is never sent", () => {
  /**
   * Watched failing against a planted mutation: `status !== "discarded"` in `canSendHeldDraft`,
   * which is the shape the rule rots into — a check that names the bad cases it happens to know
   * about instead of the one good case.
   */
  it("permits exactly the approved status and no other", () => {
    const permitted = STATUSES.filter((status) =>
      canSendHeldDraft(draft({ status }), { locked: false }),
    );
    assert.deepEqual(permitted, ["approved"]);
  });

  it("refuses every status while the composer is locked", () => {
    for (const status of STATUSES) {
      assert.equal(
        canSendHeldDraft(draft({ status }), { locked: true }),
        false,
        `a \`${status}\` draft is sendable on a locked conversation`,
      );
    }
  });

  it("refuses when there is no draft at all", () => {
    assert.equal(canSendHeldDraft(null, { locked: false }), false);
  });
});

describe("an edited draft is a human message", () => {
  /**
   * Watched failing against a planted mutation: comparing `body.trim() === draft.body.trim()`,
   * which looks harmless and is exactly the drift migration 101 refuses — it compares byte for
   * byte, so a trailing newline the person added would pair here and 422 there.
   */
  it("pairs only a body that matches the stored one exactly", () => {
    const stored = draft();
    assert.equal(pairingFor(BODY, stored, { locked: false }), stored.id);
    for (const edited of [`${BODY} `, ` ${BODY}`, `${BODY}\n`, BODY.replace(".", "!"), ""]) {
      assert.equal(
        pairingFor(edited, stored, { locked: false }),
        null,
        `an edited body still carried the pairing: ${JSON.stringify(edited)}`,
      );
    }
  });

  it("never pairs a body the draft rules would not send", () => {
    // The two rules compose in one direction only: anything rule 1 refuses, rule 2 refuses too.
    for (const status of STATUSES) {
      for (const locked of [false, true]) {
        const stored = draft({ status });
        const paired = pairingFor(BODY, stored, { locked });
        assert.equal(
          paired !== null,
          canSendHeldDraft(stored, { locked }),
          `pairing and sendability disagree for \`${status}\`, locked=${locked}`,
        );
      }
    }
  });

  it("has no draft to pair against", () => {
    assert.equal(pairingFor(BODY, null, { locked: false }), null);
  });
});

// ---------------------------------------------------------------------------------------------
// One copy of each rule, enforced by a walk rather than by discipline
// ---------------------------------------------------------------------------------------------

/**
 * `support-thread-view.tsx`'s own header said a second copy of these rules would be a second place
 * to lose one of them, and then a second surface arrived. These two assertions are what stop the
 * next surface from writing its own: they walk every non-test module under `src`, discover which
 * ones state a rule inline, and require the set to be exactly this module.
 *
 * Neither lists a file. A new composer path that re-inlines either rule fails here on the commit
 * that introduces it, which is the only point at which it is cheap to fix.
 */
function sourceFiles(): { path: string; body: string }[] {
  const root = path.join(process.cwd(), "src");
  const found: { path: string; body: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        found.push({ body: readFileSync(full, "utf8"), path: path.relative(root, full) });
      }
    }
  };
  walk(root);
  assert.ok(found.length > 100, "the source walk found almost nothing; the tree moved");
  return found;
}

describe("each rule has exactly one home", () => {
  /**
   * Watched failing by restoring `draft.status === "approved"` in the Inbox's `draftHold`, which
   * is where the second copy actually was before this module existed.
   */
  it("states the approval rule in one module only", () => {
    // A draft is the only row in this product whose `status` can be `approved`; a thread's is
    // open, pending or resolved, and an application's outcome is a different field. So this
    // literal is the rule, wherever it appears.
    const authors = sourceFiles()
      .filter((file) => /\.status\s*===\s*"approved"/.test(file.body))
      .map((file) => file.path);
    assert.deepEqual(authors, ["lib/support/draft-send.ts"]);
  });

  /**
   * Watched failing by adding `if (body === draft.body)` to the Inbox's held-draft send, which is
   * the shape rule 2 rots into — a comparison that looks right and drifts from migration 101's the
   * first time somebody adds a `.trim()` to one side.
   */
  it("compares a draft body against an outgoing one in one module only", () => {
    const authors = sourceFiles()
      .filter((file) =>
        /(===|!==)\s*\w*[Dd]raft[!?]?\.body|\w*[Dd]raft[!?]?\.body\s*(===|!==)/.test(file.body),
      )
      .map((file) => file.path);
    assert.deepEqual(authors, ["lib/support/draft-send.ts"]);
  });

  it("is imported rather than reimplemented wherever it is used", () => {
    // Every caller reaches these through the module path. A local re-export or a copied helper of
    // the same name would satisfy a check for the identifier alone.
    const callers = sourceFiles().filter((file) =>
      /\b(canSendHeldDraft|pairingFor)\s*\(/.test(file.body),
    );
    assert.ok(callers.length > 1, "nothing outside this module calls the rules any more");
    for (const file of callers) {
      if (file.path === "lib/support/draft-send.ts") continue;
      assert.match(
        file.body,
        /from "@\/lib\/support\/draft-send"/,
        `${file.path} uses the rules without importing them from the module that owns them`,
      );
    }
  });
});
