import "server-only";

import type { SessionProfile } from "@/lib/auth/session";
import {
  CONSUMER_NOTIFICATION_EMAIL_AVAILABLE,
  parseConsumerNotificationPreference,
  type ConsumerNotificationPreferences,
} from "./preferences.ts";
import type { ConsumerNotificationPreferencesRepository } from "./preferences-repository.server.ts";

type ConsumerSession = SessionProfile & { orgId: string; role: "consumer" };

export interface ConsumerNotificationPreferencesDependencies {
  readonly repository: ConsumerNotificationPreferencesRepository;
  requireConsumer(): Promise<SessionProfile>;
}

async function defaults(): Promise<ConsumerNotificationPreferencesDependencies> {
  const [{ requireRole }, { createConsumerNotificationPreferencesRepository }] = await Promise.all([
    import("@/lib/auth/session"),
    import("./preferences-repository.server.ts"),
  ]);
  return {
    repository: createConsumerNotificationPreferencesRepository(),
    requireConsumer: () => requireRole("consumer"),
  };
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    headers: { "Cache-Control": "private, no-store" },
    status,
  });
}

function accessStatus(error: unknown): 401 | 403 | null {
  if (typeof error !== "object" || error === null || !("status" in error)) return null;
  return error.status === 401 || error.status === 403 ? error.status : null;
}

function authorized(session: SessionProfile): session is ConsumerSession {
  return session.role === "consumer" && typeof session.orgId === "string" && session.orgId.length > 0;
}

function failed(error: unknown): Response {
  const status = accessStatus(error);
  if (status !== null) {
    return json({ error: { code: status === 401 ? "session_required" : "role_forbidden" } }, status);
  }
  return json({
    error: {
      code: "notification_preferences_unavailable",
      message: "Notification preferences are temporarily unavailable.",
    },
  }, 500);
}

export async function handleConsumerNotificationPreferencesGet(
  supplied?: ConsumerNotificationPreferencesDependencies,
): Promise<Response> {
  try {
    const dependencies = supplied ?? await defaults();
    const session = await dependencies.requireConsumer();
    if (!authorized(session)) return json({ error: { code: "role_forbidden" } }, 403);
    const preferences: ConsumerNotificationPreferences =
      await dependencies.repository.list(session.id);
    return json({ preferences });
  } catch (error) {
    return failed(error);
  }
}

export async function handleConsumerNotificationPreferencesPatch(
  request: Request,
  supplied?: ConsumerNotificationPreferencesDependencies,
): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  const preference = parseConsumerNotificationPreference(body);
  if (preference === null) {
    return json({ error: { code: "invalid_request" } }, 400);
  }
  if (preference.email && !CONSUMER_NOTIFICATION_EMAIL_AVAILABLE) {
    return json({
      error: {
        code: "consumer_notification_email_unavailable",
        message: "Email alerts are not connected to a consumer delivery service yet.",
      },
    }, 409);
  }

  try {
    const dependencies = supplied ?? await defaults();
    const session = await dependencies.requireConsumer();
    if (!authorized(session)) return json({ error: { code: "role_forbidden" } }, 403);
    const preferences = await dependencies.repository.save(session.id, preference);
    return json({ preferences });
  } catch (error) {
    return failed(error);
  }
}
