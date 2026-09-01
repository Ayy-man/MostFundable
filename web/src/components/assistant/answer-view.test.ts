// The answer view, and the guard that keeps the not-advice line on screen.
//
// This is the file standing between the product and a silent compliance regression. The footer is
// a constant per scope that lives nowhere in the stored turn, so if the render site stops asking
// for it the line just stops appearing: no test fails, no type breaks, no route changes. The guard
// therefore has to be structural, and it is built in two halves that fail for different reasons.
//
// **The view always carries it.** `answerView(...).footer` is compared against
// `assistantFooterForScope(scope)` — the module that owns the words — for every scope, with a prior
// assertion that at least one scope has a non-null footer so the comparison cannot pass by both
// sides being null.
//
// **The component always prints it.** The set of fields checked against `answer.tsx` is
// `Object.keys()` of a view built at test time, not a list. A field added to the view and not
// rendered fails; the footer removed from the render fails; and neither can be fixed by editing an
// enumeration in this file, because there isn't one.
//
// Watched failing before it counted, against this tree: deleting the `{answer.footer === null ?
// … }` block from `answer.tsx` fails with "answer.tsx never reads `footer` off the view"; making
// `footer` optional and omitting it from `answerView` fails "every scope's answer carries the
// standing line for that scope"; and building the view from `turn.body` instead of `turn.headline`
// fails "renders the decoded parts and never the stored body".

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { assistantFooterForScope } from "@/lib/assistant/types";
import { encodeAnswerBody } from "@/lib/kb/answer-body";

import { answerView, questionText } from "./answer-view";
import { SCOPE_PROFILES } from "./scope";

import type { AssistantScope, AssistantTurn } from "@/lib/assistant/types";

const SCOPES = Object.keys(SCOPE_PROFILES) as readonly AssistantScope[];
const COMPONENT = path.resolve(import.meta.dirname, "answer.tsx");

const HEADLINE = "Two clients are close to funding.";
const BULLETS = ["Morgan Ready Demo is in Ready.", "Casey Clean Demo is in Optimization."];

function assistantTurn(): AssistantTurn {
  return {
    // Written through the real encoder, so the fixture is the shape the server actually stores.
    body: encodeAnswerBody({ bullets: BULLETS, headline: HEADLINE }),
    bullets: BULLETS,
    createdAt: "2026-08-22T09:05:00.000Z",
    headline: HEADLINE,
    id: "22222222-2222-4222-8222-222222222222",
    role: "assistant",
    sources: [{ kind: "client", label: "Client · Morgan Ready Demo", ref: "tracker:opaque" }],
  };
}

describe("the assistant answer view", () => {
  it("every scope's answer carries the standing line for that scope", () => {
    const footers = SCOPES.map((scope) => assistantFooterForScope(scope));
    // Without this the comparison below passes whenever every scope's footer is null, which is
    // exactly the state a regression would produce.
    assert.ok(
      footers.some((footer) => footer !== null && footer.trim().length > 0),
      "no scope has a standing line at all; the footer vocabulary is empty",
    );
    for (const scope of SCOPES) {
      assert.equal(
        answerView(assistantTurn(), scope).footer,
        assistantFooterForScope(scope),
        `the ${scope} answer view does not carry that scope's standing line`,
      );
    }
  });

  it("renders the decoded parts and never the stored body", () => {
    const turn = assistantTurn();
    const view = answerView(turn, SCOPES[0]);
    assert.equal(view.headline, turn.headline);
    assert.deepEqual(view.bullets, turn.bullets);
    // The encoded body contains the bullet markers; a view built from it would carry them through.
    assert.ok(turn.body.includes("- "), "the fixture is not the encoded shape");
    assert.equal(
      view.bullets.some((bullet) => bullet.startsWith("- ")),
      false,
      "the view carries the encoding's own markers, so it was split out of the body",
    );
  });

  it("shows a question back as the question that was asked", () => {
    const asked = "Which clients are closest to funding?";
    const turn: AssistantTurn = {
      ...assistantTurn(),
      body: asked,
      bullets: [],
      headline: asked,
      role: "user",
    };
    assert.equal(questionText(turn), asked);
    // A row whose headline did not survive still shows the words, rather than an empty heading.
    assert.equal(questionText({ ...turn, headline: "   " }), asked);
  });

  it("is printed field for field by the component that receives it", () => {
    const source = fs.readFileSync(COMPONENT, "utf8");
    const fields = Object.keys(answerView(assistantTurn(), SCOPES[0]));
    // The derivation, asserted non-empty first: an empty view would make the loop vacuous.
    assert.ok(fields.length >= 4, `the answer view has only ${fields.length} field(s)`);
    for (const field of fields) {
      assert.ok(
        new RegExp(`\\banswer\\.${field}\\b`).test(source),
        `answer.tsx never reads \`${field}\` off the view, so it is not on screen`,
      );
    }
  });

  it("gives a source chip no destination to be turned into", () => {
    // F-06 closed one layer up: `KbCitation` has no url and `AssistantSource` never had one. This
    // is the render-side half — no field on a source can become an anchor, because there is no
    // anchor in the file at all.
    const source = fs.readFileSync(COMPONENT, "utf8");
    assert.equal(/href=/.test(source), false, "a source chip renders an anchor");
    assert.equal(/target="_blank"/.test(source), false, "a source chip opens a destination");
    const [chipSource] = answerView(assistantTurn(), SCOPES[0]).sources;
    assert.ok(chipSource, "the fixture cites nothing, so this case checks nothing");
    for (const [key, value] of Object.entries(chipSource)) {
      if (typeof value !== "string") continue;
      let parsed: URL | null = null;
      try {
        parsed = new URL(value);
      } catch {
        parsed = null;
      }
      assert.equal(
        parsed !== null && (parsed.protocol === "https:" || parsed.protocol === "http:"),
        false,
        `a source's \`${key}\` is a live location a render site could reach for`,
      );
    }
  });
});
