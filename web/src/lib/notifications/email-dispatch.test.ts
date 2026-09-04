import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CONSUMER_NOTIFICATION_EMAIL_PATH,
  CONSUMER_NOTIFICATION_EMAIL_TEMPLATES,
  consumerEmailFirstName,
  dispatchConsumerNotificationEmail,
  type ConsumerNotificationEmailDependencies,
} from "./email-dispatch.ts";
import {
  CONSUMER_NOTIFICATION_EVENT_TYPES,
  DEFAULT_CONSUMER_NOTIFICATION_PREFERENCES,
  type ConsumerNotificationPreferences,
} from "./preferences.ts";

import type { EmailDriver, EmailSendInput } from "@/lib/email/types";
import type { NotificationEventType } from "./types.ts";

const DELIVERY = "83000000-0000-4000-8000-000000000201";
const PROFILE = "83000000-0000-4000-8000-000000000111";
const ORG = "83000000-0000-4000-8000-000000000001";
const RECEIPT = "83000000-0000-4000-8000-000000000501";

const LIVE_ENV = Object.freeze({
  EMAIL_DRIVER: "resend",
  EMAIL_FROM_ADDRESS: "alerts@mostfundable.test",
  FEATURE_EMAIL: "1",
  RESEND_API_KEY: "re_test_key",
});

function preferences(
  overrides: Partial<Record<NotificationEventType, boolean>> = {},
): ConsumerNotificationPreferences {
  return Object.freeze(DEFAULT_CONSUMER_NOTIFICATION_PREFERENCES.map((preference) =>
    Object.freeze({
      ...preference,
      email: overrides[preference.eventType] ?? preference.email,
    })));
}

function driver(sent: EmailSendInput[]): EmailDriver {
  return {
    async send(input) {
      sent.push(input as EmailSendInput);
      return {
        driver: "resend",
        receiptId: RECEIPT,
        providerRef: "provider_ref",
        status: "accepted",
        attemptCount: 1,
      };
    },
  };
}

function dependencies(
  sent: EmailSendInput[],
  overrides: Partial<ConsumerNotificationEmailDependencies> = {},
): ConsumerNotificationEmailDependencies {
  return {
    driver: () => driver(sent),
    env: LIVE_ENV,
    async readPreferences() { return preferences({ team_message: true }); },
    async readRecipient() {
      return { email: "Dana@Example.Test", firstName: "Dana", orgId: ORG };
    },
    ...overrides,
  };
}

const INPUT = Object.freeze({
  deliveryId: DELIVERY,
  eventType: "team_message" as NotificationEventType,
  recipientProfileId: PROFILE,
});

