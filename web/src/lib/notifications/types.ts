export type NotificationEventType =
  | "monitoring_alert"
  | "stage_change"
  | "analysis_complete"
  | "refresh_result"
  | "enrollment_milestone"
  | "document"
  | "team_message"
  | "application_update";

export type NotificationEventV2 = {
  id: string;
  type: NotificationEventType;
  occurredAt: string;
  title: string;
  detail: string;
  target: "credit" | "dashboard" | "optimization" | "plan" | "documents" | "coach";
  readAt: string | null;
};

export type NotificationFeedV2 = {
  notifications: NotificationEventV2[];
  unreadCount: number;
  windowDays: 90;
  capped: boolean;
  sources: NotificationEventType[];
};

export const NOTIFICATION_WINDOW_DAYS = 90 as const;
export const NOTIFICATION_FEED_LIMIT = 200;
export const NOTIFICATION_EVENT_KEY_PATTERN =
  /^[a-z_]+:[0-9a-f-]{36}(:[a-z0-9_]+)?$/;
