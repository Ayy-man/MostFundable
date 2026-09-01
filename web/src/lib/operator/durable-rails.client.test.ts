import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import { APPLICATIONS_DISABLED_CODE } from "../applications/types.ts";
import {
  classifyAffiliatesProbe,
  classifyApplicationsProbe,
  readWorkspaceAccessSettings,
  readWorkspaceSaveResponse,
  saveWorkspaceAccessSettings,
  saveWorkspaceGoal,
} from "./durable-rails.client.ts";

/**
 * The three rails the operator surface asks about before it decides whether a
 * control may write (UI-WIRING-BACKLOG #8, #10, #17).
 *
 * Every expectation here is read out of the route that produces it, because the
 * failure mode this file exists for is the one round 5 named: an assertion that
 * transcribed a list, a code or a status at the moment it was written and then
 * kept passing while the route moved underneath it.
 */

const APPLICATIONS_ROUTE = new URL(
  "../../app/api/applications/route.ts",
  import.meta.url,
);
const ORG_SETTINGS_ROUTE = new URL(
  "../../app/api/org/settings/route.ts",
  import.meta.url,
);

describe("the applications probe reads the route's own flag-off answer", () => {
  it("treats a 400 as proof the flag passed, because the flag is checked first", () => {
    const source = fs.readFileSync(APPLICATIONS_ROUTE, "utf8");
    const get = source.slice(source.indexOf("export async function GET"));
    const flagAt = get.indexOf('featureFlag("FEATURE_APPLICATIONS")');
    const clientIdAt = get.indexOf("clientId must be a UUID.");
    assert.ok(flagAt >= 0, "the GET no longer reads FEATURE_APPLICATIONS");
    assert.ok(clientIdAt >= 0, "the GET no longer refuses a missing clientId");
    // The whole probe rests on this ordering. If the parameter check ever moved
    // above the flag check, a 400 would stop meaning "the rail is live" and the
    // surface would disable controls that do persist.
    assert.ok(
      flagAt < clientIdAt,
      "the flag check no longer runs before the clientId check, so a 400 no longer proves the flag passed",
    );
    assert.equal(classifyApplicationsProbe(400, null), "on");
  });

  it("reads the disabled state off the code the route sends, not a status alone", () => {
    assert.equal(
      classifyApplicationsProbe(503, { error: APPLICATIONS_DISABLED_CODE }),
      "off",
    );
    // A 503 from anything else is not a claim about the flag.
    assert.equal(classifyApplicationsProbe(503, { error: "unavailable" }), "unknown");
    assert.equal(classifyApplicationsProbe(500, null), "unknown");
  });
});

describe("the affiliates probe", () => {
  it("counts the bodiless 404 as off and an auth refusal as a live rail", () => {
    assert.equal(classifyAffiliatesProbe(404), "off");
    assert.equal(classifyAffiliatesProbe(403), "on");
    assert.equal(classifyAffiliatesProbe(401), "on");
    assert.equal(classifyAffiliatesProbe(500), "unknown");
  });
});

describe("Save workspace sends only keys the settings route accepts", () => {
  /** The route's allow-list, parsed from the route. */
  function settableKeys(): string[] {
    const source = fs.readFileSync(ORG_SETTINGS_ROUTE, "utf8");
    const declaration = /const SETTABLE_KEYS = \[([\s\S]*?)\] as const;/.exec(source);
    assert.ok(declaration, "the settings route no longer declares SETTABLE_KEYS");
    const keys = [...declaration[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    assert.ok(keys.length > 0, "SETTABLE_KEYS parsed as empty");
    return keys;
  }

  it("sends a subset of the allow-list, so an unknown key can never 400 the save", async () => {
    const calls: Array<RequestInit | undefined> = [];
    const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init);
      return Response.json(
        { org: { default_client_goal_cents: 125000 } },
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const result = await saveWorkspaceGoal(125000, fetcher);
    assert.deepEqual(result, { goalCents: 125000, outcome: "saved" });

    const sent = JSON.parse(String(calls[0]?.body)) as Record<string, unknown>;
    const allowed = settableKeys();
    for (const key of Object.keys(sent)) {
      assert.ok(
        allowed.includes(key),
        `the save sent \`${key}\`, which the settings route refuses outright`,
      );
    }
    // Workspace identity now uses this settings rail; support email still has
    // no durable contract and must not be collected by this save.
    assert.ok(allowed.includes("name"));
    assert.ok(!allowed.includes("support_email"));
  });

  it("a 200 that did not store the goal is a failure, not a save", () => {
    assert.deepEqual(
      readWorkspaceSaveResponse(200, { org: { default_client_goal_cents: 1 } }, 125000),
      { outcome: "failed" },
    );
    assert.deepEqual(readWorkspaceSaveResponse(200, {}, 125000), { outcome: "failed" });
    assert.deepEqual(readWorkspaceSaveResponse(404, null, 125000), {
      outcome: "unavailable",
    });
    assert.deepEqual(readWorkspaceSaveResponse(403, { error: "forbidden" }, 125000), {
      outcome: "failed",
    });
  });
});

describe("workspace access and assignment settings", () => {
  it("hydrates the two durable values through the settings GET", async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input: String(input), init });
      return Response.json({
        org: { assignment_mode: "round_robin", team_sees_all_clients: false },
      });
    }) as unknown as typeof fetch;

    assert.deepEqual(await readWorkspaceAccessSettings(fetcher), {
      outcome: "ready",
      settings: { assignmentMode: "round-robin", teamSeesAllClients: false },
    });
    assert.equal(calls[0]?.input, "/api/org/settings");
    assert.equal(calls[0]?.init?.cache, "no-store");
  });

  it("writes only the accepted database values and verifies server read-back", async () => {
    let sent: Record<string, unknown> | null = null;
    const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({
        org: { assignment_mode: "round_robin", team_sees_all_clients: true },
      });
    }) as unknown as typeof fetch;

    assert.deepEqual(await saveWorkspaceAccessSettings({
      assignmentMode: "round-robin",
      teamSeesAllClients: true,
    }, fetcher), {
      outcome: "ready",
      settings: { assignmentMode: "round-robin", teamSeesAllClients: true },
    });
    assert.deepEqual(sent, {
      assignment_mode: "round_robin",
      team_sees_all_clients: true,
    });
  });

  it("does not report success for malformed or mismatched read-back", async () => {
    const malformed = (async () => Response.json({ org: {} })) as unknown as typeof fetch;
    const mismatched = (async () => Response.json({
      org: { assignment_mode: "manual", team_sees_all_clients: false },
    })) as unknown as typeof fetch;
    assert.deepEqual(await readWorkspaceAccessSettings(malformed), { outcome: "failed" });
    assert.deepEqual(await saveWorkspaceAccessSettings({
      assignmentMode: "round-robin",
      teamSeesAllClients: false,
    }, mismatched), { outcome: "failed" });
  });
});
