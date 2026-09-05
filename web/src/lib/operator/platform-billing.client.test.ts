import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  loadPlatformBilling,
  openPlatformBillingPortal,
  parsePlatformBillingState,
  platformBillingProvider,
  startPlatformCheckout,
} from "./platform-billing.client.ts";

const RECORD = {
  cancelAtPeriodEnd: false,
  clientMeter: { cap: 50, count: 12, label: "12/50" },
  currentPeriodEnd: "2026-10-05T00:00:00.000Z",
  graceUntil: null,
  membership: "current",
  plan: "agency",
  seatQuantity: 4,
  seatSync: null,
  seatsIncluded: 5,
  status: "active",
  subscriptionRef: "mock_sub_1",
};

describe("platform billing client", () => {
  it("reads the subscription route with the session and returns the record as sent", async () => {
    let input = "";
    let init: RequestInit | undefined;
    const read = await loadPlatformBilling(async (nextInput, nextInit) => {
      input = String(nextInput);
      init = nextInit;
      return Response.json({ billing: RECORD, enabled: true });
    });
    assert.equal(input, "/api/billing/subscription");
    assert.equal(init?.credentials, "same-origin");
    assert.equal(init?.cache, "no-store");
    assert.equal(read.state, "ready");
    if (read.state === "ready") {
      assert.deepEqual(read.billing, RECORD);
      assert.equal(platformBillingProvider(read.billing), "mock");
    }
  });

  it("names every answer the route can give", async () => {
    const cases: Array<[Response, string]> = [
      [Response.json({ enabled: false }), "disabled"],
      [Response.json({ error: { code: "session_required", message: "x" } }, { status: 401 }), "session_required"],
      [Response.json({ error: { code: "role_forbidden", message: "x" } }, { status: 403 }), "forbidden"],
      [Response.json({ error: { code: "org_deactivated", message: "x" } }, { status: 402 }), "deactivated"],
      [Response.json({ billing: null, enabled: true }), "no_record"],
      [Response.json({ error: { code: "billing_unavailable", message: "x" } }, { status: 500 }), "unavailable"],
      [Response.json({ billing: { plan: "agency" }, enabled: true }), "unavailable"],
    ];
    for (const [response, expected] of cases) {
      const read = await loadPlatformBilling(async () => response);
      assert.equal(read.state, expected);
    }
    const failed = await loadPlatformBilling(async () => { throw new Error("offline"); });
    assert.equal(failed.state, "unavailable");
  });

  it("rejects a record missing any field rather than rendering a zero", () => {
    assert.ok(parsePlatformBillingState(RECORD));
    assert.ok(parsePlatformBillingState({ ...RECORD, seatSync: { attempts: 1, desiredQuantity: 6, status: "pending" } }));
    assert.equal(parsePlatformBillingState({ ...RECORD, seatQuantity: undefined }), null);
    assert.equal(parsePlatformBillingState({ ...RECORD, membership: "gold" }), null);
    assert.equal(parsePlatformBillingState({ ...RECORD, status: "unknown_status" }), null);
    assert.equal(parsePlatformBillingState({ ...RECORD, clientMeter: { count: 1 } }), null);
    assert.equal(parsePlatformBillingState({ ...RECORD, seatSync: { attempts: 1 } }), null);
  });

  it("tells a stripe reference from a mock one and admits it cannot tell without one", () => {
    assert.equal(platformBillingProvider({ subscriptionRef: "sub_123" }), "stripe");
    assert.equal(platformBillingProvider({ subscriptionRef: "mock_sub_1" }), "mock");
    assert.equal(platformBillingProvider({ subscriptionRef: null }), null);
  });

  it("posts an empty body to checkout and portal and returns only an http url", async () => {
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ init, input: String(input) });
      return Response.json({ url: "https://billing.example/session" });
    };
    assert.equal(await startPlatformCheckout(fetcher), "https://billing.example/session");
    assert.equal(await openPlatformBillingPortal(fetcher), "https://billing.example/session");
    assert.deepEqual(calls.map((call) => call.input), ["/api/billing/checkout", "/api/billing/portal"]);
    for (const call of calls) {
      assert.equal(call.init?.method, "POST");
      assert.equal(call.init?.credentials, "same-origin");
      assert.equal(call.init?.body, undefined);
    }
    await assert.rejects(
      startPlatformCheckout(async () => Response.json({ url: "javascript:alert(1)" })),
      /link was not returned/,
    );
  });

  it("maps every named route failure to plain wording", async () => {
    const cases: Array<[Response, RegExp]> = [
      [new Response(null, { status: 404 }), /not turned on for this deployment/],
      [Response.json({ error: { code: "billing_unconfigured" } }, { status: 503 }), /not configured/],
      [Response.json({ error: { code: "unauthenticated" } }, { status: 401 }), /Sign in again/],
      [Response.json({ error: { code: "forbidden" } }, { status: 403 }), /owners and admins/],
      [Response.json({ error: { code: "ORG_DEACTIVATED" } }, { status: 402 }), /deactivated/],
      [Response.json({ error: { code: "BILLING_CUSTOMER_REQUIRED" } }, { status: 409 }), /Start a subscription first/],
      [Response.json({ error: { code: "BILLING_SUBSCRIPTION_INTENT_CONFLICT" } }, { status: 409 }), /already in progress/],
      [Response.json({ error: { code: "BILLING_PROVIDER_UNAVAILABLE" } }, { status: 502 }), /did not answer/],
      [Response.json({ error: { code: "billing_unavailable" } }, { status: 500 }), /could not be opened/],
    ];
    for (const [response, expected] of cases) {
      await assert.rejects(openPlatformBillingPortal(async () => response), expected);
    }
  });
});
