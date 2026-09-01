import {
  parseConsumerNotificationPreference,
  parseConsumerNotificationPreferencesResponse,
  type ConsumerNotificationPreference,
  type ConsumerNotificationPreferences,
} from "./preferences.ts";

export type ConsumerNotificationPreferencesClientResult =
  | { readonly ok: true; readonly preferences: ConsumerNotificationPreferences }
  | { readonly ok: false; readonly message: string };

const READ_FAILED = "Your notification preferences could not be loaded.";
const SAVE_FAILED = "That notification preference could not be saved.";

async function body(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

function message(value: unknown, fallback: string): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fallback;
  const error = (value as Record<string, unknown>).error;
  if (typeof error !== "object" || error === null || Array.isArray(error)) return fallback;
  const detail = (error as Record<string, unknown>).message;
  return typeof detail === "string" && detail.trim() ? detail : fallback;
}

export async function readConsumerNotificationPreferences(
  fetcher: typeof fetch = fetch,
): Promise<ConsumerNotificationPreferencesClientResult> {
  try {
    const response = await fetcher("/api/notifications/preferences", {
      cache: "no-store",
      credentials: "same-origin",
    });
    const payload = await body(response);
    if (!response.ok) return { message: message(payload, READ_FAILED), ok: false };
    const preferences = parseConsumerNotificationPreferencesResponse(payload);
    return preferences === null
      ? { message: READ_FAILED, ok: false }
      : { ok: true, preferences };
  } catch {
    return { message: READ_FAILED, ok: false };
  }
}

export async function saveConsumerNotificationPreference(
  preference: ConsumerNotificationPreference,
  fetcher: typeof fetch = fetch,
): Promise<ConsumerNotificationPreferencesClientResult> {
  const valid = parseConsumerNotificationPreference(preference);
  if (valid === null) return { message: SAVE_FAILED, ok: false };
  try {
    const response = await fetcher("/api/notifications/preferences", {
      body: JSON.stringify(valid),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    const payload = await body(response);
    if (!response.ok) return { message: message(payload, SAVE_FAILED), ok: false };
    const preferences = parseConsumerNotificationPreferencesResponse(payload);
    return preferences === null
      ? { message: SAVE_FAILED, ok: false }
      : { ok: true, preferences };
  } catch {
    return { message: SAVE_FAILED, ok: false };
  }
}
