import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OPENROUTER_MODEL, PROVIDER_SORTS } from "../llm/chat-transport.ts";
import { KB_MODEL_KEY, KB_PROVIDER_SORT_DEFAULT, KB_PROVIDER_SORT_KEY, KB_REASONING_KEY, KB_SCORING_MODEL_KEY, KbModelInvalidError, KbProviderSortInvalidError, resolveKbModel, resolveKbProviderSort, resolveKbReasoning, resolveKbScoringModel } from "./model.ts";

describe("KB model override (F-10)", () => {
  it("leaves the transport's own default in place when unset", () => {
    for (const blank of [undefined, "", "   "]) {
      assert.equal(resolveKbModel({ [KB_MODEL_KEY]: blank }), undefined, "an unset override must not name a model");
    }
  });

  it("honours a provider-qualified id and refuses anything looser", () => {
    // The current constant is itself a legal value, which is the cheapest proof
    // that the pattern accepts the shape production actually runs.
    assert.equal(resolveKbModel({ [KB_MODEL_KEY]: OPENROUTER_MODEL }), OPENROUTER_MODEL);
    assert.equal(resolveKbModel({ [KB_MODEL_KEY]: `  ${OPENROUTER_MODEL}  ` }), OPENROUTER_MODEL);
    for (const malformed of ["gpt-oss-120b", "openai/", "/gpt-oss-120b", "openai/gpt oss", "openai/gpt\n120b", "https://openrouter.ai/api/v1"]) {
      assert.throws(() => resolveKbModel({ [KB_MODEL_KEY]: malformed }), KbModelInvalidError, `${malformed} must be refused rather than silently ignored`);
    }
  });

  it("never echoes the configured value into its own error", () => {
    // The message reaches a server log. A model id is not a credential, but the
    // habit of interpolating environment values into boot errors is how one
    // eventually does — `env.ts` states the rule and this holds the same line.
    const secretish = "vendor/sk-do-not-print";
    try {
      resolveKbModel({ [KB_MODEL_KEY]: `${secretish} bad` });
      assert.fail("expected a refusal");
    } catch (error) {
      assert.ok(error instanceof KbModelInvalidError);
      assert.equal(error.message.includes(secretish), false);
      assert.ok(error.message.includes(KB_MODEL_KEY), "the message must name the key so it can be fixed");
    }
  });

  it("lets the scorer take its own model, and inherit the answer's when it has none", () => {
    // Scoring is a constrained classification nobody reads; answering is
    // supervised generation a person waits on. One key for both was the mistake
    // this closes.
    assert.equal(resolveKbScoringModel({}), undefined);
    assert.equal(resolveKbScoringModel({ [KB_MODEL_KEY]: "vendor/answer" }), "vendor/answer", "the common case is one model for the whole KB");
    assert.equal(resolveKbScoringModel({ [KB_MODEL_KEY]: "vendor/answer", [KB_SCORING_MODEL_KEY]: "vendor/small" }), "vendor/small");
    // And the inheritance is one-way: moving the scorer must never move answers.
    assert.equal(resolveKbModel({ [KB_SCORING_MODEL_KEY]: "vendor/small" }), undefined, "the scoring key must not reach the answer path");
    assert.throws(() => resolveKbScoringModel({ [KB_SCORING_MODEL_KEY]: "not a model" }), KbModelInvalidError);
  });

  it("orders providers by throughput unless told otherwise, and refuses an order it does not know", () => {
    assert.equal(resolveKbProviderSort({}), KB_PROVIDER_SORT_DEFAULT);
    assert.equal(KB_PROVIDER_SORT_DEFAULT, "throughput", "the default is the measured choice, not the transport's silence");
    // Every order the transport offers is accepted, case- and space-insensitively.
    for (const sort of PROVIDER_SORTS) {
      assert.equal(resolveKbProviderSort({ [KB_PROVIDER_SORT_KEY]: `  ${sort.toUpperCase()} ` }), sort);
    }
    for (const blank of ["", "   "]) assert.equal(resolveKbProviderSort({ [KB_PROVIDER_SORT_KEY]: blank }), KB_PROVIDER_SORT_DEFAULT);
    for (const malformed of ["fastest", "throughput,latency", "0", "none"]) {
      assert.throws(() => resolveKbProviderSort({ [KB_PROVIDER_SORT_KEY]: malformed }), KbProviderSortInvalidError, `${malformed} must be refused rather than silently defaulted`);
    }
  });

  it("keeps reasoning at the family floor unless it is turned off exactly", () => {
    // `off` is not a speed setting — on a reasoning model it hands the effort
    // choice to the provider's default, which is higher than `low`. So anything
    // that is not exactly `off` has to read as `low`, or a typo silently makes
    // the assistant slower and dearer.
    assert.equal(resolveKbReasoning({}), "low");
    assert.equal(resolveKbReasoning({ [KB_REASONING_KEY]: "off" }), "off");
    assert.equal(resolveKbReasoning({ [KB_REASONING_KEY]: "  OFF  " }), "off");
    for (const value of ["", "  ", "none", "false", "0", "disabled", "low", "high", "of"]) {
      assert.equal(resolveKbReasoning({ [KB_REASONING_KEY]: value }), "low", `${JSON.stringify(value)} must not read as off`);
    }
  });

  it("is the KB's own key, not one another service reads", () => {
    // The whole point of the KB carrying its own selectors (G-KB-01, ca0597c).
    // Nothing else may be able to move this model, and this must not move
    // anything else's.
    for (const foreign of ["AI_DRIVER", "OPENROUTER_MODEL", "OPENROUTER_SUPERVISOR_MODEL", "PLAN_DRIVER"]) {
      for (const key of [KB_MODEL_KEY, KB_SCORING_MODEL_KEY, KB_REASONING_KEY]) assert.notEqual(key, foreign);
      assert.equal(resolveKbModel({ [foreign]: "vendor/whatever" }), undefined, `${foreign} must not select the KB's model`);
      assert.equal(resolveKbScoringModel({ [foreign]: "vendor/whatever" }), undefined, `${foreign} must not select the KB's scoring model`);
      assert.equal(resolveKbReasoning({ [foreign]: "off" }), "low", `${foreign} must not change KB reasoning`);
    }
  });
});
