import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CONSUMER_NOTIFICATION_EMAIL_DEFAULTS,
  CONSUMER_NOTIFICATION_EVENT_TYPES,
  DEFAULT_CONSUMER_NOTIFICATION_PREFERENCES,
  completeConsumerNotificationPreferences,
  parseConsumerNotificationPreference,
  parseConsumerNotificationPreferencesResponse,
} from "./preferences.ts";

describe("consumer notification preference contract", () => {
  it("defaults every category to in-app on, and email on only where it earns the interruption", () => {
    assert.equal(DEFAULT_CONSUMER_NOTIFICATION_PREFERENCES.length, 8);
    assert.deepEqual(
      DEFAULT_CONSUMER_NOTIFICATION_PREFERENCES.map((preference) => preference.eventType),
      CONSUMER_NOTIFICATION_EVENT_TYPES,
    );
    assert.ok(DEFAULT_CONSUMER_NOTIFICATION_PREFERENCES.every((preference) => preference.inApp));
    assert.deepEqual(
      DEFAULT_CONSUMER_NOTIFICATION_PREFERENCES
        .filter((preference) => preference.email)
        .map((preference) => preference.eventType),
      ["monitoring_alert", "team_message"],
    );
    // Migration 434 seeds the same table; this map is the single statement of the defaults.
    assert.deepEqual(
      DEFAULT_CONSUMER_NOTIFICATION_PREFERENCES.map((preference) => preference.email),
      CONSUMER_NOTIFICATION_EVENT_TYPES.map(
        (eventType) => CONSUMER_NOTIFICATION_EMAIL_DEFAULTS[eventType],
      ),
    );
  });

  it("fills missing database rows conservatively without overwriting saved choices", () => {
    const complete = completeConsumerNotificationPreferences([
      { email: true, eventType: "team_message", inApp: false },
    ]);
    assert.equal(complete?.length, 8);
    assert.deepEqual(
      complete?.find((preference) => preference.eventType === "team_message"),
      { email: true, eventType: "team_message", inApp: false },
    );
    assert.deepEqual(
      complete?.find((preference) => preference.eventType === "document"),
      { email: false, eventType: "document", inApp: true },
    );
  });

  it("rejects duplicate, widened and unknown category choices", () => {
    const one = { email: false, eventType: "document" as const, inApp: true };
    assert.equal(completeConsumerNotificationPreferences([one, one]), null);
    assert.equal(parseConsumerNotificationPreference({ ...one, profileId: "someone-else" }), null);
    assert.equal(parseConsumerNotificationPreference({ ...one, eventType: "unknown" }), null);
  });

  it("accepts only a complete, exact API response", () => {
    assert.deepEqual(
      parseConsumerNotificationPreferencesResponse({
        preferences: DEFAULT_CONSUMER_NOTIFICATION_PREFERENCES,
      }),
      DEFAULT_CONSUMER_NOTIFICATION_PREFERENCES,
    );
    assert.equal(parseConsumerNotificationPreferencesResponse({ preferences: [
      DEFAULT_CONSUMER_NOTIFICATION_PREFERENCES[0],
    ] }), null);
    assert.equal(parseConsumerNotificationPreferencesResponse({
      preferences: DEFAULT_CONSUMER_NOTIFICATION_PREFERENCES,
      profileId: "leak",
    }), null);
  });
});
