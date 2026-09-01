import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  handlePricingCatalog,
  mapPaidRefreshFailure,
  mapPaidRefreshResult,
  resolveAdminPricingCatalog,
  resolveConsumerPricingCatalog,
  resolveOperatorPricingCatalog,
  sameOrigin,
} from "./http.ts";

describe("pricing HTTP catalogs", () => {
  it("returns exact role-scoped defaults without provenance or references", () => {
    assert.deepEqual(resolveConsumerPricingCatalog({}), {
      enabled: true,
      currency: "usd",
      monitoring: { amountCents: 4_900 },
      forcePull: { amountCents: 1_900 },
    });
    assert.deepEqual(resolveOperatorPricingCatalog({}), {
      enabled: true,
      monitoringSplit: { percent: 40, configured: false },
    });
    assert.deepEqual(resolveAdminPricingCatalog({}), {
      enabled: true,
      currency: "usd",
      forcePull: { amountCents: 1_900 },
      monitoringSplit: { percent: 40, configured: false },
    });
    const serialized = JSON.stringify([
      resolveConsumerPricingCatalog({}),
      resolveOperatorPricingCatalog({}),
      resolveAdminPricingCatalog({}),
    ]);
    assert.doesNotMatch(serialized, /source|env|provider|customer|paymentMethod|priceRef/i);
  });

  it("resolves configured values at request time and fails closed on malformed input", () => {
    assert.deepEqual(resolveConsumerPricingCatalog({
      CONSUMER_MONITORING_PRICE_CENTS: "5200",
      FORCE_PULL_PRICE_CENTS: "2300",
    }), {
      enabled: true,
      currency: "usd",
      monitoring: { amountCents: 5_200 },
      forcePull: { amountCents: 2_300 },
    });
    assert.deepEqual(resolveOperatorPricingCatalog({ MONITORING_SPLIT_PCT: "42.5" }), {
      enabled: true,
      monitoringSplit: { percent: 42.5, configured: true },
    });
    assert.throws(
      () => resolveAdminPricingCatalog({ FORCE_PULL_PRICE_CENTS: "invalid" }),
      { message: "PRICING_CENTS_INVALID" },
    );
  });

  it("authorizes the exact role before resolving and returns private responses", async () => {
    const calls: string[] = [];
    const response = await handlePricingCatalog("operator_member", {
      async requireRole(role) { calls.push(`auth:${role}`); },
      resolveCatalog() {
        calls.push("resolve");
        return resolveOperatorPricingCatalog({});
      },
    });
    assert.deepEqual(calls, ["auth:operator_member", "resolve"]);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");

    let resolved = false;
    const denied = await handlePricingCatalog("consumer", {
      async requireRole() { throw { status: 403 }; },
      resolveCatalog() { resolved = true; throw new Error("must not resolve"); },
    });
    assert.equal(resolved, false);
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { error: "forbidden" });
  });

  it("collapses resolver and unknown failures without partial catalog data", async () => {
    const response = await handlePricingCatalog("platform_admin", {
      async requireRole() {},
      resolveCatalog() { throw new Error("internal configuration detail"); },
    });
    assert.equal(response.status, 500);
    // R5B-03: the redacted code is unchanged and the correlation id is the only field added.
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.error, "pricing_unavailable");
    assert.deepEqual(Object.keys(body).sort(), ["correlationId", "error"]);
    assert.equal(JSON.stringify(body).includes("internal configuration detail"), false);
  });
});

describe("paid refresh HTTP mapping", () => {
  it("requires an exact same-origin header", () => {
    assert.equal(sameOrigin(new Request("https://app.example/api/refresh-now", {
      method: "POST",
      headers: { origin: "https://app.example" },
    })), true);
    assert.equal(sameOrigin(new Request("https://app.example/api/refresh-now", {
      method: "POST",
    })), false);
    assert.equal(sameOrigin(new Request("https://app.example/api/refresh-now", {
      method: "POST",
      headers: { origin: "https://other.example" },
    })), false);
  });

  it("maps queued success and every closed domain outcome without provider detail", async () => {
    const success = mapPaidRefreshResult({
      ok: true,
      status: "queued",
      requestId: "request-id",
      analysisRunId: "analysis-id",
      amountCents: 1_900,
      currency: "usd",
    });
    assert.equal(success.status, 202);
    assert.deepEqual(await success.json(), {
      requestId: "request-id",
      analysisRunId: "analysis-id",
      status: "queued",
      amountCents: 1_900,
      currency: "usd",
    });

    const expected = {
      dependency_disabled: 503,
      cap_denied: 429,
      payment_source_unavailable: 409,
      payment_failed: 402,
      payment_requires_action: 402,
      request_in_progress: 409,
      analysis_unavailable: 503,
    } as const;
    for (const [reason, status] of Object.entries(expected)) {
      const response = mapPaidRefreshResult({
        ok: false,
        reason: reason as keyof typeof expected,
        requestId: "request-id",
      });
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { error: reason });
    }
  });

  it("maps authorization and internal exceptions to one-key errors", async () => {
    const unauthorized = mapPaidRefreshFailure({ status: 401, providerBody: "hidden" });
    assert.equal(unauthorized.status, 401);
    assert.deepEqual(await unauthorized.json(), { error: "unauthenticated" });
    const unavailable = mapPaidRefreshFailure(new Error("provider account detail"));
    assert.equal(unavailable.status, 500);
    // R5C-07: the mapper that used to answer with no log, no id and no stage.
    const body = await unavailable.json() as Record<string, unknown>;
    assert.equal(body.error, "paid_refresh_unavailable");
    assert.deepEqual(Object.keys(body).sort(), ["correlationId", "error"]);
    assert.equal(JSON.stringify(body).includes("provider account detail"), false);
  });
});
