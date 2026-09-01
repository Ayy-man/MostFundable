import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { DELETE, POST } from "./route.ts";
import { AffiliateError } from "@/lib/affiliates/types";
import { affiliateFailure } from "@/lib/affiliates/http";
import { AuthError } from "@/lib/auth/errors";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const id = "21000000-0000-4000-8000-000000000001";

function request(method: string): Request {
  return new Request("https://mf.test/api/affiliates/id/share", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientId: id }),
  });
}

describe("affiliate share route", () => {
  it("is an empty 404 before reading the request or loading route dependencies", async () => {
    for (const handler of [POST, DELETE]) {
      const response = await handler(request(handler === POST ? "POST" : "DELETE"), {
        params: Promise.resolve({ id }),
      });
      assert.equal(response.status, 404);
      assert.equal(await response.text(), "");
    }
    const gate = source.indexOf('featureFlag("FEATURE_AFFILIATES"');
    assert.ok(gate >= 0);
    assert.ok(gate < source.indexOf("request.json()"));
    assert.ok(gate < source.indexOf('import("@/lib/auth/session")'));
  });

  it("awaits local params, requires the exact role, and carries replay statuses", () => {
    assert.match(source, /type Context = \{ params: Promise<\{ id: string \}> \}/);
    assert.equal(source.match(/await context\.params/g)?.length, 2);
    assert.equal(source.match(/requireRole\("operator_member"\)/g)?.length, 2);
    assert.match(source, /result\.inserted \? 201 : 200/);
    assert.match(source, /status: 204/);
    assert.doesNotMatch(source, /RouteContext/);
  });

  it("maps malformed, auth, hidden, and unexpected failures to fixed responses", async () => {
    const cases: Array<[unknown, number, string]> = [
      [new AffiliateError("invalid_payload", "private"), 400, "invalid_payload"],
      [new AffiliateError("forbidden", "private"), 403, "forbidden"],
      [new AuthError(401, "unauthenticated", "private"), 401, "unauthenticated"],
      [new AuthError(403, "forbidden", "private"), 403, "forbidden"],
      [new AffiliateError("not_found", "private"), 404, "not_found"],
      [new Error("database detail"), 500, "unavailable"],
    ];
    for (const [error, status, code] of cases) {
      const response = affiliateFailure(error);
      assert.equal(response.status, status);
      // R5B-04: an unknown cause now carries a correlation id and nothing else. Every named answer
      // keeps its byte-identical one-key body, and no body ever grows a second field.
      const body = await response.json() as Record<string, unknown>;
      assert.equal(body.error, code);
      assert.deepEqual(
        Object.keys(body).sort(),
        status === 500 ? ["correlationId", "error"] : ["error"],
      );
      if (status === 500) assert.match(String(body.correlationId), /^[0-9a-z-]{8,}$/);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
    }
  });
});
