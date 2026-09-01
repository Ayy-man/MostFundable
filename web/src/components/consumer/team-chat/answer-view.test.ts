import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ANSWER_BULLET_PREFIX, encodeAnswerBody } from "@/lib/kb/answer-body";
import { KB_CANDIDATE_SCHEMA } from "@/lib/kb/chat-driver";

import { assistantAnswerView } from "./answer-view.ts";
import type { AssistantTurn } from "./use-assistant.ts";

type AssistantSide = Extract<AssistantTurn, { role: "assistant" }>;

function turn(body: string, status: AssistantSide["status"] = "answered"): AssistantSide {
  return {
    body,
    citations: [],
    reasoning: { seconds: 1, steps: [] },
    ref: "answer-0",
    role: "assistant",
    status,
  };
}

/**
 * The widest answer the candidate schema permits, built from the schema itself.
 *
 * Transcribing "six bullets" would be the round-5 mistake in miniature: the
 * number lives in `KB_CANDIDATE_SCHEMA`, and a schema that grew a seventh bullet
 * would leave this test asserting a shape nothing produces any more.
 */
function widestAnswer(): { headline: string; bullets: string[] } {
  const bulletSpec = KB_CANDIDATE_SCHEMA.properties.bullets;
  return {
    headline: "What the answer says in one line.",
    bullets: Array.from({ length: bulletSpec.maxItems }, (_, index) => `Supporting point number ${index + 1}.`),
  };
}

describe("assistant answer view", () => {
  it("splits an answered turn back into the parts the model returned", () => {
    const body = widestAnswer();
    const view = assistantAnswerView(turn(encodeAnswerBody(body)));
    assert.equal(view.headline, body.headline);
    assert.deepEqual([...view.bullets], body.bullets);
    // The defect this closes: every part was reaching the panel as one string,
    // so the list arrived as inline text with the encoder's markers still in it.
    assert.ok(view.bullets.every((bullet) => !bullet.startsWith(ANSWER_BULLET_PREFIX)), "a rendered bullet must not carry the encoding marker");
    assert.ok(!view.headline.includes(ANSWER_BULLET_PREFIX));
  });

  it("round-trips every arity the schema allows, so no answer loses a part", () => {
    const { headline, bullets } = widestAnswer();
    for (let count = KB_CANDIDATE_SCHEMA.properties.bullets.minItems; count <= bullets.length; count += 1) {
      const body = { bullets: bullets.slice(0, count), headline };
      const view = assistantAnswerView(turn(encodeAnswerBody(body)));
      assert.equal(view.headline, headline, `arity ${count}`);
      assert.deepEqual([...view.bullets], body.bullets, `arity ${count}`);
    }
  });

  it("never loses an answer it does not understand", () => {
    // Not encoder output: a row written before the format existed, or restored
    // from elsewhere. It must still render, as the flat paragraph it always was.
    for (const body of ["A plain sentence with no structure at all.", "", "   ", `${ANSWER_BULLET_PREFIX}a leading marker on the only line`]) {
      const view = assistantAnswerView(turn(body));
      assert.equal(typeof view.headline, "string");
      assert.doesNotThrow(() => assistantAnswerView(turn(body)));
    }
  });

  it("structures only an answered turn, so a refusal cannot grow a list it was never sent", () => {
    // A decline is prose this codebase wrote, not encoder output. A sentence in
    // it that happens to open a line with a dash must stay a sentence.
    const prose = `I cannot answer that from the verified knowledge base.\n${ANSWER_BULLET_PREFIX}not a bullet`;
    for (const status of ["insufficient_grounding", "unavailable"] as const) {
      const view = assistantAnswerView(turn(prose, status));
      assert.deepEqual([...view.bullets], [], `${status} must not be given structure`);
      assert.equal(view.headline, prose, `${status} must render exactly what the server sent`);
    }
  });
});
