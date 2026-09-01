import { disabled, failure, json } from "@/lib/ancillary/http";
import { featureFlag } from "@/lib/env";

import type { SessionProfile } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface NotificationsReadAllDependencies {
  requireConsumer(): Promise<SessionProfile>;
  markAllRead(session: SessionProfile): Promise<number>;
}

export async function handleNotificationsReadAll(
  dependencies: NotificationsReadAllDependencies,
): Promise<Response> {
  try {
    const session = await dependencies.requireConsumer();
    const updated = await dependencies.markAllRead(session);
    return json({ updated, unreadCount: 0 });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(): Promise<Response> {
  if (!featureFlag("FEATURE_ANCILLARY")) return disabled();
  const [{ requireRole }, { markAllConsumerNotificationsRead }] = await Promise.all([
    import("@/lib/auth/session"),
    import("@/lib/notifications/mark-read.server"),
  ]);
  return handleNotificationsReadAll({
    requireConsumer: () => requireRole("consumer"),
    markAllRead: markAllConsumerNotificationsRead,
  });
}
