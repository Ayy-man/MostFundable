import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ASSISTANT_CONTEXT_DENY_LIST, assistantContextPayload, consumerAssistantContext } from "./page-context.ts";

describe("assistant page context", () => {
  it("carries only the durable route and entity reference", () => {
    const payload = assistantContextPayload(consumerAssistantContext("credit", "client-123"));
    assert.deepEqual(Object.keys(payload).sort(), ["entityRef", "route"]);
    assert.deepEqual(payload, { entityRef: "client-123", route: "credit" });
    const serialized = JSON.stringify(payload).toLowerCase();
    for (const field of ASSISTANT_CONTEXT_DENY_LIST) assert.equal(serialized.includes(field.toLowerCase()), false);
  });

  it("fails closed if a display-only monitoring key is smuggled into either field", () => {
    for (const field of ASSISTANT_CONTEXT_DENY_LIST) {
      assert.throws(() => assistantContextPayload({ ...consumerAssistantContext("dashboard", "client-123"), route: field }));
    }
  });
});
