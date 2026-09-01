import type { NotificationEventType } from "./types.ts";

export const CONSUMER_NOTIFICATION_EVENT_TYPES = [
  "monitoring_alert",
  "stage_change",
  "analysis_complete",
  "refresh_result",
  "enrollment_milestone",
  "document",
  "team_message",
  "application_update",
] as const satisfies readonly NotificationEventType[];

/**
 * Consumer event emails do not have a production dispatcher yet. Keep this false until a
 * provider-backed consumer outbox exists; operator billing and requested password-reset emails
 * are separate transactional paths and are intentionally outside these preferences.
 */
export const CONSUMER_NOTIFICATION_EMAIL_AVAILABLE = false as const;

export interface ConsumerNotificationPreference {
  readonly email: boolean;
  readonly eventType: NotificationEventType;
  readonly inApp: boolean;
}

export type ConsumerNotificationPreferences = readonly ConsumerNotificationPreference[];

export const DEFAULT_CONSUMER_NOTIFICATION_PREFERENCES: ConsumerNotificationPreferences =
  Object.freeze(
    CONSUMER_NOTIFICATION_EVENT_TYPES.map((eventType) =>
      Object.freeze({ email: false, eventType, inApp: true }),
    ),
  );

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

export function isConsumerNotificationEventType(value: unknown): value is NotificationEventType {
  return typeof value === "string"
    && CONSUMER_NOTIFICATION_EVENT_TYPES.some((candidate) => candidate === value);
}

export function parseConsumerNotificationPreference(
  value: unknown,
): ConsumerNotificationPreference | null {
  const row = record(value);
  if (row === null || !exactKeys(row, ["email", "eventType", "inApp"])) return null;
  if (!isConsumerNotificationEventType(row.eventType)
      || typeof row.inApp !== "boolean"
      || typeof row.email !== "boolean") return null;
  return Object.freeze({
    email: row.email,
    eventType: row.eventType,
    inApp: row.inApp,
  });
}

/** Fill sparse database rows without weakening the strict public response parser. */
export function completeConsumerNotificationPreferences(
  values: readonly ConsumerNotificationPreference[],
): ConsumerNotificationPreferences | null {
  const byType = new Map<NotificationEventType, ConsumerNotificationPreference>();
  for (const value of values) {
    if (byType.has(value.eventType)) return null;
    byType.set(value.eventType, value);
  }
  return Object.freeze(
    CONSUMER_NOTIFICATION_EVENT_TYPES.map((eventType) => {
      const saved = byType.get(eventType);
      return saved
        ? Object.freeze({ ...saved })
        : Object.freeze({ email: false, eventType, inApp: true });
    }),
  );
}

export function parseConsumerNotificationPreferencesResponse(
  value: unknown,
): ConsumerNotificationPreferences | null {
  const body = record(value);
  if (body === null || !exactKeys(body, ["preferences"]) || !Array.isArray(body.preferences)) {
    return null;
  }
  const parsed = body.preferences.map(parseConsumerNotificationPreference);
  if (parsed.length !== CONSUMER_NOTIFICATION_EVENT_TYPES.length
      || parsed.some((preference) => preference === null)) return null;
  const complete = completeConsumerNotificationPreferences(
    parsed as ConsumerNotificationPreference[],
  );
  return complete?.length === CONSUMER_NOTIFICATION_EVENT_TYPES.length ? complete : null;
}
