import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SettlementError } from "@/lib/revenue/settlement";
import { handlePatchSettlement, PATCH } from "./route.ts";

const LEDGER_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";

function request(body: unknown): Request {
  return new Request("http://local/api/revenue/settlement", {
    body: typeof body === "string" ? body : JSON.stringify(body),
    method: "PATCH",
  });
}

function dependencies(calls: unknown[]) {
  return {
    async requirePlatformAdmin() { return { id: ACTOR_ID, role: "platform_admin" as const }; },
    async markSettlement(input: {
      expectedStatus: "accrued" | "exported";
      kind: "operator" | "referral";
      ledgerId: string;
      status: "exported" | "paid";
    }) {
      calls.push(input);
      return { ledger: input.kind, ledgerId: input.ledgerId, status: input.status };
    },
  };
}

describe("settlement route", () => {
  it("returns 404 before domain loading while the billing-ops flag is off", async () => {
    const previous = process.env.FEATURE_BILLING_OPS;
    delete process.env.FEATURE_BILLING_OPS;
    try {
      assert.equal((await PATCH(request({}))).status, 404);
    } finally {
      if (previous === undefined) delete process.env.FEATURE_BILLING_OPS;
      else process.env.FEATURE_BILLING_OPS = previous;
    }
  });

  it("refuses missing authority before parsing or repository access", async () => {
    let calls = 0;
    for (const status of [401, 403] as const) {
      const response = await handlePatchSettlement(request("not-json"), {
        async requirePlatformAdmin() { throw { status }; },
        async markSettlement() { calls += 1; throw new Error(); },
      });
      assert.equal(response.status, status);
    }
    assert.equal(calls, 0);
  });

  it("accepts both valid transitions and derives the actor from the session", async () => {
    for (const [expectedStatus, status, kind] of [
      ["accrued", "exported", "operator"],
      ["exported", "paid", "referral"],
    ] as const) {
      const calls: unknown[] = [];
      const response = await handlePatchSettlement(request({ expectedStatus, ledger: kind, ledgerId: LEDGER_ID, status }), dependencies(calls));
      assert.equal(response.status, 200);
      assert.deepEqual(calls, [{ actorId: ACTOR_ID, expectedStatus, kind, ledgerId: LEDGER_ID, status }]);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
    }
  });

  it("rejects malformed, extra-key and reversed-target bodies before repository access", async () => {
    for (const body of [
      "not-json",
      { expectedStatus: "accrued", ledger: "operator", ledgerId: "bad", status: "exported" },
      { expectedStatus: "accrued", ledger: "operator", ledgerId: LEDGER_ID, status: "paid" },
      { expectedStatus: "exported", ledger: "operator", ledgerId: LEDGER_ID, status: "reversed" },
      { amount: 1, expectedStatus: "accrued", ledger: "operator", ledgerId: LEDGER_ID, status: "exported" },
    ]) {
      const calls: unknown[] = [];
      const response = await handlePatchSettlement(request(body), dependencies(calls));
      assert.equal(response.status, 400);
      assert.deepEqual(calls, []);
    }
  });

  it("maps stale and not-found errors without exposing their message", async () => {
    for (const error of [
      new SettlementError(409, "SETTLEMENT_STALE", "database detail"),
      new SettlementError(404, "SETTLEMENT_NOT_FOUND", "database detail"),
    ]) {
      const response = await handlePatchSettlement(request({ expectedStatus: "accrued", ledger: "operator", ledgerId: LEDGER_ID, status: "exported" }), {
        async requirePlatformAdmin() { return { id: ACTOR_ID, role: "platform_admin" }; },
        async markSettlement() { throw error; },
      });
      assert.equal(response.status, error.status);
      assert.equal((await response.text()).includes("database detail"), false);
    }
  });
});
