import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { promptFamilyOptions, promptKeyLabel } from "./prompt-labels.ts";
import { PROMPT_KEYS } from "./prompt-types.ts";

describe("prompt family labels", () => {
  it("labels the narrative prompt whether or not PROMPT_KEYS carries it yet", () => {
    // The key is declared in `prompt-types.ts` by the engine work, and this module ships its label
    // ahead of that. Both orderings must render the same wording.
    assert.equal(promptKeyLabel("funding-readiness-narrative"), "Plan narrative");
    assert.deepEqual(
      promptFamilyOptions(["funding-readiness-plan", "funding-readiness-narrative", "support-draft"]),
      [
        { label: "Funding readiness plan", value: "funding-readiness-plan" },
        { label: "Plan narrative", value: "funding-readiness-narrative" },
        { label: "Support draft", value: "support-draft" },
      ],
    );
  });

  it("falls back to the key itself, so a family added upstream is never invisible", () => {
    assert.equal(promptKeyLabel("some-future-prompt"), "some-future-prompt");
  });

  it("offers exactly the governed families, in their declared order", () => {
    assert.deepEqual(
      promptFamilyOptions().map((option) => option.value),
      [...PROMPT_KEYS],
    );
  });

  it("gives every declared family a human label rather than an identifier", () => {
    for (const key of PROMPT_KEYS) {
      assert.notEqual(promptKeyLabel(key), key, `${key} has no label`);
    }
  });
});
