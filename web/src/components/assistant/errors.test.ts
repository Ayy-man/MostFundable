// Every refusal the server can raise has words, in every scope.
//
// Derived from `ASSISTANT_ERROR_CODES` rather than from a list of the codes that exist today, which
// is the whole point: the failure this catches is a tenth code added to the vocabulary and rendered
// as an empty error card. The scopes come from `SCOPE_PROFILES` for the same reason.
//
// Watched failing before it counted, against this tree: removing the `ASSISTANT_ANSWER_UNAVAILABLE`
// branch from `assistantErrorMessage` fails "has words for every code the server can raise" with
// the empty string that arm leaves behind in the shared table; and making
// `assistantErrorIsRetryable` return `true` for everything fails "offers no retry where a retry
// cannot work".

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ASSISTANT_ERROR_CODES } from "@/lib/assistant/types";

import { assistantErrorIsRetryable, assistantErrorMessage } from "./errors";
import { SCOPE_PROFILES } from "./scope";

import type { AssistantScope } from "@/lib/assistant/types";

const SCOPES = Object.keys(SCOPE_PROFILES) as readonly AssistantScope[];

describe("the assistant's refusal copy", () => {
  it("has words for every code the server can raise", () => {
    assert.ok(ASSISTANT_ERROR_CODES.length >= 13, "the error vocabulary shrank");
    for (const code of ASSISTANT_ERROR_CODES) {
      for (const scope of SCOPES) {
        const message = assistantErrorMessage(code, scope);
        assert.equal(typeof message, "string", `${code} in ${scope} has no message`);
        assert.ok(message.trim().length > 0, `${code} in ${scope} renders an empty error`);
        // The code is the message on the server side, deliberately. It must not also be the
        // message here: a person reading `ASSISTANT_ANSWER_UNAVAILABLE` has been shown our
        // internals instead of an explanation.
        assert.equal(message.includes(code), false, `${code} is shown to the reader as itself`);
        assert.doesNotMatch(message, /ASSISTANT_/, `${code} leaks the vocabulary into its copy`);
      }
    }
  });

  it("says something scope-appropriate about an answer that did not come back", () => {
    const messages = SCOPES.map((scope) => assistantErrorMessage("ASSISTANT_ANSWER_UNAVAILABLE", scope));
    assert.equal(new Set(messages).size, messages.length, "both scopes describe their own records identically");
  });

  it("names each new answer outcome without collapsing the causes", () => {
    for (const scope of SCOPES) {
      const messages = [
        assistantErrorMessage("ASSISTANT_NO_MATCHING_RECORDS", scope),
        assistantErrorMessage("ASSISTANT_OUT_OF_SCOPE", scope),
        assistantErrorMessage("ASSISTANT_PROVIDER_UNAVAILABLE", scope),
        assistantErrorMessage("ASSISTANT_DATA_UNAVAILABLE", scope),
        assistantErrorMessage("ASSISTANT_POLICY_REFUSED", scope),
      ];
      assert.equal(new Set(messages).size, messages.length, `${scope} collapses distinct answer failures`);
    }
    assert.notEqual(
      assistantErrorMessage("ASSISTANT_NO_MATCHING_RECORDS", "operator"),
      assistantErrorMessage("ASSISTANT_NO_MATCHING_RECORDS", "admin"),
      "no-matching copy does not name the scope's records",
    );
  });

  it("offers no retry where a retry cannot work", () => {
    for (const code of [
      "ASSISTANT_ACTOR_REQUIRED",
      "ASSISTANT_FORBIDDEN",
      "ASSISTANT_NOT_FOUND",
      "ASSISTANT_NO_MATCHING_RECORDS",
      "ASSISTANT_OUT_OF_SCOPE",
      "ASSISTANT_POLICY_REFUSED",
      "ASSISTANT_REQUEST_INVALID",
    ] as const) {
      assert.equal(assistantErrorIsRetryable(code), false, `${code} offers a retry that cannot succeed`);
    }
    for (const code of [
      "ASSISTANT_PROVIDER_UNAVAILABLE",
      "ASSISTANT_DATA_UNAVAILABLE",
      "ASSISTANT_ANSWER_UNAVAILABLE",
      "ASSISTANT_UNAVAILABLE",
    ] as const) {
      assert.equal(assistantErrorIsRetryable(code), true, `${code} hides a retry that would work`);
    }
    // Not every code is retryable and not none of them is: a predicate that answered one way for
    // the whole vocabulary would pass both loops above only by accident of which codes were listed.
    const answers = ASSISTANT_ERROR_CODES.map(assistantErrorIsRetryable);
    assert.equal(new Set(answers).size, 2, "the retry predicate answers the same way for every code");
  });
});

/**
 * Honest sentences for the two outcomes that were folded into the outage code.
 *
 * The failure this catches is a reader being told the AI provider could not be
 * reached when it answered and we refused what it said, and being offered a retry
 * for a read that will overflow again however many times it is repeated.
 */
describe("the assistant's refusal copy tells provider failures apart", () => {
  it("does not describe an unusable answer or an overflowing read as an unreachable provider", () => {
    for (const scope of SCOPES) {
      const outage = assistantErrorMessage("ASSISTANT_PROVIDER_UNAVAILABLE", scope);
      for (const code of ["ASSISTANT_ANSWER_MALFORMED", "ASSISTANT_RESULT_TOO_LARGE"] as const) {
        const message = assistantErrorMessage(code, scope);
        assert.ok(message.length > 0, `${code} renders as an empty card in ${scope}`);
        assert.notEqual(message, outage, `${code} reuses the outage sentence in ${scope}`);
      }
    }
  });

  it("offers the retry only where repeating the question can change the answer", () => {
    assert.equal(assistantErrorIsRetryable("ASSISTANT_ANSWER_MALFORMED"), true);
    assert.equal(assistantErrorIsRetryable("ASSISTANT_RESULT_TOO_LARGE"), false);
  });
});
