import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateStartSubscriptionRequest } from "./route.ts";

function request(body: unknown): Request {
  return new Request("http://local/api/billing/subscription", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

describe("operator subscription route input", () => {
  it("accepts only the empty server-derived request", async () => {
    assert.deepEqual(await validateStartSubscriptionRequest(request({})), {
      ok: true,
      value: {},
    });
  });

  it("rejects caller customer and idempotency fields", async () => {
    for (const body of [
      { customerRef: "cus_other" },
      { idempotencyKey: "caller-key" },
    ]) {
      assert.deepEqual(await validateStartSubscriptionRequest(request(body)), {
        code: "invalid_request",
        ok: false,
      });
    }
  });
});
