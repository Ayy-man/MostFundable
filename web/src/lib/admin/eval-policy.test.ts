import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OPENROUTER_MODEL } from "@/lib/llm/openrouter-driver";
import { MOCK_PLAN_MODEL } from "@/lib/llm/mock-driver";
import { MOCK_SUPPORT_DRAFT_MODEL } from "@/lib/support/mock-driver";

import { EVAL_DRIVERS, promptEvaluationIdentity, resolveEvalDriver } from "./eval-policy.ts";

describe("eval driver selection", () => {
  it("falls back to mock, which is what holds an activation as ineligible", () => {
    assert.equal(resolveEvalDriver({}), "mock");
  });

  it("selects the provider from its own key", () => {
    assert.equal(
      resolveEvalDriver({ EVAL_DRIVER: "openrouter", OPENROUTER_API_KEY: "k" }),
      "openrouter",
    );
  });

  // Whether an evaluation run counts is now its own decision, not a side effect
  // of a deployment choice about the coach or about support drafts.
  it("reads only its own selector", () => {
    assert.equal(EVAL_DRIVERS.selector, "EVAL_DRIVER");
    for (const foreign of ["ASSISTANT_DRIVER", "SUPPORT_DRAFT_DRIVER", "PLAN_DRIVER"]) {
      assert.equal(
        resolveEvalDriver({ [foreign]: "openrouter", OPENROUTER_API_KEY: "k" }),
        "mock",
        `${foreign} must not select the eval driver`,
      );
    }
  });

  it("accepts the deprecated AI_DRIVER for one release, and prefers its own key", () => {
    assert.equal(
      resolveEvalDriver({ AI_DRIVER: "openrouter", OPENROUTER_API_KEY: "k" }),
      "openrouter",
    );
    assert.equal(
      resolveEvalDriver({
        EVAL_DRIVER: "mock",
        AI_DRIVER: "openrouter",
        OPENROUTER_API_KEY: "k",
      }),
      "mock",
    );
  });

  it("leaves the missing-key and unknown-value errors to the shared resolver", () => {
    assert.throws(() => resolveEvalDriver({ EVAL_DRIVER: "openrouter" }), /OPENROUTER_API_KEY/);
    assert.throws(() => resolveEvalDriver({ EVAL_DRIVER: "anthropic" }), /EVAL_DRIVER/);
  });
});

describe("prompt evaluation identity", () => {
  it("names the mock model of the prompt's own service", () => {
    assert.equal(promptEvaluationIdentity("funding-readiness-plan", {}).model, MOCK_PLAN_MODEL);
    assert.equal(promptEvaluationIdentity("support-draft", {}).model, MOCK_SUPPORT_DRAFT_MODEL);
  });

  it("names the provider model once the eval driver selects one", () => {
    const env = { EVAL_DRIVER: "openrouter", OPENROUTER_API_KEY: "k" };
    const identity = promptEvaluationIdentity("support-draft", env);
    assert.equal(identity.driver, "openrouter");
    assert.equal(identity.model, OPENROUTER_MODEL);
  });
});
