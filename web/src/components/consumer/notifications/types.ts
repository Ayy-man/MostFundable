/**
 * The consumer notification feed contract, `NotificationEventV2`.
 *
 * Written to match `.planning/lanes/notifications.md` §2 exactly. The backend lane owns the
 * server-side twin at `web/src/lib/notifications/types.ts`; the integrator reconciles the two.
 * Nothing on this side invents a field, and nothing on this side derives a title or a detail —
 * the server renders both, so the compliance gate has a single place to read them.
 */

export type NotificationEventType =
  | "monitoring_alert"
  | "stage_change"
  | "analysis_complete"
  | "refresh_result"
  | "enrollment_milestone"
  | "document"
  | "team_message"
  | "application_update";

/** The consumer `ViewId`s a notification is allowed to deep-link into. */
export type NotificationTarget =
  | "credit"
  | "dashboard"
  | "optimization"
  | "plan"
  | "documents"
  | "coach";

export type NotificationEventV2 = {
  /** Event key `"<type>:<source uuid>[:<qualifier>]"`, stable across reads. */
  id: string;
  type: NotificationEventType;
  /** ISO 8601. The source row's own timestamp, never the time of the read. */
  occurredAt: string;
  /** Server-rendered, plain language, already past `verify-compliance-copy`. */
  title: string;
  /** One sentence. Never a balance, limit, score value or bureau field. */
  detail: string;
  target: NotificationTarget;
  readAt: string | null;
};

/** The window the route promises. Stated in the footer so a finite feed reads as designed. */
export const NOTIFICATION_WINDOW_DAYS = 90;

export type NotificationFeedV2 = {
  notifications: NotificationEventV2[];
  unreadCount: number;
  windowDays: number;
  /** True when the 200-row cap bound before the 90-day window did. */
  capped: boolean;
  /** The classes this tenant's flags can produce, so the empty state teaches only what can arrive. */
  sources: NotificationEventType[];
};
