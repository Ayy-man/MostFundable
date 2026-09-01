import { disabled, failure, json } from "@/lib/ancillary/http";
import { featureFlag } from "@/lib/env";
import { NOTIFICATION_EVENT_KEY_PATTERN } from "@/lib/notifications/types";

import type { SessionProfile } from "@/lib/auth/session";
import type { NotificationEventV2 } from "@/lib/notifications/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export interface NotificationPatchDependencies {
  requireConsumer(): Promise<SessionProfile>;
  markRead(session: SessionProfile, eventKey: string): Promise<NotificationEventV2 | null>;
}

function eventKeyFromParam(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    return NOTIFICATION_EVENT_KEY_PATTERN.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export async function handleNotificationPatch(
  rawId: string,
  dependencies: NotificationPatchDependencies,
): Promise<Response> {
  const eventKey = eventKeyFromParam(rawId);
  if (!eventKey) return json({ error: "invalid_request" }, 422);

  try {
    const session = await dependencies.requireConsumer();
    const notification = await dependencies.markRead(session, eventKey);
    if (!notification) return json({ error: "not_found" }, 404);
    return json({ notification });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(_request: Request, context: Context): Promise<Response> {
  if (!featureFlag("FEATURE_ANCILLARY")) return disabled();
  const { id } = await context.params;
  const [{ requireRole }, { markConsumerNotificationRead }] = await Promise.all([
    import("@/lib/auth/session"),
    import("@/lib/notifications/mark-read.server"),
  ]);
  return handleNotificationPatch(id, {
    requireConsumer: () => requireRole("consumer"),
    markRead: markConsumerNotificationRead,
  });
}
