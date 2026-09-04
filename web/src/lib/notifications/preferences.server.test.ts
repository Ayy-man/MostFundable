import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SessionProfile } from "@/lib/auth/session";
import { DEFAULT_CONSUMER_NOTIFICATION_PREFERENCES } from "./preferences.ts";
import {
  handleConsumerNotificationPreferencesGet,
  handleConsumerNotificationPreferencesPatch,
  type ConsumerNotificationPreferencesDependencies,
} from "./preferences.server.ts";

const PROFILE = "41300000-0000-4000-8000-000000000111";
const ORG = "41300000-0000-4000-8000-000000000001";

function session(overrides: Partial<SessionProfile> = {}): SessionProfile {
  return {
    disabledAt: null,
    id: PROFILE,
    manages: [],
    orgId: ORG,
    orgMembership: null,
    orgRole: null,
    role: "consumer",
    ...overrides,
  };
}

function harness(actor: SessionProfile = session()) {
  const calls: Array<readonly unknown[]> = [];
  const dependencies: ConsumerNotificationPreferencesDependencies = {
    repository: {
      async list(profileId) {
        calls.push(["list", profileId]);
        return DEFAULT_CONSUMER_NOTIFICATION_PREFERENCES;
      },
      async save(profileId, preference) {
        calls.push(["save", profileId, preference]);
        return DEFAULT_CONSUMER_NOTIFICATION_PREFERENCES.map((saved) =>
          saved.eventType === preference.eventType ? preference : saved);
      },
    },
    async requireConsumer() {
      calls.push(["auth"]);
      return actor;
    },
  };
  return { calls, dependencies };
}

describe("consumer notification preference handlers", () => {
  it("GET scopes the repository read to the authenticated consumer", async () => {
    const { calls, dependencies } = harness();
    const response = await handleConsumerNotificationPreferencesGet(dependencies);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), {
      preferences: DEFAULT_CONSUMER_NOTIFICATION_PREFERENCES,
    });
    assert.deepEqual(calls, [["auth"], ["list", PROFILE]]);
  });

  it("PATCH accepts an in-app category choice and supplies profile identity from the session", async () => {
    const { calls, dependencies } = harness();
    const preference = { email: false, eventType: "team_message", inApp: false } as const;
    const response = await handleConsumerNotificationPreferencesPatch(new Request(
      "https://handover.invalid/api/notifications/preferences",
      { body: JSON.stringify(preference), method: "PATCH" },
    ), dependencies);
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [["auth"], ["save", PROFILE, preference]]);
  });

  it("saves a consumer email opt-in now that the dispatcher exists", async () => {
    const { calls, dependencies } = harness();
    const preference = { email: true, eventType: "team_message", inApp: true } as const;
    const response = await handleConsumerNotificationPreferencesPatch(new Request(
      "https://handover.invalid/api/notifications/preferences",
      { body: JSON.stringify(preference), method: "PATCH" },
    ), dependencies);
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [["auth"], ["save", PROFILE, preference]]);
  });

  it("rejects widened input before auth and refuses non-consumer or unscoped sessions", async () => {
    const { calls, dependencies } = harness();
    const invalid = await handleConsumerNotificationPreferencesPatch(new Request(
      "https://handover.invalid/api/notifications/preferences",
      {
        body: JSON.stringify({
          email: true,
          eventType: "document",
          inApp: true,
          profileId: "another-consumer",
        }),
        method: "PATCH",
      },
    ), dependencies);
    assert.equal(invalid.status, 400);
    assert.deepEqual(calls, []);

    assert.equal((await handleConsumerNotificationPreferencesGet(
      harness(session({ role: "operator_member", orgRole: "owner" })).dependencies,
    )).status, 403);
    assert.equal((await handleConsumerNotificationPreferencesGet(
      harness(session({ orgId: null })).dependencies,
    )).status, 403);
  });

  it("maps authentication failures without leaking repository details", async () => {
    const { dependencies } = harness();
    dependencies.requireConsumer = async () => { throw { status: 401 }; };
    const response = await handleConsumerNotificationPreferencesGet(dependencies);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: { code: "session_required" } });
  });
});
