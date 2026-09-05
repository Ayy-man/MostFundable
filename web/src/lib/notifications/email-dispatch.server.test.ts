import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  dispatchConsumerNotificationEmailForDelivery,
  EVENT_TYPE_BY_KIND,
} from "./email-dispatch.server.ts";
import { CONSUMER_NOTIFICATION_EMAIL_TEMPLATES } from "./email-dispatch.ts";
import { CONSUMER_NOTIFICATION_EVENT_TYPES } from "./preferences.ts";

import type { ConsumerNotificationEmailDb } from "./email-dispatch.server.ts";
import type { EmailDriver, EmailSendInput } from "@/lib/email/types";
import type { NotificationEventType } from "./types.ts";

const DELIVERY = "84000000-0000-4000-8000-000000000201";
const NOTIFICATION = "84000000-0000-4000-8000-000000000301";
const PROFILE = "84000000-0000-4000-8000-000000000111";
const ORG = "84000000-0000-4000-8000-000000000001";

type Rows = Readonly<Record<string, unknown>>;

/**
 * The production path reads three tables through one admin client. The double records what each
 * read asked for, so the column lists and filters stay pinned.
 */
function database(rows: Rows, calls: unknown[] = []): ConsumerNotificationEmailDb {
  return {
    from<T>(table: string) {
      calls.push(["from", table]);
      const data = rows[table];
      const query = {
        eq(column: string, value: unknown) { calls.push(["eq", column, value]); return query; },
        maybeSingle() {
          return Promise.resolve({
            data: (Array.isArray(data) ? data[0] ?? null : data ?? null) as T | null,
            error: null,
          });
        },
        then(resolve: (result: { data: T[] | null; error: unknown }) => unknown) {
          return Promise.resolve(resolve({ data: (data ?? []) as T[], error: null }));
        },
      };
      return {
        select(columns: string) { calls.push(["select", columns]); return query as never; },
      };
    },
  };
}

function preferenceRows(email: boolean): Rows[string] {
  return CONSUMER_NOTIFICATION_EVENT_TYPES.map((eventType) => ({
    email_enabled: eventType === "monitoring_alert" ? email : false,
    event_type: eventType,
    in_app_enabled: true,
  }));
}

function rows(overrides: Partial<Rows> = {}): Rows {
  return {
    outcome_notifications: [{ kind: "crs_alert", recipient_profile_id: PROFILE }],
    profiles: [{ email: "dana@example.test", full_name: "Dana Whitfield", org_id: ORG }],
    consumer_notification_preferences: preferenceRows(true),
    ...overrides,
  };
}

function driver(sent: EmailSendInput[]): () => EmailDriver {
  return () => ({
    async send(input) {
      sent.push(input as EmailSendInput);
      return {
        driver: "resend",
        receiptId: "84000000-0000-4000-8000-000000000501",
        providerRef: "ref",
        status: "accepted",
        attemptCount: 1,
      };
    },
  });
}

/**
 * The gate reads `process.env` because it is the deployment's own configuration, not a caller's
 * argument. Node runs each test file in its own process, so setting it here is contained.
 */
