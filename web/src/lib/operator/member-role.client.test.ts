import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { updateOperatorTeamMemberRole } from "./member-role.client.ts";

const MEMBER = "41900000-0000-4000-8000-000000000013";

describe("operator member role client", () => {
  it("writes the exact role route and accepts identity-bound readback", async () => {
    let input = "";
    let init: RequestInit | undefined;
    const result = await updateOperatorTeamMemberRole(MEMBER, "manager", async (nextInput, nextInit) => {
      input = String(nextInput);
      init = nextInit;
      return Response.json({ member: { applied: true, orgId: "org", orgRole: "manager", profileId: MEMBER } });
    });
    assert.equal(input, `/api/invites/members/${MEMBER}/role`);
    assert.equal(init?.method, "PATCH");
    assert.deepEqual(JSON.parse(String(init?.body)), { orgRole: "manager" });
    assert.equal(result.orgRole, "manager");
  });

  it("rejects mismatched readback and maps last-owner conflict", async () => {
    await assert.rejects(
      updateOperatorTeamMemberRole(MEMBER, "admin", async () => Response.json({ member: { applied: true, orgId: "org", orgRole: "admin", profileId: "other" } })),
      /response was invalid/,
    );
    await assert.rejects(
      updateOperatorTeamMemberRole(MEMBER, "admin", async () => Response.json({}, { status: 409 })),
      /Assign another active owner/,
    );
  });
});
