// The two scope profiles, checked against the modules that decide what they are allowed to say.
//
// Three derivations, none of them a transcription of the table under test:
//
//   * The question-length bounds come from `lib/assistant/service.ts`, which is what the turns
//     route validates against. A suggestion whose question the route would reject with 400 is a
//     control that cannot act.
//   * The scope coverage comes from `assistantFooterForScope`'s own behaviour rather than from a
//     list: every scope the workspace can be mounted at must have a profile, and the set is read
//     off `SCOPE_PROFILES` and cross-checked against the footer function, so a third scope added to
//     the union and forgotten here fails.
//   * The "no fabricated figure" rule is checked as "no digit anywhere in a suggestion", which is
//     the mechanical half of the brief's rule that none may name a date or a count that did not
//     come from a durable read. A suggestion is written before any read has happened, so there is
//     no figure it could legitimately carry.
//   * "What it prints is what it asks" is derived from the suggestion's own field set rather than
//     stated: whatever fields the data carries have to be both the label and the argument in
//     `start.tsx`. The first build printed a three-word label over a fifteen-word question, so the
//     words somebody pressed were not the words that got sent, and that is the shape of thing a
//     later edit reintroduces by adding one convenient field.
//
// Watched failing before it counted, against this tree: adding `{ question: "Which clients changed
// in the last 30 days?" }` to the operator suggestions fails "carries no figure of its own";
// giving both scopes the same `placeholder` fails "says something different in each scope"; a
// suggestion with `question: ""` fails "every suggestion is a question the route would accept";
// and printing a second field in place of the question fails "prints the question it sends".

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { assistantFooterForScope } from "@/lib/assistant/types";
import { QUESTION_MAX_LENGTH, QUESTION_MIN_LENGTH } from "@/lib/assistant/service";

import { SCOPE_PROFILES, scopeProfile } from "./scope";

import type { AssistantScope } from "@/lib/assistant/types";

const SCOPES = Object.keys(SCOPE_PROFILES) as readonly AssistantScope[];

describe("the assistant scope profiles", () => {
  it("covers every scope the assistant can be mounted at", () => {
    assert.ok(SCOPES.length >= 2, `only ${SCOPES.length} scope profile(s); the table shrank`);
    for (const scope of SCOPES) {
      // The footer function is the other module keyed by the same union. If it answers for a scope
      // this table does not have, one of the two is behind.
      assert.doesNotThrow(() => assistantFooterForScope(scope), `${scope} is not a scope`);
      assert.equal(scopeProfile(scope).scope, scope, `${scope}'s profile names a different scope`);
    }
  });

  it("every suggestion is a question the route would accept", () => {
    for (const scope of SCOPES) {
      const profile = scopeProfile(scope);
      assert.ok(
        profile.suggestions.length >= 3,
        `${scope} offers ${profile.suggestions.length} suggestion(s)`,
      );
      const questions = profile.suggestions.map((suggestion) => suggestion.question);
      for (const question of questions) {
        const trimmed = question.trim();
        assert.ok(
          trimmed.length >= QUESTION_MIN_LENGTH && trimmed.length <= QUESTION_MAX_LENGTH,
          `${scope} offers a question the turns route would refuse: "${question}"`,
        );
      }
      // Two rows that do the same thing read as a mistake and are one.
      assert.equal(new Set(questions).size, questions.length, `${scope} repeats a question`);
    }
  });

  it("carries no figure of its own", () => {
    for (const scope of SCOPES) {
      for (const suggestion of scopeProfile(scope).suggestions) {
        for (const line of Object.values(suggestion)) {
          assert.doesNotMatch(
            String(line),
            /\d/,
            `${scope} offers a suggestion carrying a figure no read produced: "${String(line)}"`,
          );
        }
      }
    }
  });

  it("prints the question it sends", () => {
    // Derived from the data: whatever fields a suggestion carries, each one has to be both what the
    // control prints and what it asks. One field today, and a second added later has to be used in
    // both places or fail here.
    const fields = Object.keys(SCOPE_PROFILES.operator.suggestions[0]);
    assert.ok(fields.length > 0, "a suggestion carries no fields; the derivation checks nothing");

    const start = fs.readFileSync(path.join(import.meta.dirname, "start.tsx"), "utf8");
    for (const field of fields) {
      assert.ok(
        start.includes(`{suggestion.${field}}`),
        `start.tsx does not print suggestion.${field}, so a suggestion says something it does not ask`,
      );
      assert.ok(
        start.includes(`onAsk(suggestion.${field})`),
        `start.tsx does not send suggestion.${field}, so a suggestion asks something it does not say`,
      );
    }
  });

  it("says something different in each scope", () => {
    // One shell, two scopes — but a profile that is a copy of the other means the admin workspace
    // is telling a platform administrator about "your book".
    const distinct = ["title", "placeholder", "grounding", "composerLabel"] as const;
    for (const field of distinct) {
      const values = SCOPES.map((scope) => scopeProfile(scope)[field]);
      assert.equal(new Set(values).size, values.length, `every scope uses the same ${field}`);
    }
    for (const scope of SCOPES) {
      const profile = scopeProfile(scope);
      for (const [what, value] of [
        ["title", profile.title],
        ["grounding", profile.grounding],
        ["placeholder", profile.placeholder],
        ["disabled title", profile.disabled.title],
        ["disabled description", profile.disabled.description],
      ] as const) {
        assert.ok(value.trim().length > 0, `${scope} has an empty ${what}`);
      }
    }
  });
});
