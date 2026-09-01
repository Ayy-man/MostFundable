import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ASSISTANT_ERROR_CODES,
  AssistantError,
  assistantErrorStatus,
  toAssistantError,
} from "./types.ts";

const SPECIFIC_ANSWER_CODES = [
  "ASSISTANT_NO_MATCHING_RECORDS",
  "ASSISTANT_OUT_OF_SCOPE",
  "ASSISTANT_PROVIDER_UNAVAILABLE",
  "ASSISTANT_DATA_UNAVAILABLE",
  "ASSISTANT_ANSWER_MALFORMED",
  "ASSISTANT_RESULT_TOO_LARGE",
  "ASSISTANT_POLICY_REFUSED",
] as const;

describe("assistant answer error contract", () => {
  it("keeps each specific outcome and the legacy fallback parseable", () => {
    for (const code of [...SPECIFIC_ANSWER_CODES, "ASSISTANT_ANSWER_UNAVAILABLE"] as const) {
      assert.ok(ASSISTANT_ERROR_CODES.includes(code));
      assert.equal(toAssistantError({ code }).code, code);
      assert.equal(toAssistantError(new Error(code)).code, code);
    }
  });

  it("assigns transient status to provider and permitted-data outages", () => {
    assert.equal(assistantErrorStatus("ASSISTANT_NO_MATCHING_RECORDS"), 404);
    assert.equal(assistantErrorStatus("ASSISTANT_OUT_OF_SCOPE"), 403);
    assert.equal(assistantErrorStatus("ASSISTANT_PROVIDER_UNAVAILABLE"), 503);
    assert.equal(assistantErrorStatus("ASSISTANT_DATA_UNAVAILABLE"), 503);
    assert.equal(assistantErrorStatus("ASSISTANT_POLICY_REFUSED"), 403);
  });

  it("drops unknown thrown text instead of forwarding it", () => {
    const error = toAssistantError(new Error("provider response included private content"));
    assert.ok(error instanceof AssistantError);
    assert.equal(error.code, "ASSISTANT_UNAVAILABLE");
    assert.equal(error.message, "ASSISTANT_UNAVAILABLE");
  });
});

/**
 * The two outcomes that used to be one, and why their statuses differ.
 *
 * Both were `ASSISTANT_PROVIDER_UNAVAILABLE` and both said 503 — the code a
 * caller reads as "the upstream is down, come back later". Neither is that. The
 * assertions below are about the distinction rather than the numbers: an unusable
 * answer must not share a status with an outage, and an overflowing read must not
 * be told to retry unchanged.
 */
describe("an unusable answer and an overflowing read are not an outage", () => {
  it("gives each its own code in the vocabulary", () => {
    for (const code of ["ASSISTANT_ANSWER_MALFORMED", "ASSISTANT_RESULT_TOO_LARGE"] as const) {
      assert.ok(ASSISTANT_ERROR_CODES.includes(code), `${code} is missing from the vocabulary`);
      assert.equal(toAssistantError(new AssistantError(code)).code, code);
    }
  });

  it("gives each a status that does not read as a transient upstream failure", () => {
    const outage = assistantErrorStatus("ASSISTANT_PROVIDER_UNAVAILABLE");
    assert.notEqual(assistantErrorStatus("ASSISTANT_ANSWER_MALFORMED"), outage);
    assert.notEqual(assistantErrorStatus("ASSISTANT_RESULT_TOO_LARGE"), outage);
    assert.ok(assistantErrorStatus("ASSISTANT_RESULT_TOO_LARGE") < 500, "an overflowing read is reported as a server fault the caller cannot act on");
  });
});
