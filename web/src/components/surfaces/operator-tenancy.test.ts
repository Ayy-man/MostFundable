import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";

import {
  createOperatorAffiliateInvite,
  createOperatorTeamInvite,
  publishOperatorBrand,
  updateOperatorBrand,
} from "./operator-tenancy.ts";

describe("operator tenancy controls", () => {
  test("typed invite failure creates no pending member", async () => {
    const created: unknown[] = [];
    const failures: unknown[] = [];
    await createOperatorTeamInvite({ email: "team@example.test", fullName: "Team" }, {
      created(value) { created.push(value); },
      failed(value) { failures.push(value); },
    }, async () => Response.json({
      error: { code: "ORG_DEACTIVATED", message: "This organization is deactivated." },
    }, { status: 402 }), "11111111-1111-4111-8111-111111111111");

    assert.deepEqual(created, [], "a failed invite must create no pending member");
    assert.deepEqual(failures, [{
      code: "ORG_DEACTIVATED",
      message: "This organization is deactivated.",
      status: 402,
    }]);
  });

  test("successful invite uses the closed payload and returned durable id", async () => {
    const calls: Array<{ body: unknown; headers: Headers; method: string; path: string }> = [];
    const created: unknown[] = [];
    await createOperatorTeamInvite({ email: "team@example.test", fullName: "Team Member" }, {
      created(value) { created.push(value); },
      failed(failure) { assert.fail(JSON.stringify(failure)); },
    }, async (path, init) => {
      calls.push({ body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers), method: String(init?.method), path });
      return Response.json({ invite: { inviteId: "22222222-2222-4222-8222-222222222222", orgId: "33333333-3333-4333-8333-333333333333" } }, { status: 201 });
    }, "11111111-1111-4111-8111-111111111111");

    assert.deepEqual(calls[0]?.body, {
      email: "team@example.test",
      fullName: "Team Member",
      kind: "team",
      orgRole: "member",
    });
    assert.equal(calls[0]?.headers.get("Idempotency-Key"), "11111111-1111-4111-8111-111111111111");
    assert.equal((created[0] as { inviteId: string }).inviteId, "22222222-2222-4222-8222-222222222222");
  });

  test("affiliate invitations use the affiliate kind without a workspace role", async () => {
    const calls: unknown[] = [];
    await createOperatorAffiliateInvite({ email: "partner@example.test", fullName: "Referral Partner" }, {
      created() {},
      failed(failure) { assert.fail(JSON.stringify(failure)); },
    }, async (_path, init) => {
      calls.push(JSON.parse(String(init?.body)));
      return Response.json({
        invite: {
          inviteId: "22222222-2222-4222-8222-222222222222",
          orgId: "33333333-3333-4333-8333-333333333333",
        },
      }, { status: 201 });
    }, "11111111-1111-4111-8111-111111111111");

    assert.deepEqual(calls, [{
      email: "partner@example.test",
      fullName: "Referral Partner",
      kind: "affiliate",
      orgRole: null,
    }]);
  });

  test("brand state changes only from PATCH and publish response truth", async () => {
    const brands: unknown[] = [];
    const publications: string[] = [];
    const failures: unknown[] = [];
    await updateOperatorBrand("#1d4ed8", {
      changed(brand) { brands.push(brand); },
      failed(value) { failures.push(value); },
    }, async () => Response.json({ error: { code: "INVALID_TENANT_INPUT", message: "The brand input is invalid." } }, { status: 400 }));
    assert.deepEqual(brands, [], "a failed brand PATCH must not create draft success");

    const successfulBrands: unknown[] = [];
    await updateOperatorBrand("#1d4ed8", {
      changed(brand) { successfulBrands.push(brand); },
      failed(failure) { assert.fail(JSON.stringify(failure)); },
    }, async () => Response.json({ brand: { accentColor: "#1d4ed8", primaryColor: "#123456" } }));
    await publishOperatorBrand({
      failed(failure) { assert.fail(JSON.stringify(failure)); },
      published(value) { publications.push(value); },
    }, async () => Response.json({ brand: { publishedAt: "2026-08-17T02:00:00Z" } }));
    assert.deepEqual(successfulBrands, [{ accentColor: "#1d4ed8", primaryColor: "#123456" }]);
    assert.deepEqual(publications, ["2026-08-17T02:00:00Z"]);
    assert.equal(failures.length, 1);
  });

  test("the server flag is threaded through both component boundaries", async () => {
    const page = await readFile(new URL("../../app/(surfaces)/operator/page.tsx", import.meta.url), "utf8");
    const wrapper = await readFile(new URL("../../app/(surfaces)/operator/surface-client.tsx", import.meta.url), "utf8");
    assert.match(page, /tenancyEnabled=\{tenancyEnabled\}/);
    assert.match(wrapper, /tenancyEnabled=\{tenancyEnabled\}/);
  });
});

