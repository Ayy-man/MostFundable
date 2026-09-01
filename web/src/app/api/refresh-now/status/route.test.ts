import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { handlePaidRefreshStatusGet, type PaidRefreshStatusDependencies } from "./handler.ts";

import type { SessionProfile } from "@/lib/auth/session";

const CONSUMER: SessionProfile = {
  disabledAt: null,
  id: "a2000000-0000-0000-0000-000000000002",
  manages: [],
  orgId: "a0000000-0000-0000-0000-000000000001",
  orgMembership: null,
  orgRole: null,
  role: "consumer",
};

class FakeAuthError extends Error {
  readonly status: number;
  constructor(status: number) {
    super("auth");
    this.status = status;
  }
}

function dependencies(overrides: Partial<PaidRefreshStatusDependencies> = {}): PaidRefreshStatusDependencies {
  return {
    async read() { return []; },
    recordFailure() { return "correlation-1"; },
    async requireConsumer() { return CONSUMER; },
    ...overrides,
  };
}

describe("GET /api/refresh-now/status", () => {
  it("returns a private, uncacheable consumer DTO", async () => {
    const response = await handlePaidRefreshStatusGet(dependencies({
      async read() {
        return [{
          amountCents: 1900,
          completedAt: null,
          currency: "usd",
          paidAt: "2026-09-01T10:00:02.000Z",
          requestId: "request-1",
          requestedAt: "2026-09-01T10:00:00.000Z",
          status: "queued",
        }];
      },
    }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal((await response.json()).refreshes[0].status, "queued");
  });

  it("refuses missing and wrong-role sessions", async () => {
    for (const status of [401, 403]) {
      const response = await handlePaidRefreshStatusGet(dependencies({
        async requireConsumer() { throw new FakeAuthError(status); },
      }));
      assert.equal(response.status, status);
    }
  });

  it("returns a correlation-bearing 503 without leaking the cause", async () => {
    const response = await handlePaidRefreshStatusGet(dependencies({
      async read() { throw new Error("provider ref secret"); },
      recordFailure() { return "correlation-9"; },
    }));
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.correlationId, "correlation-9");
    assert.ok(!JSON.stringify(body).includes("provider ref secret"));
  });

  it("keeps durable history readable when purchase flags or providers are off", () => {
    const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /FEATURE_PAID_REFRESH|paidRefreshPurchasesReady|notFound/);
    assert.match(source, /requireRole\("consumer"\)/);
    assert.match(source, /readConsumerPaidRefreshHistory/);
  });
});
