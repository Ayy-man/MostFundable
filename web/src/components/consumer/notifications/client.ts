/**
 * The read and write paths for the consumer notification feed.
 *
 * Two rules run through all three functions. Nothing throws at the view: every outcome is a value
 * the surface can render, because a rejected promise inside a click handler becomes an unhandled
 * rejection and a page that silently does nothing. And no response becomes state until its shape
 * has been checked — a 200 carrying the wrong body is a failed read, not an empty account.
 */

import type { NotificationEventType, NotificationEventV2 } from "./types.ts";
import { NOTIFICATION_WINDOW_DAYS } from "./types.ts";
import { TYPE_META } from "./view-model.ts";

export type NotificationFetcher = (input: string, init?: RequestInit) => Promise<Response>;

export type NotificationReadStateV1 =
  | { readonly status: "loading" }
  /** The route 404s: the ancillary set is off in this deployment, so there is no read at all. */
  | { readonly status: "off" }
  | { readonly status: "error"; readonly correlationId: string | null }
  | {
      readonly status: "ready";
      readonly notifications: NotificationEventV2[];
      readonly unreadCount: number;
      readonly windowDays: number;
      /** True when the 200-row cap bound, so the window shown is narrower than the window promised. */
      readonly capped: boolean;
      /** The event classes this tenant's flags can actually produce; the empty state teaches from it. */
      readonly sources: NotificationEventType[];
    };

export type MarkReadResultV1 =
  | { readonly ok: true; readonly notification: NotificationEventV2 }
  | { readonly ok: false; readonly message: string };

export type MarkAllReadResultV1 =
  | { readonly ok: true; readonly updated: number; readonly unreadCount: number }
  | { readonly ok: false; readonly message: string };

const MARK_FAILED = "That notification could not be marked read. Nothing on your account changed.";
const MARK_ALL_FAILED = "Your notifications could not be marked read. Nothing on your account changed.";

function isEvent(value: unknown): value is NotificationEventV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string"
    && row.id.length > 0
    && typeof row.type === "string"
    && Object.hasOwn(TYPE_META, row.type)
    && typeof row.occurredAt === "string"
    && typeof row.title === "string"
    && typeof row.detail === "string"
    && typeof row.target === "string"
    && TYPE_META[row.type as NotificationEventType].target === row.target
    && (row.readAt === null || typeof row.readAt === "string")
  );
}

async function body(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const parsed = (await response.json()) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function correlationOf(parsed: Record<string, unknown> | null): string | null {
  return typeof parsed?.correlationId === "string" ? parsed.correlationId : null;
}

function messageOf(parsed: Record<string, unknown> | null, fallback: string): string {
  const error = parsed?.error;
  if (error && typeof error === "object" && !Array.isArray(error)) {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim().length > 0) return message;
  }
  return fallback;
}

export async function fetchNotifications(
  fetcher: NotificationFetcher = fetch,
): Promise<NotificationReadStateV1> {
  let response: Response;
  try {
    response = await fetcher("/api/notifications", { cache: "no-store", credentials: "same-origin" });
  } catch {
    return { correlationId: null, status: "error" };
  }
  if (response.status === 404) return { status: "off" };
  const parsed = await body(response);
  if (!response.ok || !parsed) return { correlationId: correlationOf(parsed), status: "error" };

  const rows = parsed.notifications;
  if (!Array.isArray(rows) || !rows.every(isEvent)) {
    return { correlationId: correlationOf(parsed), status: "error" };
  }
  const notifications = rows as NotificationEventV2[];
  // The unread count is derived when the route omits it rather than defaulted to zero: the shell
  // badge reads this number, and a silent zero is indistinguishable from a read inbox.
  const unreadCount = typeof parsed.unreadCount === "number"
    ? parsed.unreadCount
    : notifications.filter((event) => event.readAt === null).length;
  const windowDays = typeof parsed.windowDays === "number" ? parsed.windowDays : NOTIFICATION_WINDOW_DAYS;
  // `capped` and `sources` both default to the conservative answer when a route predates them: no
  // cap notice rather than a false one, and — because an empty `sources` would teach an empty
  // account that nothing can ever arrive — every class the caller actually returned events for.
  const capped = parsed.capped === true;
  const sources = Array.isArray(parsed.sources)
    ? (parsed.sources.filter(
        (value): value is NotificationEventType => typeof value === "string" && Object.hasOwn(TYPE_META, value),
      ))
    : [...new Set(notifications.map((event) => event.type))];
  return { capped, notifications, sources, status: "ready", unreadCount, windowDays };
}

/**
 * Mark one event read. The id is an event key of the form `"<type>:<uuid>"`, so it is encoded into
 * the path rather than interpolated: an unencoded colon is a path segment the route will not match.
 */
export async function markRead(
  eventKey: string,
  fetcher: NotificationFetcher = fetch,
): Promise<MarkReadResultV1> {
  let response: Response;
  try {
    response = await fetcher(`/api/notifications/${encodeURIComponent(eventKey)}`, {
      cache: "no-store",
      credentials: "same-origin",
      method: "PATCH",
    });
  } catch {
    return { message: MARK_FAILED, ok: false };
  }
  const parsed = await body(response);
  if (!response.ok || !parsed) return { message: messageOf(parsed, MARK_FAILED), ok: false };
  const notification = parsed.notification;
  // A row that comes back still unread, or a row about some other event, would leave the optimistic
  // tint on screen over a server that never recorded the read.
  if (!isEvent(notification) || notification.id !== eventKey || notification.readAt === null) {
    return { message: MARK_FAILED, ok: false };
  }
  return { notification, ok: true };
}

/** Mark the whole window read in one request; the route owns the set, so the client does not enumerate it. */
export async function markAllRead(
  fetcher: NotificationFetcher = fetch,
): Promise<MarkAllReadResultV1> {
  let response: Response;
  try {
    response = await fetcher("/api/notifications/read-all", {
      cache: "no-store",
      credentials: "same-origin",
      method: "POST",
    });
  } catch {
    return { message: MARK_ALL_FAILED, ok: false };
  }
  const parsed = await body(response);
  if (!response.ok || !parsed) return { message: messageOf(parsed, MARK_ALL_FAILED), ok: false };
  if (typeof parsed.updated !== "number" || typeof parsed.unreadCount !== "number") {
    return { message: MARK_ALL_FAILED, ok: false };
  }
  return { ok: true, unreadCount: parsed.unreadCount, updated: parsed.updated };
}
