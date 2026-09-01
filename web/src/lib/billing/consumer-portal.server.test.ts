import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  handleConsumerBillingPortal,
  type ConsumerPortalDependencies,
} from "./consumer-portal.server.ts";

const ORG = "00000000-0000-4000-8000-000000004201";
const PROFILE = "00000000-0000-4000-8000-000000004202";

function request(body?: string, query = ""): Request {
  return new Request(`https://app.example.test/api/consumer/billing-portal${query}`, {
    ...(body === undefined ? {} : { body }),
    method: "POST",
  });
}

function dependencies(overrides: Partial<ConsumerPortalDependencies> = {}): ConsumerPortalDependencies {
  return {
    async createPortal(input) {
      assert.deepEqual(input, {
        customerRef: "cus_scoped",
        orgId: ORG,
        returnUrl: "https://app.example.test/consumer",
      });
      return { url: "https://billing.example.test/session" };
    },
    driver: () => "stripe",
    async readSource(profileId, orgId) {
      assert.deepEqual([profileId, orgId], [PROFILE, ORG]);
      return { customerRef: "cus_scoped", orgId: ORG, provider: "stripe" };
    },
    async requireConsumer() { return { id: PROFILE, orgId: ORG, role: "consumer" }; },
    ...overrides,
  };
}

describe("consumer hosted billing portal", () => {
  it("uses only the authenticated consumer source and returns a private hosted URL", async () => {
    const response = await handleConsumerBillingPortal(request(), dependencies());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { url: "https://billing.example.test/session" });
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  });

  it("rejects caller scoping, redirect inputs, and non-empty bodies before dependencies", async () => {
    let calls = 0;
    const deps = dependencies({
      async requireConsumer() { calls += 1; throw new Error("must not run"); },
    });
    for (const invalid of [request('{"clientId":"other"}'), request("{}", "?returnUrl=https://other.test")]) {
      const response = await handleConsumerBillingPortal(invalid, deps);
      assert.equal(response.status, 400);
    }
    assert.equal(calls, 0);
  });

  it("does not call the provider without a scoped billing customer", async () => {
    let portals = 0;
    const response = await handleConsumerBillingPortal(request(), dependencies({
      async createPortal() { portals += 1; throw new Error("must not run"); },
      async readSource() { return null; },
    }));
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: { code: "billing_customer_unavailable" } });
    assert.equal(portals, 0);
  });

  it("fails closed when the durable source and configured provider disagree", async () => {
    const response = await handleConsumerBillingPortal(request(), dependencies({ driver: () => "mock" }));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: { code: "billing_provider_unconfigured" } });
  });

  it("refuses a non-HTTPS provider result", async () => {
    const response = await handleConsumerBillingPortal(request(), dependencies({
      async createPortal() { return { url: "http://billing.example.test/session" }; },
    }));
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: { code: "billing_provider_result_invalid" } });
  });
});
