import "server-only";

import { createNotificationRepository } from "@/lib/ancillary/notification-repository";

import {
  createNotificationSessionClient,
  currentNotificationSourceFlags,
  NotificationFeedError,
  readNotificationFeedWith,
  type NotificationSessionClient,
  type NotificationSourceFlags,
} from "./feed.server.ts";
import {
  NOTIFICATION_EVENT_KEY_PATTERN,
  type NotificationEventV2,
} from "./types.ts";

import type { SessionProfile } from "@/lib/auth/session";

export interface MarkReadDependencies {
  db: NotificationSessionClient;
  flags: NotificationSourceFlags;
  now?: Date;
  stampMonitoringRead(notificationId: string, profileId: string): Promise<void>;
}

async function insertOneRead(
  db: NotificationSessionClient,
  profileId: string,
  eventKey: string,
  readAt: string,
): Promise<void> {
  const result = await db.from("consumer_notification_reads").upsert(
    { profile_id: profileId, event_key: eventKey, read_at: readAt },
    { ignoreDuplicates: true, onConflict: "profile_id,event_key" },
  );
  if (result.error) throw new NotificationFeedError("write_failed");
}

export async function markNotificationReadWith(
  session: SessionProfile,
  eventKey: string,
  dependencies: MarkReadDependencies,
): Promise<NotificationEventV2 | null> {
  if (!NOTIFICATION_EVENT_KEY_PATTERN.test(eventKey)) return null;
  const now = dependencies.now ?? new Date();
  const feed = await readNotificationFeedWith(
    session,
    dependencies.db,
    dependencies.flags,
    now,
  );
  const notification = feed.notifications.find((item) => item.id === eventKey);
  if (!notification) return null;

  if (notification.type === "monitoring_alert") {
    await dependencies.stampMonitoringRead(eventKey.split(":")[1], session.id);
  }
  const readAt = notification.readAt ?? now.toISOString();
  await insertOneRead(dependencies.db, session.id, eventKey, readAt);
  return { ...notification, readAt };
}

export async function markAllNotificationsReadWith(
  session: SessionProfile,
  dependencies: Omit<MarkReadDependencies, "stampMonitoringRead">,
): Promise<number> {
  const now = dependencies.now ?? new Date();
  const feed = await readNotificationFeedWith(
    session,
    dependencies.db,
    dependencies.flags,
    now,
  );
  const unread = feed.notifications.filter((item) => item.readAt === null);
  if (unread.length === 0) return 0;

  const result = await dependencies.db.from("consumer_notification_reads").insert(
    unread.map((item) => ({
      profile_id: session.id,
      event_key: item.id,
      read_at: now.toISOString(),
    })),
  );
  if (result.error) throw new NotificationFeedError("write_failed");
  return unread.length;
}

export async function markConsumerNotificationRead(
  session: SessionProfile,
  eventKey: string,
): Promise<NotificationEventV2 | null> {
  const repository = createNotificationRepository();
  return markNotificationReadWith(session, eventKey, {
    db: await createNotificationSessionClient(),
    flags: currentNotificationSourceFlags(),
    async stampMonitoringRead(notificationId, profileId) {
      await repository.markRead(notificationId, profileId);
    },
  });
}

export async function markAllConsumerNotificationsRead(session: SessionProfile): Promise<number> {
  return markAllNotificationsReadWith(session, {
    db: await createNotificationSessionClient(),
    flags: currentNotificationSourceFlags(),
  });
}