async function withEmailConfigured<T>(run: () => Promise<T>): Promise<T> {
  const previous = {
    EMAIL_DRIVER: process.env.EMAIL_DRIVER,
    EMAIL_FROM_ADDRESS: process.env.EMAIL_FROM_ADDRESS,
    FEATURE_EMAIL: process.env.FEATURE_EMAIL,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
  };
  Object.assign(process.env, {
    EMAIL_DRIVER: "resend",
    EMAIL_FROM_ADDRESS: "alerts@mostfundable.test",
    FEATURE_EMAIL: "1",
    RESEND_API_KEY: "re_test_key",
  });
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("consumer notification email production wiring", () => {
  it("spends no database read while the configuration gate is closed", async () => {
    // FEATURE_EMAIL is unset in the test environment, which is the deployed default.
    const calls: unknown[] = [];
    const result = await dispatchConsumerNotificationEmailForDelivery(
      { deliveryId: DELIVERY, notificationId: NOTIFICATION },
      { db: database(rows(), calls), driver: driver([]) },
    );
    assert.deepEqual(result, { status: "skipped", reason: "feature_off" });
    assert.deepEqual(calls, []);
  });

  it("refuses a malformed delivery or notification identity", async () => {
    for (const input of [
      { deliveryId: "nope", notificationId: NOTIFICATION },
      { deliveryId: DELIVERY, notificationId: "nope" },
    ]) {
      assert.deepEqual(
        await withEmailConfigured(
          () => dispatchConsumerNotificationEmailForDelivery(input, { db: database(rows()) }),
        ),
        { status: "skipped", reason: "input_invalid" },
      );
    }
  });

  it("reads the notification, the mailbox and the preference, then sends one template", async () => {
    const calls: unknown[] = [];
    const sent: EmailSendInput[] = [];
    const result = await withEmailConfigured(() => dispatchConsumerNotificationEmailForDelivery(
      { deliveryId: DELIVERY, notificationId: NOTIFICATION },
      { db: database(rows(), calls), driver: driver(sent) },
    ));

    assert.deepEqual(result, {
      status: "sent",
      template: "consumer_monitoring_alert",
      receiptId: "84000000-0000-4000-8000-000000000501",
    });
    assert.deepEqual(calls, [
      ["from", "outcome_notifications"],
      ["select", "kind,recipient_profile_id"],
      ["eq", "id", NOTIFICATION],
      ["from", "consumer_notification_preferences"],
      ["select", "event_type,in_app_enabled,email_enabled"],
      ["eq", "profile_id", PROFILE],
      ["from", "profiles"],
      ["select", "email,full_name,org_id"],
      ["eq", "id", PROFILE],
    ]);
    assert.deepEqual(sent[0].vars, {
      APP_PATH: "/consumer",
      DELIVERY_REFERENCE: DELIVERY,
      FIRST_NAME: "Dana",
    });
  });

  it("sends nothing for an unmodelled notification kind or an opted-out consumer", async () => {
    const sent: EmailSendInput[] = [];
    assert.deepEqual(
      await withEmailConfigured(() => dispatchConsumerNotificationEmailForDelivery(
        { deliveryId: DELIVERY, notificationId: NOTIFICATION },
        {
          db: database(rows({
            outcome_notifications: [{ kind: "invented", recipient_profile_id: PROFILE }],
          })),
          driver: driver(sent),
        },
      )),
      { status: "skipped", reason: "input_invalid" },
    );
    assert.deepEqual(
      await withEmailConfigured(() => dispatchConsumerNotificationEmailForDelivery(
        { deliveryId: DELIVERY, notificationId: NOTIFICATION },
        {
          db: database(rows({ consumer_notification_preferences: preferenceRows(false) })),
          driver: driver(sent),
        },
      )),
      { status: "skipped", reason: "preference_off" },
    );
    assert.deepEqual(sent, []);
  });

  it("reports a failure instead of throwing when a read returns an unusable row", async () => {
    const sent: EmailSendInput[] = [];
    assert.deepEqual(
      await withEmailConfigured(() => dispatchConsumerNotificationEmailForDelivery(
        { deliveryId: DELIVERY, notificationId: NOTIFICATION },
        {
          db: database(rows({
            consumer_notification_preferences: [
              { email_enabled: "yes", event_type: "monitoring_alert", in_app_enabled: true },
            ],
          })),
          driver: driver(sent),
        },
      )),
      { status: "failed", reason: "preferences_read" },
    );
    assert.deepEqual(
      await withEmailConfigured(() => dispatchConsumerNotificationEmailForDelivery(
        { deliveryId: DELIVERY, notificationId: NOTIFICATION },
        { db: database(rows({ profiles: [] })), driver: driver(sent) },
      )),
      { status: "skipped", reason: "recipient_unavailable" },
    );
    assert.deepEqual(sent, []);
  });
});

function preferencesWithEmailOn(eventTypes: readonly NotificationEventType[]): Rows[string] {
  return CONSUMER_NOTIFICATION_EVENT_TYPES.map((eventType) => ({
    email_enabled: eventTypes.includes(eventType),
    event_type: eventType,
    in_app_enabled: true,
  }));
}

describe("consumer notification kind map", () => {
  it("reaches every consumer event type through at least one durable kind", () => {
    const reached = new Set(Object.values(EVENT_TYPE_BY_KIND));
    for (const eventType of CONSUMER_NOTIFICATION_EVENT_TYPES) {
      assert.ok(reached.has(eventType), `${eventType} has no notification kind to email from`);
    }
  });

  it("carries the eight queued kinds and skips the removed review", () => {
    // The key type already pins every entry to a label the database enum carries.
    assert.equal(Object.keys(EVENT_TYPE_BY_KIND).length, 8);
    assert.equal(Object.hasOwn(EVENT_TYPE_BY_KIND, "outcome_review_removed"), false);
  });

  it("emails each kind through its event's template, gated by that event's own toggle", async () => {
    for (const [kind, eventType] of Object.entries(EVENT_TYPE_BY_KIND)) {
      const sent: EmailSendInput[] = [];
      const on = await withEmailConfigured(() => dispatchConsumerNotificationEmailForDelivery(
        { deliveryId: DELIVERY, notificationId: NOTIFICATION },
        {
          db: database(rows({
            outcome_notifications: [{ kind, recipient_profile_id: PROFILE }],
            consumer_notification_preferences: preferencesWithEmailOn([eventType]),
          })),
          driver: driver(sent),
        },
      ));
      assert.deepEqual(on, {
        status: "sent",
        template: CONSUMER_NOTIFICATION_EMAIL_TEMPLATES[eventType],
        receiptId: "84000000-0000-4000-8000-000000000501",
      }, kind);
      assert.equal(sent.length, 1, kind);

      const others = CONSUMER_NOTIFICATION_EVENT_TYPES.filter((entry) => entry !== eventType);
      const off = await withEmailConfigured(() => dispatchConsumerNotificationEmailForDelivery(
        { deliveryId: DELIVERY, notificationId: NOTIFICATION },
        {
          db: database(rows({
            outcome_notifications: [{ kind, recipient_profile_id: PROFILE }],
            consumer_notification_preferences: preferencesWithEmailOn(others),
          })),
          driver: driver(sent),
        },
      ));
      assert.deepEqual(off, { status: "skipped", reason: "preference_off" }, kind);
      assert.equal(sent.length, 1, `${kind} sent while its toggle was off`);
    }
  });
});
