import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { AuthError } from "@/lib/auth/errors";
import { assertTenantWriteAllowed } from "@/lib/tenancy/wall";
import { GET, runAffiliatePortal } from "./route.ts";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const portal = {
  kpis: { active: 1, fundingRecordedCents: 5000, inPipeline: 1, sentLeads: 1 },
  rows: [{
    expectedCommissionCents: 500,
    fundedAmountCents: 5000,
    needsAttention: false,
    paymentStatus: "pending" as const,
    stage: "funded" as const,
    startedAt: "2026-08-16T00:00:00.000Z",
  }],
};

describe("affiliate portal route", () => {
  it("returns an empty 404 before any enabled-arm work", async () => {
    const response = await GET();
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "");
    assert.ok(source.indexOf('featureFlag("FEATURE_AFFILIATES"') < source.indexOf("runAffiliatePortal({"));
  });

  it("runs affiliate role, wall, and portal read exactly once in order", async () => {
    const calls: string[] = [];
    const response = await runAffiliatePortal({
      now: () => new Date("2026-08-16T12:00:00.000Z"),
      async requireAffiliate() {
        calls.push("role");
        return { id: "affiliate", orgMembership: null, role: "affiliate" };
      },
      async wall() { calls.push("wall"); },
      async read() { calls.push("read"); return portal; },
    });
    assert.deepEqual(calls, ["role", "wall", "read"]);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), portal);
  });

  it("does not call the wall or read after role refusal", async () => {
    const calls: string[] = [];
    const response = await runAffiliatePortal({
      now: () => new Date(),
      async requireAffiliate() { throw new AuthError(403, "forbidden", "private"); },
      async wall() { calls.push("wall"); },
      async read() { calls.push("read"); return portal; },
    });
    assert.equal(response.status, 403);
    assert.deepEqual(calls, []);
  });

  it("does not read the view after wall refusal", async () => {
    const calls: string[] = [];
    const response = await runAffiliatePortal({
      now: () => new Date(),
      async requireAffiliate() { return { id: "affiliate", orgMembership: null, role: "affiliate" }; },
      async wall() { calls.push("wall"); throw new Error("closed"); },
      async read() { calls.push("read"); return portal; },
    });
    assert.equal(response.status, 500);
    assert.deepEqual(calls, ["wall"]);
  });

  it("maps TenantBillingWallError to 402 ORG_DEACTIVATED before a view read", async () => {
    const calls: string[] = [];
    const response = await runAffiliatePortal({
      now: () => new Date("2026-08-16T00:00:00.000Z"),
      async read() { calls.push("read"); return portal; },
      async requireAffiliate() {
        return { id: "aff-1", orgMembership: "deactivated", role: "affiliate" };
      },
      wall: (session) => assertTenantWriteAllowed(session),
    });
    assert.equal(response.status, 402);
    assert.deepEqual(await response.json(), { error: "ORG_DEACTIVATED" });
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.deepEqual(calls, []);
    assert.ok(source.includes("assertTenantWriteAllowed(session)"));
  });

  it("contains no direct data source or operator-health access", () => {
    assert.doesNotMatch(source, /\.from\(|\.rpc\(|affiliate_client_shares|operator.health/);
  });
});
