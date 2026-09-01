import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getJson, postJson } from "@/lib/enrollment/client";

function response(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

describe("enrollment browser client", () => {
  it("returns a successful POST response as data", async () => {
    const result = await postJson<{ id: string }>(
      "/api/enroll",
      { accepted: true },
      async () => response({ id: "enrollment" }),
    );
    assert.deepEqual(result, { data: { id: "enrollment" }, ok: true });
  });

  it("returns a successful GET response as data", async () => {
    const result = await getJson<{ enabled: boolean }>(
      "/api/enroll",
      async () => response({ enabled: false }),
    );
    assert.deepEqual(result, { data: { enabled: false }, ok: true });
  });

  it("preserves a structured application error", async () => {
    const result = await postJson(
      "/api/enroll",
      {},
      async () => response({ error: { code: "invalid_payload", message: "Check the form and try again." } }, 400),
    );
    assert.deepEqual(result, {
      code: "invalid_payload",
      message: "Check the form and try again.",
      ok: false,
    });
  });

  it("returns a generic code and action for an unparseable server failure", async () => {
    const result = await getJson(
      "/api/enroll",
      async () => new Response("unavailable", { status: 500 }),
    );
    assert.deepEqual(result, {
      code: "http_500",
      message: "Something went wrong. Try that step again.",
      ok: false,
    });
  });

  it("returns a network result when fetch rejects", async () => {
    const result = await postJson("/api/enroll", {}, async () => {
      throw new Error("offline");
    });
    assert.deepEqual(result, {
      code: "network",
      message: "Could not reach the server. Check your connection and try again.",
      ok: false,
    });
  });

  it("returns rather than throwing when a response body reader rejects", async () => {
    const result = await getJson("/api/enroll", async () => {
      return {
        json: async () => {
          throw new Error("body read failed");
        },
        ok: false,
        status: 502,
      } as unknown as Response;
    });
    assert.deepEqual(result, {
      code: "http_502",
      message: "Something went wrong. Try that step again.",
      ok: false,
    });
  });
});
