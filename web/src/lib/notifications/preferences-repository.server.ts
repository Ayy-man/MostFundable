import "server-only";

import {
  CONSUMER_NOTIFICATION_EMAIL_AVAILABLE,
  completeConsumerNotificationPreferences,
  isConsumerNotificationEventType,
  type ConsumerNotificationPreference,
  type ConsumerNotificationPreferences,
} from "./preferences.ts";

const COLUMNS = "event_type,in_app_enabled,email_enabled";

interface DbError {
  readonly code?: string;
  readonly message?: string;
}

interface Result<T> {
  readonly data: T | null;
  readonly error: DbError | null;
}

interface Query<T> extends PromiseLike<Result<T[]>> {
  eq(column: string, value: unknown): Query<T>;
  maybeSingle(): PromiseLike<Result<T>>;
  order(column: string, options: { ascending: boolean }): Query<T>;
  select(columns: string): Query<T>;
}

interface Table<T> {
  select(columns: string): Query<T>;
  upsert(
    value: Record<string, unknown>,
    options: { onConflict: string },
  ): Query<T>;
}

export interface ConsumerNotificationPreferencesDatabase {
  from<T>(table: "consumer_notification_preferences"): Table<T>;
}

interface PreferenceRow {
  readonly email_enabled: boolean;
  readonly event_type: string;
  readonly in_app_enabled: boolean;
}

export class ConsumerNotificationPreferencesRepositoryError extends Error {
  readonly name = "ConsumerNotificationPreferencesRepositoryError";

  constructor() {
    super("Consumer notification preferences operation failed");
  }
}

function mapped(value: unknown): ConsumerNotificationPreference | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Partial<PreferenceRow>;
  if (!isConsumerNotificationEventType(row.event_type)
      || typeof row.in_app_enabled !== "boolean"
      || typeof row.email_enabled !== "boolean"
      || (row.email_enabled && !CONSUMER_NOTIFICATION_EMAIL_AVAILABLE)) return null;
  return Object.freeze({
    email: row.email_enabled,
    eventType: row.event_type,
    inApp: row.in_app_enabled,
  });
}

async function defaultDatabase(): Promise<ConsumerNotificationPreferencesDatabase> {
  const { createClient } = await import("@/lib/supabase/server");
  // This lane adds migration 413 before the generated database type is refreshed.
  // The structural interface keeps this repository session-scoped without using an admin client.
  return await createClient() as unknown as ConsumerNotificationPreferencesDatabase;
}

export interface ConsumerNotificationPreferencesRepository {
  list(profileId: string): Promise<ConsumerNotificationPreferences>;
  save(
    profileId: string,
    preference: ConsumerNotificationPreference,
  ): Promise<ConsumerNotificationPreferences>;
}

export function createConsumerNotificationPreferencesRepository(
  createDatabase: () => ConsumerNotificationPreferencesDatabase
    | Promise<ConsumerNotificationPreferencesDatabase> = defaultDatabase,
): ConsumerNotificationPreferencesRepository {
  let database: Promise<ConsumerNotificationPreferencesDatabase> | null = null;
  const db = () => (database ??= Promise.resolve(createDatabase()));

  async function list(profileId: string): Promise<ConsumerNotificationPreferences> {
    const { data, error } = await (await db())
      .from<PreferenceRow>("consumer_notification_preferences")
      .select(COLUMNS)
      .eq("profile_id", profileId)
      .order("event_type", { ascending: true });
    if (error || !Array.isArray(data)) {
      throw new ConsumerNotificationPreferencesRepositoryError();
    }
    const parsed = data.map(mapped);
    if (parsed.some((preference) => preference === null)) {
      throw new ConsumerNotificationPreferencesRepositoryError();
    }
    const preferences = completeConsumerNotificationPreferences(
      parsed as ConsumerNotificationPreference[],
    );
    if (preferences === null) throw new ConsumerNotificationPreferencesRepositoryError();
    return preferences;
  }

  return {
    list,
    async save(profileId, preference) {
      if (preference.email && !CONSUMER_NOTIFICATION_EMAIL_AVAILABLE) {
        throw new ConsumerNotificationPreferencesRepositoryError();
      }
      const { data, error } = await (await db())
        .from<PreferenceRow>("consumer_notification_preferences")
        .upsert({
          email_enabled: preference.email,
          event_type: preference.eventType,
          in_app_enabled: preference.inApp,
          profile_id: profileId,
        }, { onConflict: "profile_id,event_type" })
        .select(COLUMNS)
        .maybeSingle();
      const saved = mapped(data);
      if (error || saved === null || saved.eventType !== preference.eventType) {
        throw new ConsumerNotificationPreferencesRepositoryError();
      }
      return list(profileId);
    },
  };
}
