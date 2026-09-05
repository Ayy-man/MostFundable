import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  CONSUMER_NOTIFICATION_EMAIL_AVAILABLE,
  CONSUMER_NOTIFICATION_EVENT_TYPES,
} from "@/lib/notifications/preferences";
import { TYPE_META } from "./notifications/view-model.ts";

const view = readFileSync(new URL("./notification-preferences.tsx", import.meta.url), "utf8");
const feed = readFileSync(new URL("../../lib/notifications/feed.server.ts", import.meta.url), "utf8");
const consumer = readFileSync(new URL("../surfaces/consumer.tsx", import.meta.url), "utf8");

describe("consumer notification preference surface", () => {
  it("renders every persisted event category from the canonical preference list", () => {
    assert.equal(CONSUMER_NOTIFICATION_EVENT_TYPES.length, Object.keys(TYPE_META).length);
    for (const eventType of CONSUMER_NOTIFICATION_EVENT_TYPES) {
      assert.ok(Object.hasOwn(TYPE_META, eventType), `${eventType} has no consumer-facing metadata`);
    }
    assert.match(view, /preferences\.map\(\(preference\) =>/);
    assert.match(view, /TYPE_META\[preference\.eventType\]/);
  });

  it("provides accessible switches on both channels now that email dispatches", () => {
    assert.match(view, /role="switch"/);
    assert.match(view, /aria-checked=\{checked\}/);
    assert.match(view, /change\(preference, "inApp"\)/);
    assert.match(view, /change\(preference, "email"\)/);
    assert.match(view, /saveConsumerNotificationPreference\(next\)/);
    assert.match(view, /aria-live="polite"/);
    assert.equal(CONSUMER_NOTIFICATION_EMAIL_AVAILABLE, true);
    assert.doesNotMatch(view, /Email unavailable/);
    assert.doesNotMatch(view, /consumer delivery service yet/);
    assert.match(view, /never carries amounts/);
    // The email switch is disabled only while a save is in flight, plus the one global constant
    // that would turn the channel off everywhere.
    assert.match(view, /disabled=\{saving !== null \|\| !CONSUMER_NOTIFICATION_EMAIL_AVAILABLE\}/);
    assert.match(view, /email \$\{preference\.email \? "on" : "off"\}/);
  });

  it("makes the persisted in-app choice authoritative over the derived feed", () => {
    assert.match(view, /Turning an in-app category off hides/);
    assert.match(feed, /consumer_notification_preferences/);
    assert.match(feed, /enabledSourceSet\.has\(item\.type\)/);
    assert.match(view, /onSaved\(result\.preferences\)/);
    assert.match(consumer, /onPreferencesSaved=\{\(preferences: ConsumerNotificationPreferences\) =>/);
    assert.match(consumer, /enabledTypes\.has\(notification\.type\)/);
    assert.match(consumer, /setLastKnownUnread\(reconciled\.filter/);
    assert.match(consumer, /setNotificationsReloadToken\(\(token\) => token \+ 1\)/);
  });

  it("prevents an older feed response from undoing a saved preference", () => {
    assert.match(consumer, /const notificationsRequestSequence = useRef\(0\)/);
    assert.match(consumer, /const requestSequence = \+\+notificationsRequestSequence\.current/);
    assert.match(
      consumer,
      /if \(!active \|\| requestSequence !== notificationsRequestSequence\.current\) return/,
    );
    const saved = consumer.indexOf("onPreferencesSaved={(preferences: ConsumerNotificationPreferences) =>");
    const invalidate = consumer.indexOf("notificationsRequestSequence.current += 1", saved);
    const reload = consumer.indexOf("setNotificationsReloadToken((token) => token + 1)", saved);
    assert.ok(saved >= 0 && invalidate > saved && reload > invalidate);
  });

  it("is enabled only for the live durable notification workspace", () => {
    assert.match(consumer, /preferencesEnabled=\{durableWorkspace && ancillaryLive\}/);
    assert.match(view, /if \(!enabled\) return null/);
  });
});
