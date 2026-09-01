import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BillingOperationsError } from "@/lib/billing/service-operations";
import { handlePortal, POST } from "./route.ts";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR = { id: "22222222-2222-4222-8222-222222222222", orgId: ORG_ID, orgMembership: "current" as const, orgRole: "admin", role: "operator_member" as const };

function request(body?: unknown, query = "") {
  return new Request(`https://app.example.test/api/billing/portal${query}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    method: "POST",
  });
}

function dependencies(calls: string[]) {
  return {
    async requireOrgMember() { calls.push("auth"); return ACTOR; },
    async assertTenantWriteAllowed() { calls.push("wall"); },
    async createPortal(orgId: string) { calls.push(`portal:${orgId}`); return { url: "https://billing.mock.local/portal/test" }; },
  };
}

describe("portal route", () => {
  it("returns 404 from the real route while the flag is off", async () => {
    const previous = process.env.FEATURE_BILLING_OPS;
    delete process.env.FEATURE_BILLING_OPS;
    try { assert.equal((await POST(request())).status, 404); }
    finally {
      if (previous === undefined) delete process.env.FEATURE_BILLING_OPS;
      else process.env.FEATURE_BILLING_OPS = previous;
    }
  });

  it("orders auth, tenant wall and tenant-scoped portal service", async () => {
    const calls: string[] = [];
    const response = await handlePortal(request({}), dependencies(calls));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { url: "https://billing.mock.local/portal/test" });
    assert.deepEqual(calls, ["auth", "wall", `portal:${ORG_ID}`]);
  });

  it("rejects customer, return URL and query keys before auth", async () => {
    for (const invalid of [request({ customerRef: "cus_other" }), request({ returnUrl: "https://other.test" }), request({}, "?orgId=other")]) {
      const calls: string[] = [];
      assert.equal((await handlePortal(invalid, dependencies(calls))).status, 400);
      assert.deepEqual(calls, []);
    }
  });

  it("maps missing customer and provider errors privately", async () => {
    for (const [error, status] of [
      [new BillingOperationsError(409, "BILLING_CUSTOMER_REQUIRED", "private customer state"), 409],
      [new BillingOperationsError(502, "BILLING_PROVIDER_UNAVAILABLE", "provider detail"), 502],
    ] as const) {
      const response = await handlePortal(request(), {
        async requireOrgMember() { return ACTOR; },
        async assertTenantWriteAllowed() {},
        async createPortal() { throw error; },
      });
      assert.equal(response.status, status);
      assert.equal((await response.text()).includes(error.message), false);
    }
  });
});
