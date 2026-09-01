import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TenantError } from "./errors.ts";
import { createMemberRoleService, parseOperatorMemberRoleBody } from "./member-role.ts";

const ORG = "41900000-0000-4000-8000-000000000001";
const ACTOR = "41900000-0000-4000-8000-000000000011";
const TARGET = "41900000-0000-4000-8000-000000000013";
const session = {
  disabledAt: null,
  id: ACTOR,
  manages: [],
  orgId: ORG,
  orgMembership: "current" as const,
  orgRole: "owner" as const,
  role: "operator_member" as const,
};

describe("operator member role service", () => {
  it("accepts only one known role field", () => {
    assert.deepEqual(parseOperatorMemberRoleBody({ orgRole: "funding_specialist" }), { orgRole: "funding_specialist" });
    for (const body of [{}, { orgRole: "root" }, { orgRole: "admin", other: true }, null]) {
      assert.throws(() => parseOperatorMemberRoleBody(body), TenantError);
    }
  });

  it("anchors actor, target, and role in the service-only RPC and validates readback", async () => {
    let args: Record<string, unknown> | null = null;
    const result = await createMemberRoleService({
      async rpc(name, input) {
        assert.equal(name, "tenancy_update_member_role");
        args = input;
        return { data: { applied: true, org_id: ORG, org_role: "manager", profile_id: TARGET }, error: null };
      },
    }).update({ actor: session, body: { orgRole: "manager" }, targetId: TARGET });
    assert.deepEqual(args, { p_actor_id: ACTOR, p_org_role: "manager", p_target_id: TARGET });
    assert.deepEqual(result, { applied: true, orgId: ORG, orgRole: "manager", profileId: TARGET });
  });

  it("refuses non-managers before an RPC and maps the last-owner invariant", async () => {
    let calls = 0;
    const service = createMemberRoleService({
      async rpc() { calls += 1; return { data: null, error: { code: "22023", message: "TENANT_LAST_OWNER_ROLE_FORBIDDEN" } }; },
    });
    await assert.rejects(
      service.update({ actor: { ...session, orgRole: "member" }, body: { orgRole: "admin" }, targetId: TARGET }),
      (error) => error instanceof TenantError && error.status === 403,
    );
    assert.equal(calls, 0);
    await assert.rejects(
      service.update({ actor: session, body: { orgRole: "admin" }, targetId: TARGET }),
      (error) => error instanceof TenantError && error.status === 409,
    );
  });

  it("rejects a successful response whose tenant identity changed", async () => {
    await assert.rejects(
      createMemberRoleService({ async rpc() {
        return { data: { applied: true, org_id: "41900000-0000-4000-8000-000000000999", org_role: "admin", profile_id: TARGET }, error: null };
      } }).update({ actor: session, body: { orgRole: "admin" }, targetId: TARGET }),
      (error) => error instanceof TenantError && error.status === 500,
    );
  });
});
