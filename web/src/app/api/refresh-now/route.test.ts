import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { handleAuthorizedRefresh } from "./route.ts";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const postSource = source.slice(source.indexOf("export async function POST"));
const handlerSource = source.slice(
  source.indexOf("export async function handleAuthorizedRefresh"),
  source.indexOf("export const runtime"),
);

describe("refresh now route", () => {
  it("reaches the missing-route path before reading request or privileged dependencies", () => {
    const gate = postSource.indexOf('featureFlag("FEATURE_PAID_REFRESH")');
    assert.ok(gate > 0);
    for (const token of ["request.headers", "request.text()", "Promise.all", "requireRole("]) {
      const position = postSource.indexOf(token);
      if (position >= 0) assert.ok(gate < position, `${token} must follow the flag gate`);
    }
    assert.match(postSource, /if \(!featureFlag\("FEATURE_PAID_REFRESH"\)\) notFound\(\)/);
  });

  it("orders same-origin and authorization before the closed request and governed-price checks", () => {
    const postOrdered = [
      "sameOrigin(request)",
      "paidRefreshPurchasesReady()",
      'requireRole("consumer")',
      "handleAuthorizedRefresh(request, session",
    ].map((token) => postSource.indexOf(token));
    assert.ok(postOrdered.every((position) => position >= 0));
    assert.deepEqual(postOrdered, [...postOrdered].sort((a, b) => a - b));

    const handlerOrdered = [
      'request.headers.get("Idempotency-Key")',
      "request.json()",
      "dependencies.listClients(session)",
      "dependencies.currentAmountCents()",
      "dependencies.create({",
    ].map((token) => handlerSource.indexOf(token));
    assert.ok(handlerOrdered.every((position) => position >= 0));
    assert.deepEqual(handlerOrdered, [...handlerOrdered].sort((a, b) => a - b));
    assert.match(handlerSource, /clients\.length !== 1/);
  });

  it("fails closed before authorization or writes unless billing and CRS are both real", () => {
    const ready = postSource.indexOf("paidRefreshPurchasesReady()");
    assert.ok(ready > postSource.indexOf("sameOrigin(request)"));
    assert.ok(ready < postSource.indexOf('requireRole("consumer")'));
    assert.match(postSource, /paid_refresh_provider_unavailable/);
  });

  it("rejects a stale displayed price before creating any paid refresh work", async () => {
    let creates = 0;
    const response = await handleAuthorizedRefresh(new Request("https://app.example/api/refresh-now", {
      body: JSON.stringify({ expectedAmountCents: 1900 }),
      headers: { "Idempotency-Key": "33700000-0000-4000-8000-000000000001" },
      method: "POST",
    }), { id: "actor" }, {
      async create() {
        creates += 1;
        throw new Error("must not create");
      },
      async currentAmountCents() { return 2900; },
      async listClients() { return [{ id: "client" }]; },
      mapResult() { throw new Error("must not map"); },
      privateJson: (body, status = 200) => Response.json(body, { status }),
    });

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "price_changed" });
    assert.equal(creates, 0, "price drift performs zero payment or request creation calls");
  });

  // R4B-01. The route's own read cannot be the authority, because the value it
  // compares is not the value the service persists. The consumer's confirmed
  // amount has to travel with the request so the service can compare it against
  // the single read it actually charges from. On `c2df7ae` this fails at
  // `assert.equal(created?.expectedAmountCents, 1900)` — `create()` received
  // only the actor, client and idempotency key.
  it("hands the confirmed amount to the service rather than trusting its own read", async () => {
    let created: { expectedAmountCents?: number } | null = null;
    const response = await handleAuthorizedRefresh(new Request("https://app.example/api/refresh-now", {
      body: JSON.stringify({ expectedAmountCents: 1900 }),
      headers: { "Idempotency-Key": "33700000-0000-4000-8000-000000000002" },
      method: "POST",
    }), { id: "actor" }, {
      async create(input) {
        created = input;
        return {
          ok: false,
          reason: "price_changed",
          requestId: null,
        };
      },
      async currentAmountCents() { return 1900; },
      async listClients() { return [{ id: "client" }]; },
      mapResult: (result) => Response.json(result, { status: result.ok ? 202 : 409 }),
      privateJson: (body, status = 200) => Response.json(body, { status }),
    });

    assert.equal((created as { expectedAmountCents?: number } | null)?.expectedAmountCents, 1900);
    assert.equal(response.status, 409, "a service-side drift is answered like a route-side one");
  });

  it("contains no inline provider, analysis runner, drainer or database call", () => {
    assert.doesNotMatch(source, /analysis\.run|drain|paymentIntents|createAdminClient|createSupabase|\.from\(|\.rpc\(/);
  });
});
