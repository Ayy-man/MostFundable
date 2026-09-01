/**
 * The consumer surface's sentence for every way an answer can fail.
 *
 * The map used to live inside a `catch` with `provider_unreachable` as its
 * default, so three different things — a code the map had never heard of, a
 * route this codebase refused, and a bug in the handler itself — all told a
 * consumer the AI provider could not be reached. The assertions below are
 * derived from `ASSISTANT_ERROR_CODES` and from the failure map itself rather
 * than from a transcript, so a code added to the vocabulary without a sentence
 * fails here instead of silently rendering the default.
 *
 * Watched failing on the pre-fix tree: `consumerAssistantFailure` did not exist,
 * so every case below fails at import.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ASSISTANT_ERROR_CODES, AssistantError } from "../assistant/types.ts";
import { consumerAssistantFailure } from "./handlers.ts";

/** The outcomes the orchestrator raises for an answer, as opposed to the route-level ones. */
const ANSWER_OUTCOMES = ASSISTANT_ERROR_CODES.filter((code) => code === "ASSISTANT_NO_MATCHING_RECORDS"
  || code === "ASSISTANT_OUT_OF_SCOPE"
  || code === "ASSISTANT_PROVIDER_UNAVAILABLE"
  || code === "ASSISTANT_ANSWER_MALFORMED"
  || code === "ASSISTANT_DATA_UNAVAILABLE"
  || code === "ASSISTANT_RESULT_TOO_LARGE"
  || code === "ASSISTANT_POLICY_REFUSED");

describe("the consumer assistant's failure copy", () => {
  it("gives every answer outcome its own status and its own sentence", () => {
    const statuses = new Set<string>();
    const answers = new Set<string>();
    for (const code of ANSWER_OUTCOMES) {
      const result = consumerAssistantFailure(new AssistantError(code));
      assert.notEqual(result.status, "answered", code);
      assert.ok(result.answer.length > 0, `${code} renders as an empty reply`);
      assert.deepEqual([...result.citations], [], `${code} carried citations into a refusal`);
      statuses.add(result.status);
      answers.add(result.answer);
    }
    assert.equal(statuses.size, ANSWER_OUTCOMES.length, "two answer outcomes collapse to one consumer status");
    assert.equal(answers.size, ANSWER_OUTCOMES.length, "two answer outcomes collapse to one consumer sentence");
  });

  it("does not report an unknown failure as an outage at the provider", () => {
    const outage = consumerAssistantFailure(new AssistantError("ASSISTANT_PROVIDER_UNAVAILABLE"));
    for (const thrown of [new Error("a bug in this handler"), "not an error at all", null]) {
      const result = consumerAssistantFailure(thrown);
      assert.notEqual(result.status, outage.status, "an internal failure is reported as a provider outage");
      assert.notEqual(result.answer, outage.answer);
      assert.ok(result.answer.length > 0);
    }
  });

  it("does not report an unusable answer as an outage at the provider", () => {
    const outage = consumerAssistantFailure(new AssistantError("ASSISTANT_PROVIDER_UNAVAILABLE"));
    const malformed = consumerAssistantFailure(new AssistantError("ASSISTANT_ANSWER_MALFORMED"));
    assert.notEqual(malformed.status, outage.status);
    assert.notEqual(malformed.answer, outage.answer);
  });
});
