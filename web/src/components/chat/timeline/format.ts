/**
 * The four formatters every timeline string goes through.
 *
 * The one that matters is `timelineDate`. A timeline row carries two kinds of when: the instant it
 * sits at in the thread, and calendar facts that belong to money or access — a charge date, a
 * payment's received date, an access end date, a cap reset. An instant is shown in the reader's own
 * zone, because that is the zone they read the conversation in. A calendar fact is *not* an instant
 * and must never be treated as one: `new Date("2026-08-20")` is midnight UTC, and rendering that in
 * `America/Los_Angeles` prints Aug 19. That is G-BILL-01's class of defect, and the contract in
 * `lib/timeline/types.ts` is what makes the two distinguishable at all — `*On` fields are
 * `YYYY-MM-DD` and nothing else is. So the branch is on the *shape of the value*, not on the field
 * name a caller remembered to route correctly.
 *
 * Day labels and day boundaries come from `../time`, not from a second opinion here: the thread
 * already draws dividers for messages, and two functions deciding what "Yesterday" means is how a
 * message and the event beside it end up under different headings.
 */

/** A calendar fact. Exactly what the contract's `*On` fields are, and nothing an instant matches. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Whether a value is a date-only calendar fact rather than an instant. */
export function isDateOnly(value: string): boolean {
  return DATE_ONLY.test(value);
}

/** The clock time a row sits at, in the reader's zone: "9:01 AM". */
export function timelineTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/**
 * "Aug 20", in UTC for a calendar fact and in the reader's zone for an instant.
 *
 * See the header. The UTC branch is the whole reason this function exists.
 */
export function timelineDate(value: string): string {
  if (isDateOnly(value)) {
    return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  }
  return new Date(value).toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

/** "$500", "$29". Whole dollars, because every amount a row carries is one. */
export function timelineMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0 })}`;
}

/**
 * The open-action sentence, dated.
 *
 * Dated because a screenshot of an undated count implies a live value, and a count from a run three
 * weeks ago is not what is open now. Same rule as readiness: an observation with a date on it.
 */
export function openActionSentence(open: number | undefined, at: string): string {
  if (open === undefined) return "Open actions were not recorded with this analysis.";
  if (open === 0) return `No open actions as of ${timelineDate(at)}.`;
  return `${open} open action${open === 1 ? "" : "s"} in the plan as of ${timelineDate(at)}.`;
}

/** First letter up, for a document name used as a title. */
export function capitalize(value: string): string {
  return value.replace(/^./, (character) => character.toUpperCase());
}