describe("durable operator team member deactivation", () => {
  async function teamSource() {
    const source = await readFile(new URL("./operator.tsx", import.meta.url), "utf8");
    const start = source.indexOf("function renderTeam()");
    const end = source.indexOf("function renderSettings()", start);
    assert.ok(start >= 0 && end > start, "missing operator Team section");
    return { source, team: source.slice(start, end) };
  }

  test("posts the durable member id and verifies the route response", async () => {
    const { source } = await teamSource();
    const start = source.indexOf("async function deactivateOperatorTeamMember");
    const end = source.indexOf("function localDateOnly", start);
    assert.ok(start >= 0 && end > start, "missing member deactivation client");
    const helper = source.slice(start, end);
    assert.match(helper, /!isTrackerUuid\(memberId\)/);
    assert.match(helper, /`\/api\/invites\/members\/\$\{encodeURIComponent\(memberId\)\}\/deactivate`/);
    assert.match(helper, /cache: "no-store"[\s\S]*?credentials: "same-origin"[\s\S]*?method: "POST"/);
    assert.match(helper, /member\?\.profileId !== memberId/);
    assert.match(helper, /typeof member\.applied !== "boolean"/);
  });

  test("offers deactivation only for a proven active non-owner, non-self durable member", async () => {
    const { team } = await teamSource();
    assert.match(team, /sessionIdentity\?\.orgRole === "owner" \|\| sessionIdentity\?\.orgRole === "admin"/);
    assert.match(team, /isTrackerUuid\(selectedTeamMember\.id\)/);
    assert.match(team, /selectedTeamMember\.active/);
    assert.match(team, /!selectedTeamMember\.isCurrentUser/);
    assert.match(team, /selectedTeamMember\.role !== null/);
    assert.match(team, /selectedTeamMember\.role !== "Owner"/);
    assert.match(team, /canDeactivateSelectedTeamMember \? \(/);
    assert.match(team, />\s*Remove member\s*</);
    assert.match(team, /"Confirm deactivation"/);
  });

  test("re-reads the directory and confirms absence before reporting deactivation", async () => {
    const { team } = await teamSource();
    assert.match(team, /const readback = await readSupportInboxDirectory\(\)/);
    assert.match(team, /readback\.state !== "ready"/);
    assert.match(team, /inboxTeamOptions\(readback\.clients\)\.some\(\(row\) => row\.id === member\.id\)/);
    assert.match(team, /setTeamDirectory\(readback\)/);
    assert.match(team, /roster read-back confirmed deactivation/);
    assert.match(team, /server accepted the deactivation, but the workspace roster could not be read back/i);
  });

  test("changes stored roles with read-back and points reassignment to the durable tracker", async () => {
    const { team } = await teamSource();
    assert.match(team, /updateOperatorTeamMemberRole\(member\.id, orgRole\)/);
    assert.match(team, /const readback = await readSupportInboxDirectory\(\)/);
    assert.match(team, /stored\?\.orgRole !== result\.orgRole/);
    assert.match(team, /canChangeSelectedTeamMemberRole/);
    assert.match(team, /Open Clients, select a client, then use Manage client/);
    assert.match(team, /setClientOwnerOverrides/);
  });
});
