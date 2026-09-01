import { disabled, failure, json } from "@/lib/ancillary/http";
import { featureFlag } from "@/lib/env";

import type { SessionProfile } from "@/lib/auth/session";
import type { NotificationFeedV2 } from "@/lib/notifications/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface NotificationsGetDependencies {
  requireConsumer(): Promise<SessionProfile>;
  readFeed(session: SessionProfile): Promise<NotificationFeedV2>;
}

export async function handleNotificationsGet(
  dependencies: NotificationsGetDependencies,
): Promise<Response> {
  try {
    const session = await dependencies.requireConsumer();
    return json(await dependencies.readFeed(session));
  } catch (error) {
    return failure(error);
  }
}

export async function GET(): Promise<Response> {
  if (!featureFlag("FEATURE_ANCILLARY")) return disabled();
  const [{ requireRole }, { readConsumerNotificationFeed }] = await Promise.all([
    import("@/lib/auth/session"),
    import("@/lib/notifications/feed.server"),
  ]);
  return handleNotificationsGet({
    requireConsumer: () => requireRole("consumer"),
    readFeed: readConsumerNotificationFeed,
  });
}
