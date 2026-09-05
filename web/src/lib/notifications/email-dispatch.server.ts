import "server-only";

import {
  consumerNotificationEmailEnabled,
  dispatchConsumerNotificationEmail,
  type ConsumerNotificationEmailDependencies,
  type ConsumerNotificationEmailRecipient,
  type ConsumerNotificationEmailResult,
} from "./email-dispatch.ts";
import {
  completeConsumerNotificationPreferences,
  isConsumerNotificationEventType,
  type ConsumerNotificationPreference,
  type ConsumerNotificationPreferences,
} from "./preferences.ts";

import type { Database } from "@/lib/db/types";
import type { NotificationEventType } from "./types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type OutcomeNotificationKind = Database["public"]["Enums"]["outcome_notification_kind"];

/**
 * Every in-app notification kind that reaches the dispatcher, mapped onto the feed's event
 * vocabulary. Migration 440 gave the six read-time event types a durable row of their own, written
 * by a trigger on each source table, so this map now covers every category a consumer can toggle;
 * `private.consumer_notification_event_type` in the database is the same map, and the test beside
 * this file holds the two to the full event-type list. The key type pins each entry to a label the
 * enum carries; `outcome_review_removed` is deliberately absent because it is never queued.
 */
export const EVENT_TYPE_BY_KIND: Readonly<
  Partial<Record<OutcomeNotificationKind, NotificationEventType>>
> = Object.freeze({
  crs_alert: "monitoring_alert",
  outcome_review_approved: "application_update",
  stage_change: "stage_change",
  analysis_complete: "analysis_complete",
  refresh_result: "refresh_result",
  enrollment_milestone: "enrollment_milestone",
  document: "document",
  team_message: "team_message",
});

function eventTypeForKind(kind: string): NotificationEventType | undefined {
  return Object.hasOwn(EVENT_TYPE_BY_KIND, kind)
    ? EVENT_TYPE_BY_KIND[kind as OutcomeNotificationKind]
    : undefined;
}

interface Result<T> { data: T | null; error: unknown }

interface Query<T> extends PromiseLike<Result<T[]>> {
  eq(column: string, value: unknown): Query<T>;
  maybeSingle(): PromiseLike<Result<T | null>>;
}

export interface ConsumerNotificationEmailDb {
  from<T>(table: string): { select(columns: string): Query<T> };
}

interface NotificationRow { kind: unknown; recipient_profile_id: unknown }
interface ProfileRow { email: unknown; full_name: unknown; org_id: unknown }
interface PreferenceRow { email_enabled: unknown; event_type: unknown; in_app_enabled: unknown }

async function adminDb(): Promise<ConsumerNotificationEmailDb> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient() as unknown as ConsumerNotificationEmailDb;
}

async function readRecipient(
  db: ConsumerNotificationEmailDb,
  profileId: string,
): Promise<ConsumerNotificationEmailRecipient | null> {
  const { data, error } = await db.from<ProfileRow>("profiles")
    .select("email,full_name,org_id")
    .eq("id", profileId)
    .maybeSingle();
  if (error) throw new Error("NOTIFICATION_EMAIL_RECIPIENT_READ_FAILED");
  if (
    data === null
    || typeof data.email !== "string"
    || typeof data.full_name !== "string"
    || typeof data.org_id !== "string"
  ) return null;
  return { email: data.email, firstName: data.full_name, orgId: data.org_id };
}

async function readPreferences(
  db: ConsumerNotificationEmailDb,
  profileId: string,
): Promise<ConsumerNotificationPreferences> {
  const { data, error } = await db.from<PreferenceRow>("consumer_notification_preferences")
    .select("event_type,in_app_enabled,email_enabled")
    .eq("profile_id", profileId);
  if (error || !Array.isArray(data)) throw new Error("NOTIFICATION_EMAIL_PREFERENCE_READ_FAILED");
  const saved: ConsumerNotificationPreference[] = [];
  for (const row of data) {
    if (
      !isConsumerNotificationEventType(row.event_type)
      || typeof row.in_app_enabled !== "boolean"
      || typeof row.email_enabled !== "boolean"
    ) throw new Error("NOTIFICATION_EMAIL_PREFERENCE_READ_FAILED");
    saved.push({ email: row.email_enabled, eventType: row.event_type, inApp: row.in_app_enabled });
  }
  const complete = completeConsumerNotificationPreferences(saved);
  if (complete === null) throw new Error("NOTIFICATION_EMAIL_PREFERENCE_READ_FAILED");
  return complete;
}

export function createConsumerNotificationEmailDependencies(
  db: ConsumerNotificationEmailDb,
  driver: ConsumerNotificationEmailDependencies["driver"],
): ConsumerNotificationEmailDependencies {
  return {
    driver,
    readPreferences: (profileId) => readPreferences(db, profileId),
    readRecipient: (profileId) => readRecipient(db, profileId),
  };
}

/**
 * Turn one delivered in-app notification into its consumer email.
 *
 * The configuration gate runs before any read, so an unconfigured deployment spends nothing here,
 * and every failure comes back as a result: this is called from the notification dispatch path and
 * must never be the reason a notification fails to land.
 */
export async function dispatchConsumerNotificationEmailForDelivery(
  input: Readonly<{ deliveryId: string; notificationId: string }>,
  injected?: Readonly<{
    db?: ConsumerNotificationEmailDb;
    driver?: ConsumerNotificationEmailDependencies["driver"];
  }>,
): Promise<ConsumerNotificationEmailResult> {
  if (!consumerNotificationEmailEnabled()) return { status: "skipped", reason: "feature_off" };
  if (!UUID.test(input.deliveryId) || !UUID.test(input.notificationId)) {
    return { status: "skipped", reason: "input_invalid" };
  }

  let db: ConsumerNotificationEmailDb;
  let eventType: NotificationEventType;
  let recipientProfileId: string;
  try {
    db = injected?.db ?? await adminDb();
    const { data, error } = await db.from<NotificationRow>("outcome_notifications")
      .select("kind,recipient_profile_id")
      .eq("id", input.notificationId)
      .maybeSingle();
    if (error) throw new Error("NOTIFICATION_EMAIL_SOURCE_READ_FAILED");
    const mapped = data !== null && typeof data.kind === "string"
      ? eventTypeForKind(data.kind)
      : undefined;
    if (
      data === null
      || mapped === undefined
      || typeof data.recipient_profile_id !== "string"
    ) return { status: "skipped", reason: "input_invalid" };
    eventType = mapped;
    recipientProfileId = data.recipient_profile_id;
  } catch {
    return { status: "failed", reason: "recipient_read" };
  }

  let driver = injected?.driver;
  if (driver === undefined) {
    // Loaded only past the gate, so an unconfigured deployment never builds a provider client.
    const { getEmailDriver } = await import("@/lib/email/bootstrap");
    driver = getEmailDriver;
  }
  return dispatchConsumerNotificationEmail(
    { deliveryId: input.deliveryId, eventType, recipientProfileId },
    createConsumerNotificationEmailDependencies(db, driver),
  );
}
