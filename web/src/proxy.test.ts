import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NextRequest } from "next/server";

import { proxy, sameOriginFailure } from "./proxy.ts";

describe("API mutation origin boundary", () => {
  it("rejects a cross-origin mutation before session and tenant processing", () => {
    const response = sameOriginFailure(new NextRequest("https://mostfundable.test/api/tasks", {
      headers: { origin: "https://attacker.test" },
      method: "POST",
    }));
    assert.equal(response?.status, 403);
    assert.equal(response?.headers.get("Cache-Control"), "private, no-store");
  });

  it("enforces the boundary in the exported proxy before feature resolution", async () => {
    const response = await proxy(new NextRequest("https://mostfundable.test/api/tasks", {
      headers: { origin: "https://attacker.test" },
      method: "POST",
    }));
    assert.equal(response.status, 403);
  });

  it("permits a same-origin mutation and leaves signature-authenticated webhooks alone", () => {
    assert.equal(sameOriginFailure(new NextRequest("https://mostfundable.test/api/tasks", {
      headers: { origin: "https://mostfundable.test" },
      method: "PATCH",
    })), null);
    assert.equal(sameOriginFailure(new NextRequest("https://mostfundable.test/api/webhooks/stripe", {
      method: "POST",
    })), null);
  });
});
