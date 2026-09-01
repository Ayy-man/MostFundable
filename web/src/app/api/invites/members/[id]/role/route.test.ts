import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createMemberRoleService } from "@/lib/tenancy/member-role";
import { TenantBillingWallError } from "@/lib/tenancy/errors";
import { handleMemberRoleUpdate } from "./route.ts";

const ORG = "41900000-0000-4000-8000-000000000001";
const TARGET = "41900000-0000-4000-8000-000000000013";
const session = {
  disabledAt: null,
  id: "41900000-0000-4000-8000-000000000011",
  manages: [],
  orgId: ORG,
  orgMembership: "current" as const,
  orgRole: "owner" as const,
  role: "operator_member" as const,
};

function request() {
  return new Request(`https://mf.test/api/invites/members/${TARGET}/role`, {
    body: JSON.stringify({ orgRole: "admin" }),
    method: "PATCH",
  });
}

describe("member role route", () => {
  it("returns an opaque flag-off response before auth or params", async () => {
    let touched = false;
    const params = { then() { touched = true; throw new Error(); } } as unknown as Promise<{ id: string }>;
    const response = await handleMemberRoleUpdate(request(), { params }, {
      enabled: () => false,
      async requireOperator() { touched = true; return session; },
      async service() { touched = true; throw new Error(); },
      async wall() { touched = true; },
    });
    assert.equal(response.status, 404);
    assert.equal(touched, false);
  });

  it("runs auth and the tenant wall before one closed service mutation", async () => {
    const events: string[] = [];
    const response = await handleMemberRoleUpdate(request(), { params: Promise.resolve({ id: TARGET }) }, {
      enabled: () => true,
      async requireOperator() { events.push("auth"); return session; },
      async wall() { events.push("wall"); },
      async service() {
        return createMemberRoleService({ async rpc() {
          events.push("rpc");
          return { data: { applied: true, org_id: ORG, org_role: "admin", profile_id: TARGET }, error: null };
        } });
      },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(events, ["auth", "wall", "rpc"]);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  it("does not mutate after the tenant wall refuses", async () => {
    let calls = 0;
    const response = await handleMemberRoleUpdate(request(), { params: Promise.resolve({ id: TARGET }) }, {
      enabled: () => true,
      async requireOperator() { return session; },
      async wall() { throw new TenantBillingWallError(); },
      async service() { calls += 1; throw new Error(); },
    });
    assert.equal(response.status, 402);
    assert.equal(calls, 0);
  });
});
