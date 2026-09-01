/**
 * Timestamps, in the three forms a conversation needs at once.
 *
 * Pure functions with an injected `now`, because a relative timestamp is the classic thing that
 * is only ever tested by reading it — and "2 hours ago" is wrong in a way nobody notices until a
 * client is looking at a thread that says their message arrived before they sent it.
 *
 * UTC is carried alongside local everywhere. Two operators in different offices reading the same
 * thread have to be able to agree about when something happened, and the tracker table already
 * made this choice for exactly that reason.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** `null` when the value is not a timestamp at all, so a caller cannot render "Invalid Date". */
export function parseTimestamp(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * "just now" · "4m" · "3h" · "Yesterday" · "12 Aug" · "12 Aug 2025".
 *
 * Short, because this sits on a thread row beside a name and a preview and every character it
 * takes is a character the preview does not get. A future timestamp reads as "just now" rather
 * than "in 3 minutes": clock skew between a browser and the database is real and small, and
 * announcing it to the reader helps nobody.
 */
export function relativeTime(value: string, now: Date = new Date()): string {
  const at = parseTimestamp(value);
  if (at === null) return "";

  const elapsed = now.getTime() - at.getTime();
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;

  const sameYear = at.getUTCFullYear() === now.getUTCFullYear();
  if (elapsed < 2 * DAY && startOfLocalDay(now) > at.getTime()) return "Yesterday";

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(at);
}

function startOfLocalDay(now: Date): number {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start.getTime();
}

/**
 * The long form: the reader's own clock, then the same instant in UTC.
 *
 * Both, always. The local value is what a person recognises and the UTC value is what two people
 * in different places can compare, and picking one means somebody loses.
 */
export function absoluteTime(value: string): string {
  const at = parseTimestamp(value);
  if (at === null) return "";
  const local = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(at);
  const utc = new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(at);
  return `${local} · ${utc} UTC`;
}

/** The divider between one day's messages and the next. */
export function dayLabel(value: string, now: Date = new Date()): string {
  const at = parseTimestamp(value);
  if (at === null) return "";
  const today = startOfLocalDay(now);
  const at_ = new Date(at);
  at_.setHours(0, 0, 0, 0);
  if (at_.getTime() === today) return "Today";
  if (at_.getTime() === today - DAY) return "Yesterday";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  }).format(at);
}

/** Whether two messages fall on different local days, and therefore want a divider between them. */
export function crossesDay(previous: string, current: string): boolean {
  const a = parseTimestamp(previous);
  const b = parseTimestamp(current);
  if (a === null || b === null) return false;
  return a.toDateString() !== b.toDateString();
}

/**
 * How long consecutive messages from one person stay in a single group.
 *
 * Five minutes is a judgement, not a standard. Long enough that a person typing three sentences
 * in a row gets one avatar and one timestamp; short enough that a reply four hours later is
 * visibly a reply and not a continuation.
 */
export const GROUPING_WINDOW_MS = 5 * MINUTE;

export function withinGroupingWindow(previous: string, current: string): boolean {
  const a = parseTimestamp(previous);
  const b = parseTimestamp(current);
  if (a === null || b === null) return false;
  return Math.abs(b.getTime() - a.getTime()) <= GROUPING_WINDOW_MS;
}
