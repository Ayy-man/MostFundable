import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  handleOperatorPlatformRevenue,
  type OperatorPlatformRevenueDependencies,
} from "./platform-revenue.server.ts";

const ORG = "00000000-0000-4000-8000-000000004084";
const payload = { ledger: null, month: "2026-09", roster: [] } as const;

function dependencies(role: string | null = "owner"): OperatorPlatformRevenueDependencies {
  return {
    async read(orgId, month) {
      assert.equal(orgId, ORG);
      assert.equal(month, "2026-09");
      return payload;
    },
    async requireOperator() { return { id: "operator", orgId: ORG, orgRole: role }; },
  };
}

describe("operator platform revenue handler", () => {
  it("returns a private, tenant-scoped monthly projection", async () => {
    const response = await handleOperatorPlatformRevenue(
      new Request("https://example.test/api/operator/platform-revenue?month=2026-09"),
      dependencies(),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), payload);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  });

  it("keeps financial rows to workspace owners and admins", async () => {
    const response = await handleOperatorPlatformRevenue(
      new Request("https://example.test/api/operator/platform-revenue?month=2026-09"),
      dependencies("member"),
    );
    assert.equal(response.status, 403);
  });

  it("rejects malformed and widened filters before reading", async () => {
    let reads = 0;
    const base = dependencies();
    const supplied = { ...base, async read() { reads += 1; return payload; } };
    const malformed = await handleOperatorPlatformRevenue(
      new Request("https://example.test/api/operator/platform-revenue?month=2026-13"),
      supplied,
    );
    const widened = await handleOperatorPlatformRevenue(
      new Request("https://example.test/api/operator/platform-revenue?month=2026-09&org=other"),
      supplied,
    );
    assert.equal(malformed.status, 400);
    assert.equal(widened.status, 400);
    assert.equal(reads, 0);
  });
});
