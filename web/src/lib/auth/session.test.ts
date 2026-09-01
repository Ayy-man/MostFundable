import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";

import type { OperatorMembership } from "@/lib/billing/types";
import {
  mapSessionProfileRow,
  SESSION_PROFILE_SELECT,
  type SessionProfileRow,
} from "./session.ts";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";

function row(
  membership: OperatorMembership | null,
  overrides: Partial<SessionProfileRow> = {},
): SessionProfileRow {
  return {
    disabled_at: null,
    id: PROFILE_ID,
    manages: ["22222222-2222-4222-8222-222222222222"],
    org_id: membership ? "33333333-3333-4333-8333-333333333333" : null,
    org_role: membership ? "owner" : null,
    orgs: membership ? { membership } : null,
    role: membership ? "operator_member" : "platform_admin",
    ...overrides,
  };
}

describe("session profile mapping", () => {
  for (const membership of [
    "trial",
    "current",
    "past_due",
    "grace",
    "deactivated",
  ] as const) {
    test(`exposes ${membership} organization membership`, () => {
      assert.equal(mapSessionProfileRow(row(membership))?.orgMembership, membership);
    });
  }

  test("accepts the relation array shape returned by some Supabase clients", () => {
    assert.equal(
      mapSessionProfileRow(row("current", { orgs: [{ membership: "current" }] }))
        ?.orgMembership,
      "current",
    );
  });

  test("keeps the platform-admin null organization behavior", () => {
    assert.deepEqual(mapSessionProfileRow(row(null)), {
      disabledAt: null,
      id: PROFILE_ID,
      manages: ["22222222-2222-4222-8222-222222222222"],
      orgId: null,
      orgMembership: null,
      orgRole: null,
      role: "platform_admin",
    });
  });

  test("keeps fixture fields unchanged when the new columns are null", () => {
    const mapped = mapSessionProfileRow(row("trial"));
    assert.deepEqual(
      mapped && {
        id: mapped.id,
        manages: mapped.manages,
        orgId: mapped.orgId,
        orgRole: mapped.orgRole,
        role: mapped.role,
      },
      {
        id: PROFILE_ID,
        manages: ["22222222-2222-4222-8222-222222222222"],
        orgId: "33333333-3333-4333-8333-333333333333",
        orgRole: "owner",
        role: "operator_member",
      },
    );
  });

  test("rejects a disabled user-backed profile", () => {
    assert.equal(
      mapSessionProfileRow(row("current", { disabled_at: "2026-08-17T01:00:00Z" })),
      null,
    );
  });

  test("rejects a disabled admin-backed fixture profile", () => {
    assert.equal(
      mapSessionProfileRow(row(null, { disabled_at: "2026-08-17T01:00:00Z" })),
      null,
    );
  });

  test("both database readers select the membership relation and disabled marker", async () => {
    assert.equal(SESSION_PROFILE_SELECT.includes("disabled_at"), true);
    assert.equal(
      SESSION_PROFILE_SELECT.includes("orgs!profiles_org_id_fkey(membership)"),
      true,
    );
    const source = await readFile(new URL("./session.ts", import.meta.url), "utf8");
    assert.equal(source.match(/\.select\(SESSION_PROFILE_SELECT\)/g)?.length, 2);
    assert.equal(source.match(/mapSessionProfileRow\(data/g)?.length, 2);
  });
});
