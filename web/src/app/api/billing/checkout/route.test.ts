import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BillingOperationsError } from "@/lib/billing/service-operations";
import { handleCheckout, POST } from "./route.ts";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR = { id: "22222222-2222-4222-8222-222222222222", orgId: ORG_ID, orgMembership: "current" as const, orgRole: "owner", role: "operator_member" as const };

function request(body?: unknown, query = "") {
  return new Request(`https://app.example.test/api/billing/checkout${query}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    method: "POST",
  });
}

function dependencies(calls: string[]) {
  return {
    async requireOrgMember() { calls.push("auth"); return ACTOR; },
    async assertTenantWriteAllowed() { calls.push("wall"); },
    async createCheckout(orgId: string) { calls.push(`checkout:${orgId}`); return { url: "https://billing.mock.local/checkout/test" }; },
  };
}

describe("checkout route", () => {
  it("returns 404 from the real route while the flag is off", async () => {
    const previous = process.env.FEATURE_BILLING_OPS;
    delete process.env.FEATURE_BILLING_OPS;
    try { assert.equal((await POST(request())).status, 404); }
    finally {
      if (previous === undefined) delete process.env.FEATURE_BILLING_OPS;
      else process.env.FEATURE_BILLING_OPS = previous;
    }
  });

  it("orders auth, owner check, tenant wall and service", async () => {
    const calls: string[] = [];
    const response = await handleCheckout(request({}), dependencies(calls));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { url: "https://billing.mock.local/checkout/test" });
    assert.deepEqual(calls, ["auth", "wall", `checkout:${ORG_ID}`]);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  });

  it("rejects caller-controlled keys and query values before auth", async () => {
    for (const invalid of [request({ customerRef: "cus_other" }), request({ successUrl: "https://other.test" }), request({}, "?orgId=other")]) {
      const calls: string[] = [];
      assert.equal((await handleCheckout(invalid, dependencies(calls))).status, 400);
      assert.deepEqual(calls, []);
    }
  });

  it("refuses non-owner roles and wall denials before provider access", async () => {
    let provider = 0;
    const forbidden = await handleCheckout(request(), {
      async requireOrgMember() { return { ...ACTOR, orgRole: "member" }; },
      async assertTenantWriteAllowed() { throw new Error(); },
      async createCheckout() { provider += 1; return { url: "" }; },
    });
    const walled = await handleCheckout(request(), {
      async requireOrgMember() { return ACTOR; },
      async assertTenantWriteAllowed() { throw { code: "ORG_DEACTIVATED" }; },
      async createCheckout() { provider += 1; return { url: "" }; },
    });
    assert.equal(forbidden.status, 403);
    assert.equal(walled.status, 402);
    assert.equal(provider, 0);
  });

  it("maps configuration and provider failures without their messages", async () => {
    for (const [error, status] of [
      [Object.assign(new Error("credential value"), { name: "MisconfiguredDriverError" }), 503],
      [new BillingOperationsError(502, "BILLING_PROVIDER_UNAVAILABLE", "provider detail"), 502],
      [new BillingOperationsError(409, "BILLING_SUBSCRIPTION_INTENT_CONFLICT", "conflict detail"), 409],
    ] as const) {
      const response = await handleCheckout(request(), {
        async requireOrgMember() { return ACTOR; },
        async assertTenantWriteAllowed() {},
        async createCheckout() { throw error; },
      });
      assert.equal(response.status, status);
      const text = await response.text();
      assert.equal(text.includes(error.message), false);
    }
  });
});