describe("consumer notification email dispatcher", () => {
  it("maps every consumer event type to its own template", () => {
    const templates = CONSUMER_NOTIFICATION_EVENT_TYPES.map(
      (eventType) => CONSUMER_NOTIFICATION_EMAIL_TEMPLATES[eventType],
    );
    assert.equal(new Set(templates).size, CONSUMER_NOTIFICATION_EVENT_TYPES.length);
    assert.equal(CONSUMER_NOTIFICATION_EMAIL_TEMPLATES.team_message, "consumer_team_message");
  });

  it("sends the template for an event the consumer opted into", async () => {
    const sent: EmailSendInput[] = [];
    const result = await dispatchConsumerNotificationEmail(INPUT, dependencies(sent));

    assert.deepEqual(result, {
      status: "sent",
      template: "consumer_team_message",
      receiptId: RECEIPT,
    });
    assert.deepEqual(sent, [{
      to: "Dana@Example.Test",
      template: "consumer_team_message",
      vars: {
        APP_PATH: CONSUMER_NOTIFICATION_EMAIL_PATH,
        DELIVERY_REFERENCE: DELIVERY,
        FIRST_NAME: "Dana",
      },
      orgId: ORG,
    }]);
  });

  it("carries nothing but the first name and the event kind", async () => {
    const sent: EmailSendInput[] = [];
    await dispatchConsumerNotificationEmail(INPUT, dependencies(sent, {
      async readRecipient() {
        return { email: "dana@example.test", firstName: "Dana", orgId: ORG };
      },
    }));
    const payload = JSON.stringify(sent[0].vars);
    assert.equal(payload.includes("dana@example.test"), false);
    assert.equal(payload.includes(PROFILE), false);
    assert.deepEqual(Object.keys(sent[0].vars).sort(), [
      "APP_PATH",
      "DELIVERY_REFERENCE",
      "FIRST_NAME",
    ]);
  });

  it("is a no-op when the feature flag is off", async () => {
    const sent: EmailSendInput[] = [];
    const result = await dispatchConsumerNotificationEmail(INPUT, dependencies(sent, {
      env: { ...LIVE_ENV, FEATURE_EMAIL: undefined },
    }));
    assert.deepEqual(result, { status: "skipped", reason: "feature_off" });
    assert.deepEqual(sent, []);
  });

  it("is a no-op when the email driver is unset or mock", async () => {
    for (const env of [
      { FEATURE_EMAIL: "1" },
      { EMAIL_DRIVER: "mock", FEATURE_EMAIL: "1" },
      { EMAIL_DRIVER: "  ", FEATURE_EMAIL: "1" },
      // A resend arm missing its credentials is unusable, not half-configured.
      { EMAIL_DRIVER: "resend", FEATURE_EMAIL: "1" },
    ]) {
      const sent: EmailSendInput[] = [];
      const result = await dispatchConsumerNotificationEmail(INPUT, dependencies(sent, { env }));
      assert.deepEqual(result, { status: "skipped", reason: "driver_unset" });
      assert.deepEqual(sent, []);
    }
  });

  it("respects the consumer's per-event email preference", async () => {
    const sent: EmailSendInput[] = [];
    const result = await dispatchConsumerNotificationEmail(INPUT, dependencies(sent, {
      async readPreferences() { return preferences({ team_message: false }); },
    }));
    assert.deepEqual(result, { status: "skipped", reason: "preference_off" });
    assert.deepEqual(sent, []);
  });

  it("skips an unknown event type and a malformed delivery reference", async () => {
    const sent: EmailSendInput[] = [];
    assert.deepEqual(
      await dispatchConsumerNotificationEmail(
        { ...INPUT, eventType: "invented" as NotificationEventType },
        dependencies(sent),
      ),
      { status: "skipped", reason: "input_invalid" },
    );
    assert.deepEqual(
      await dispatchConsumerNotificationEmail({ ...INPUT, deliveryId: "nope" }, dependencies(sent)),
      { status: "skipped", reason: "input_invalid" },
    );
    assert.deepEqual(sent, []);
  });

  it("skips a consumer with no usable mailbox or name", async () => {
    const sent: EmailSendInput[] = [];
    for (const recipient of [
      null,
      { email: "   ", firstName: "Dana", orgId: ORG },
      { email: "dana@example.test", firstName: "", orgId: ORG },
      { email: "dana@example.test", firstName: "Dana", orgId: "not-a-uuid" },
    ]) {
      const result = await dispatchConsumerNotificationEmail(INPUT, dependencies(sent, {
        async readRecipient() { return recipient; },
      }));
      assert.deepEqual(result, { status: "skipped", reason: "recipient_unavailable" });
    }
    assert.deepEqual(sent, []);
  });

  it("never throws into the caller when a dependency fails", async () => {
    const sent: EmailSendInput[] = [];
    assert.deepEqual(
      await dispatchConsumerNotificationEmail(INPUT, dependencies(sent, {
        async readPreferences() { throw new Error("database down"); },
      })),
      { status: "failed", reason: "preferences_read" },
    );
    assert.deepEqual(
      await dispatchConsumerNotificationEmail(INPUT, dependencies(sent, {
        async readRecipient() { throw new Error("database down"); },
      })),
      { status: "failed", reason: "recipient_read" },
    );
    assert.deepEqual(
      await dispatchConsumerNotificationEmail(INPUT, dependencies(sent, {
        driver: () => ({ async send() { throw new Error("provider outage"); } }),
      })),
      { status: "failed", reason: "send" },
    );
    assert.deepEqual(
      await dispatchConsumerNotificationEmail(INPUT, dependencies(sent, {
        driver: () => { throw new Error("driver misconfigured"); },
      })),
      { status: "failed", reason: "send" },
    );
    assert.deepEqual(sent, []);
  });

  it("takes a usable given name out of a full name and rejects the rest", () => {
    assert.equal(consumerEmailFirstName("Dana Whitfield"), "Dana");
    assert.equal(consumerEmailFirstName("  Dana  "), "Dana");
    assert.equal(consumerEmailFirstName("O'Neill Rivera"), "O'Neill");
    assert.equal(consumerEmailFirstName("<script>alert</script>"), null);
    assert.equal(consumerEmailFirstName(""), null);
    assert.equal(consumerEmailFirstName(null), null);
    assert.equal(consumerEmailFirstName("D".repeat(80)), null);
  });
});
