import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { handlePostClient } from "./route.ts";

const list = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const patch = readFileSync(new URL("./[id]/route.ts", import.meta.url), "utf8");
const ORG_ID = "11111111-1111-4111-8111-111111111111";
const SESSION = {
  disabledAt: null,
  id: "22222222-2222-4222-8222-222222222222",
  manages: [],
  orgId: ORG_ID,
  orgMembership: "current" as const,
  orgRole: "owner" as const,
  role: "operator_member" as const,
};

function createRequest() {
  return new Request("http://localhost/api/clients", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName: "Ada Client" }),
  });
}

function dependencies(input: {
  billing?: boolean;
  capAt?: number;
  trackerError?: Error;
  wallError?: unknown;
}) {
  const calls: string[] = [];
  class CapError extends Error {}
  const capChecks = { count: 0 };
  return {
    calls,
    dependencies: {
      billingOpsEnabled: () => input.billing ?? true,
      async requireOrgMember() { calls.push("session"); return SESSION; },
      trackerEnabled: () => true,
      async assertTenantWriteAllowed() { calls.push("wall"); if (input.wallError) throw input.wallError; },
      async loadClientCap() {
        calls.push("load-cap");
        return {
          async assertClientCap() {
            calls.push("cap");
            capChecks.count += 1;
            if (input.capAt === capChecks.count) throw new CapError();
          },
          isClientCapError(error: unknown) { return error instanceof CapError; },
        };
      },
      isTrackerDataError(error: unknown) { return error === input.trackerError; },
      async createTrackerClient() {
        calls.push("create");
        if (input.trackerError) throw input.trackerError;
        return { outcome: "conflict" as const };
      },
    },
  };
}

describe("console client route contracts", () => {
  it("keeps the tracker parent gate first and the disabled envelope exact", () => {
    assert.ok(list.indexOf('featureFlag("FEATURE_TRACKER")') < list.indexOf('import("@/lib/auth/session")'));
    assert.match(list, /enabled: false, clients: \[\]/);
    assert.doesNotMatch(list.slice(0, list.indexOf("try {")), /consoleOpsEnabled/);
  });

  it("orders only when the server-side console capability is enabled", () => {
    assert.match(list, /const consoleOpsEnabled = featureFlag\("FEATURE_CONSOLE_OPS"\)/);
    assert.match(list, /consoleOpsEnabled \? orderTrackerClientsByHealth\(clients\) : clients/);
  });

  it("returns the current profile id beside the private durable roster projection", () => {
    assert.match(list, /currentProfileId: session\.id/);
    assert.match(list, /Cache-Control": "private, no-store"/);
  });

  it("accepts the explicit no-affiliate query value", () => {
    assert.match(list, /affiliate !== "none" && !isTrackerUuid\(affiliate\)/);
    assert.match(list, /\{ affiliate \}/);
  });

  it("keeps active as the default and accepts only the explicit archived or all lifecycle reads", () => {
    assert.match(list, /const status = params\.get\("status"\)/);
    assert.match(list, /status !== "all" && !isTrackerClientStatus\(status\)/);
    assert.match(list, /status must be active, archived, or all/);
    assert.match(list, /\.\.\.\(status \? \{ status \} : \{\}\)/);
  });

  it("returns the server-proven active same-workspace assignment directory", () => {
    assert.match(list, /listTrackerAssignableMembers/);
    assert.match(list, /Promise\.all\(\[[\s\S]*?listTrackerClients\(session, filters\)[\s\S]*?listTrackerAssignableMembers\(session\)/);
    assert.match(list, /assignableMembers,[\s\S]*?currentProfileId: session\.id/);
  });

  it("keeps stage handling before the additive status branch", () => {
    assert.ok(patch.indexOf('if ("stage" in parsed.value)') < patch.indexOf('if ("status" in parsed.value)'));
    assert.match(patch, /console_ops_disabled/);
    assert.match(patch, /setTrackerClientStatus\(session, id, parsed.value.status\)/);
  });

  it("maps an unavailable assignment to a conflict without exposing repository details", () => {
    assert.match(patch, /error\.code === "invalid_assignee"/);
    assert.match(patch, /"assignee_unavailable"/);
    assert.match(patch, /Choose an active team member from this workspace\./);
  });

  it("checks the child flag before loading the status mutation", () => {
    const branch = patch.slice(patch.indexOf('if ("status" in parsed.value)'), patch.indexOf("const [{ requireOrgMember }, { updateTrackerClientMetadata }]"));
    assert.ok(branch.indexOf('featureFlag("FEATURE_CONSOLE_OPS")') < branch.indexOf('import("@/lib/tracker/read.server")'));
    assert.doesNotMatch(branch, /request\.json|p_actor|actorId/);
  });

  it("awaits dynamic params and rejects body actor fields through the exact parser", () => {
    assert.match(patch, /const \{ id \} = await context\.params/);
    assert.match(patch, /validateTrackerPatchInput\(body\)/);
  });

  it("orders the tenant wall before the billing meter and create", async () => {
    const harness = dependencies({});
    const response = await handlePostClient(createRequest(), harness.dependencies);
    assert.equal(response.status, 409);
    assert.deepEqual(harness.calls, ["session", "wall", "load-cap", "cap", "create"]);
  });

  it("returns the private typed response for precheck and concurrent exhaustion", async () => {
    for (const input of [
      { capAt: 1 },
      { capAt: 2, trackerError: new Error("write") },
    ]) {
      const harness = dependencies(input);
      const response = await handlePostClient(createRequest(), harness.dependencies);
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), {
        error: {
          code: "CLIENT_CAP_REACHED",
          message: "This organization has reached its active client cap.",
        },
      });
    }
  });

  it("preserves unrelated tracker failures and performs zero billing calls while off", async () => {
    const trackerError = new Error("write");
    const failed = dependencies({ trackerError });
    const failure = await handlePostClient(createRequest(), failed.dependencies);
    assert.equal(failure.status, 500);

    const off = dependencies({ billing: false });
    const response = await handlePostClient(createRequest(), off.dependencies);
    assert.equal(response.status, 409);
    assert.deepEqual(off.calls, ["session", "wall", "create"]);
  });

  it("returns the deactivated organization response before parsing valid or malformed bodies", async () => {
    for (const request of [createRequest(), new Request("http://localhost/api/clients", { method: "POST", body: "{" })]) {
      const harness = dependencies({ wallError: { status: 402 } });
      const response = await handlePostClient(request, harness.dependencies);
      assert.equal(response.status, 402);
      assert.deepEqual(await response.json(), { error: { code: "ORG_DEACTIVATED", message: "This organization is deactivated." } });
      assert.deepEqual(harness.calls, ["session", "wall"], "tenant wall runs before JSON, cap, and writer calls");
    }
  });
});
