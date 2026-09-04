import { featureFlag, resolveDriver, type EnvSource } from "@/lib/env";

import {
  CONSUMER_NOTIFICATION_EMAIL_AVAILABLE,
  isConsumerNotificationEventType,
  type ConsumerNotificationPreferences,
} from "./preferences.ts";

import type { ConsumerEmailTemplate, EmailDriver } from "@/lib/email/types";
import type { NotificationEventType } from "./types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAILBOX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FIRST_NAME = /^[\p{L}][\p{L}\p{M}'’-]{0,39}$/u;

/**
 * One template per event type. The event kind is the whole message, so the mapping is the only
 * place an event's meaning turns into words, and a new event type fails to compile without one.
 */
export const CONSUMER_NOTIFICATION_EMAIL_TEMPLATES: Readonly<
  Record<NotificationEventType, ConsumerEmailTemplate>
> = Object.freeze({
  monitoring_alert: "consumer_monitoring_alert",
  stage_change: "consumer_stage_change",
  analysis_complete: "consumer_analysis_complete",
  refresh_result: "consumer_refresh_result",
  enrollment_milestone: "consumer_enrollment_milestone",
  document: "consumer_document",
  team_message: "consumer_team_message",
  application_update: "consumer_application_update",
});

/**
 * Where the button lands. One destination for every event: the notification feed already holds the
 * detail, and a per-event deep link would tell a reader of the inbox which surface is involved.
 */
export const CONSUMER_NOTIFICATION_EMAIL_PATH = "/consumer";

export interface ConsumerNotificationEmailRecipient {
  readonly email: string;
  readonly firstName: string;
  readonly orgId: string;
}

export interface ConsumerNotificationEmailInput {
  /** The delivery row this email hangs off, which is also its idempotency key. */
  readonly deliveryId: string;
  readonly eventType: NotificationEventType;
  readonly recipientProfileId: string;
}

export interface ConsumerNotificationEmailDependencies {
  /** A factory rather than an instance, so an unconfigured deployment never builds a driver. */
  readonly driver: () => EmailDriver;
  readonly env?: EnvSource;
  readPreferences(profileId: string): Promise<ConsumerNotificationPreferences>;
  readRecipient(profileId: string): Promise<ConsumerNotificationEmailRecipient | null>;
}

export type ConsumerNotificationEmailSkipReason =
  | "driver_unset"
  | "email_unavailable"
  | "feature_off"
  | "input_invalid"
  | "preference_off"
  | "recipient_unavailable";

export type ConsumerNotificationEmailResult =
  | { readonly status: "skipped"; readonly reason: ConsumerNotificationEmailSkipReason }
  | {
    readonly status: "sent";
    readonly template: ConsumerEmailTemplate;
    readonly receiptId: string;
  }
  | {
    readonly status: "failed";
    readonly reason: "preferences_read" | "recipient_read" | "send";
  };

function skipped(
  reason: ConsumerNotificationEmailSkipReason,
): ConsumerNotificationEmailResult {
  return { status: "skipped", reason };
}

/**
 * The one personal detail a consumer email carries. A stored full name is free text, so anything
 * that is not plainly a given name is refused rather than escaped: no email is better than one
 * that renders someone's markup.
 */
export function consumerEmailFirstName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const [first = ""] = value.trim().split(/\s+/);
  return FIRST_NAME.test(first) ? first : null;
}

function usableRecipient(
  value: ConsumerNotificationEmailRecipient | null,
): { email: string; firstName: string; orgId: string } | null {
  if (value === null || typeof value !== "object") return null;
  const firstName = consumerEmailFirstName(value.firstName);
  const email = typeof value.email === "string" ? value.email.trim() : "";
  if (
    firstName === null
    || email.length < 3
    || email.length > 320
    || !MAILBOX.test(email)
    || typeof value.orgId !== "string"
    || !UUID.test(value.orgId)
  ) return null;
  return { email: value.email, firstName, orgId: value.orgId };
}

/**
 * Decide whether one created in-app notification also becomes an email, and send it.
 *
 * Email hangs off the in-app event rather than off a second source of truth: the caller passes the
 * notification it just delivered, and this returns a result instead of throwing, so a provider
 * outage or a preference read failure can never fail the notification write it rides on. The job
 * queue owns the retry.
 */
export async function dispatchConsumerNotificationEmail(
  input: ConsumerNotificationEmailInput,
  dependencies: ConsumerNotificationEmailDependencies,
): Promise<ConsumerNotificationEmailResult> {
  if (!CONSUMER_NOTIFICATION_EMAIL_AVAILABLE) return skipped("email_unavailable");

  const env = dependencies.env ?? process.env;
  if (!featureFlag("FEATURE_EMAIL", env)) return skipped("feature_off");

  let driverName: "mock" | "resend";
  try {
    driverName = resolveDriver("email", env);
  } catch {
    return skipped("driver_unset");
  }
  if (driverName === "mock") return skipped("driver_unset");

  if (
    !isConsumerNotificationEventType(input.eventType)
    || !UUID.test(input.deliveryId)
    || !UUID.test(input.recipientProfileId)
  ) return skipped("input_invalid");
  const template = CONSUMER_NOTIFICATION_EMAIL_TEMPLATES[input.eventType];

  let preferences: ConsumerNotificationPreferences;
  try {
    preferences = await dependencies.readPreferences(input.recipientProfileId);
  } catch {
    return { status: "failed", reason: "preferences_read" };
  }
  const preference = preferences.find((entry) => entry.eventType === input.eventType);
  if (preference === undefined || !preference.email) return skipped("preference_off");

  let recipient: ConsumerNotificationEmailRecipient | null;
  try {
    recipient = await dependencies.readRecipient(input.recipientProfileId);
  } catch {
    return { status: "failed", reason: "recipient_read" };
  }
  const usable = usableRecipient(recipient);
  if (usable === null) return skipped("recipient_unavailable");

  try {
    const receipt = await dependencies.driver().send({
      to: usable.email,
      template,
      vars: {
        APP_PATH: CONSUMER_NOTIFICATION_EMAIL_PATH,
        DELIVERY_REFERENCE: input.deliveryId,
        FIRST_NAME: usable.firstName,
      },
      orgId: usable.orgId,
    });
    return { status: "sent", template, receiptId: receipt.receiptId };
  } catch {
    return { status: "failed", reason: "send" };
  }
}
