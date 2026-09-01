/**
 * The surface's seam onto the consumer notification feed.
 *
 * Everything real lives in `@/components/consumer/notifications/`: the `NotificationEventV2`
 * contract, the pure shaping, and the three route calls. This module exists so `consumer.tsx`
 * imports one path, and so the old per-row `markLiveNotificationRead` / `markAllLiveNotificationsRead`
 * pair has a recorded successor rather than simply vanishing.
 *
 * Both are gone deliberately. `markAllLiveNotificationsRead` fanned one PATCH out per unread row at
 * a bounded concurrency, which was the only thing available before `POST /api/notifications/read-all`
 * existed; it could half-succeed, and it made the badge a function of how many requests survived.
 * The route now owns the set, so the client sends one request and reports one outcome.
 */

export {
  fetchNotifications,
  markAllRead as markAllNotificationsRead,
  markRead as markNotificationRead,
  type MarkAllReadResultV1,
  type MarkReadResultV1,
  type NotificationFetcher,
  type NotificationReadStateV1,
} from "@/components/consumer/notifications/client";

export {
  NOTIFICATION_WINDOW_DAYS,
  type NotificationEventType,
  type NotificationEventV2,
  type NotificationTarget,
} from "@/components/consumer/notifications/types";

export { NOTIFICATION_TARGET } from "@/components/consumer/notifications/view-model";
