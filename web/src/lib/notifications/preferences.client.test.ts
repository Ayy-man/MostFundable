import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_CONSUMER_NOTIFICATION_PREFERENCES } from "./preferences.ts";
import {
  readConsumerNotificationPreferences,
  saveConsumerNotificationPreference,
} from "./preferences.client.ts";

describe("consumer notification preference client", () => {
  it("reads the private no-store endpoint and validates the full response", async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    const result = await readConsumerNotificationPreferences(async (input, init) => {
      calls.push({ init, path: String(input) });
      return Response.json({ preferences: DEFAULT_CONSUMER_NOTIFICATION_PREFERENCES });
    });
    assert.equal(result.ok, true);
    assert.deepEqual(calls, [{
      init: { cache: "no-store", credentials: "same-origin" },
      path: "/api/notifications/preferences",
    }]);
  });

  it("PATCHes one exact category choice and accepts only authoritative full readback", async () => {
    let sent: unknown;
    const choice = { email: false, eventType: "team_message" as const, inApp: false };
    const result = await saveConsumerNotificationPreference(choice, async (input, init) => {
      assert.equal(String(input), "/api/notifications/preferences");
      assert.equal(init?.method, "PATCH");
      assert.equal(init?.credentials, "same-origin");
      assert.equal(init?.cache, "no-store");
      sent = JSON.parse(String(init?.body));
      return Response.json({
        preferences: DEFAULT_CONSUMER_NOTIFICATION_PREFERENCES.map((preference) =>
          preference.eventType === choice.eventType ? choice : preference),
      });
    });
    assert.deepEqual(sent, choice);
    assert.equal(result.ok, true);
    assert.deepEqual(
      result.ok && result.preferences.find((preference) => preference.eventType === choice.eventType),
      choice,
    );
  });

  it("fails honestly on a malformed 200, a server refusal and a dropped network", async () => {
    assert.equal((await readConsumerNotificationPreferences(
      async () => Response.json({ preferences: [] }),
    )).ok, false);
    assert.deepEqual(await saveConsumerNotificationPreference(
      { email: true, eventType: "document", inApp: true },
      async () => Response.json({
        error: { message: "Email preferences are unavailable." },
      }, { status: 503 }),
    ), { message: "Email preferences are unavailable.", ok: false });
    assert.equal((await readConsumerNotificationPreferences(async () => {
      throw new TypeError("Failed to fetch");
    })).ok, false);
  });
});
