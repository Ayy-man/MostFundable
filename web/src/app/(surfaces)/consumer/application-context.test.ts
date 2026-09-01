import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";

import type { SessionProfile } from "@/lib/auth/session";
import { TRACKER_STAGES } from "@/lib/tracker/types";
import type { TrackerClient } from "@/lib/tracker/types";
import { resolveConsumerApplicationContext } from "./application-context.server.ts";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION: SessionProfile = {
  disabledAt: null,
  id: "22222222-2222-4222-8222-222222222222",
  manages: [],
  orgId: "33333333-3333-4333-8333-333333333333",
  orgMembership: "current",
  orgRole: null,
  role: "consumer",
};
const CLIENT = {
  displayName: "Jordan Newcomer Demo",
  id: CLIENT_ID,
  readiness: 67,
  stage: TRACKER_STAGES[1],
} as TrackerClient;

describe("real-auth consumer application context", () => {
  test("resolves the session-owned client UUID and threads it through both boundaries", async () => {
    const calls: Array<{ profileId: string; scope: string }> = [];
    const context = await resolveConsumerApplicationContext(SESSION, async (session, filters) => {
      calls.push({ profileId: session.id, scope: filters.scope });
      return [CLIENT];
    });
    assert.deepEqual(context, {
      // A tracker row with no business name resolves to null, never to the
      // fixture roster's business, which is what the identity chip used to show
      // a signed-in consumer.
      businessName: null,
      clientId: CLIENT_ID,
      displayName: "Jordan Newcomer Demo",
      readiness: 67,
      stage: TRACKER_STAGES[1],
    });
    assert.deepEqual(calls, [{ profileId: SESSION.id, scope: "all" }]);

    const page = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
    const wrapper = await readFile(new URL("./surface-client.tsx", import.meta.url), "utf8");
    assert.match(page, /applicationContext=\{applicationContext\}/);
    assert.match(wrapper, /applicationContext=\{applicationContext\}/);
  });

  test("a client at a different stage resolves that stage verbatim", async () => {
    const otherStage = TRACKER_STAGES.find((stage) => stage !== TRACKER_STAGES[1]);
    assert.ok(otherStage, "expected at least two distinct tracker stages");
    const client = { ...CLIENT, stage: otherStage } as TrackerClient;
    const context = await resolveConsumerApplicationContext(SESSION, async () => [client]);
    assert.equal(context?.stage, otherStage);
  });

  test("all four live upload request families use the threaded client UUID", async () => {
    const source = await readFile(
      new URL("../../../components/surfaces/consumer.tsx", import.meta.url),
      "utf8",
    );
    const hub = source.slice(
      source.indexOf("function OnboardingHubView"),
      source.indexOf("function openSupportTeamChat"),
    );
    for (const [family, expression] of [
      ["document list", /refreshDocuments[\s\S]*?encodeURIComponent\(clientId\)/],
      ["document upload", /uploadLive[\s\S]*?encodeURIComponent\(clientId\)/],
      ["document item", /downloadLive[\s\S]*?deleteLive[\s\S]*?encodeURIComponent\(clientId\)/],
      ["credit file", /uploadReport[\s\S]*?encodeURIComponent\(clientId\)/],
    ] as const) {
      assert.match(hub, expression, `${family} must carry the session-owned UUID`);
    }
  });
});
