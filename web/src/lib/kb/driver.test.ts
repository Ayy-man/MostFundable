import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ASSISTANT_DRIVERS, resolveAssistantDriver } from "./driver.ts";

describe("assistant driver selection", () => {
  it("falls back to the mock responder with nothing set", () => {
    assert.equal(resolveAssistantDriver({}), "mock");
  });

  it("selects the provider from its own key", () => {
    assert.equal(
      resolveAssistantDriver({ ASSISTANT_DRIVER: "openrouter", OPENROUTER_API_KEY: "k" }),
      "openrouter",
    );
    assert.equal(resolveAssistantDriver({ ASSISTANT_DRIVER: " MOCK " }), "mock");
  });

  // The point of the split. No other service's selector may move the coach, and
  // this one may not move theirs.
  it("reads only its own selector", () => {
    assert.equal(ASSISTANT_DRIVERS.selector, "ASSISTANT_DRIVER");
    for (const foreign of ["SUPPORT_DRAFT_DRIVER", "EVAL_DRIVER", "PLAN_DRIVER"]) {
      assert.equal(
        resolveAssistantDriver({ [foreign]: "openrouter", OPENROUTER_API_KEY: "k" }),
        "mock",
        `${foreign} must not select the assistant driver`,
      );
    }
  });

  it("accepts the deprecated AI_DRIVER for one release, and prefers its own key", () => {
    assert.equal(
      resolveAssistantDriver({ AI_DRIVER: "openrouter", OPENROUTER_API_KEY: "k" }),
      "openrouter",
    );
    assert.equal(
      resolveAssistantDriver({
        ASSISTANT_DRIVER: "mock",
        AI_DRIVER: "openrouter",
        OPENROUTER_API_KEY: "k",
      }),
      "mock",
    );
  });

  it("leaves the missing-key and unknown-value errors to the shared resolver", () => {
    assert.throws(
      () => resolveAssistantDriver({ ASSISTANT_DRIVER: "openrouter" }),
      /OPENROUTER_API_KEY/,
    );
    assert.throws(
      () => resolveAssistantDriver({ ASSISTANT_DRIVER: "anthropic" }),
      /ASSISTANT_DRIVER/,
    );
  });
});
