/**
 * Pure shaping for the consumer notification feed. Nothing here reads the clock, the network or
 * the DOM: every function that depends on "now" takes it, so the same feed renders the same way in
 * a test, in a browser and in a screenshot walk.
 *
 * The division of labour with the server is deliberate. The server owns every sentence a consumer
 * reads about their own account, because that is where the compliance gate can see it. This module
 * owns only the sentences that describe the *shape* of the list — a day label, an age, a bundle
 * count, the classes an empty account can expect — which are claims about the feed rather than
 * about the account.
 */

import {
  type NotificationEventType,
  type NotificationEventV2,
  type NotificationTarget,
} from "./types.ts";

/** Icon names the view maps to lucide components. Kept as strings so this module stays React-free. */
export type NotificationIconName =
  | "activity"
  | "route"
  | "clipboard-check"
  | "refresh-cw"
  | "badge-check"
  | "file-text"
  | "message-square"
  | "landmark";

/**
 * The flag groups §2 gates each source behind. `sources` on the GET response reports which classes
 * this tenant can actually produce, and the empty state is generated from it — several event types
 * ride one flag, so the teaching sentence collapses them into one clause rather than making three
 * separate promises that a single switch turns off together.
 */
export type NotificationSourceGroup =
  | "enrollment"
  | "analysis"
  | "uploads"
  | "support"
  | "monitoring"
  | "applications";

/** The order a consumer meets these things, which is the order the teaching sentence reads in. */
/**
 * §8's priority order, and the cap that goes with it. Ayman's ruling on the round-3 mockup was
 * that the six-clause enumeration is "way too much text": the empty state names at most the first
 * three enabled sources, so a consumer reads one sentence rather than an inventory. The classes
 * that fall past the cap are still honest -- they simply are not advertised.
 */
export const SOURCE_ORDER: readonly NotificationSourceGroup[] = [
  "analysis",
  "uploads",
  "support",
  "monitoring",
  "enrollment",
  "applications",
];

export const EMPTY_STATE_CLAUSE_LIMIT = 3;

/**
 * The teaching empty state's preview rows (§9).
 *
 * Each source carries the event type whose glyph it will actually arrive under, a label written in
 * the register of a real row title, and one short line saying when it fires -- so the empty state
 * is a picture of the page rather than a description of it. Same §8 priority and same cap as the
 * clause list, because they answer the same question in two registers.
 */
export type NotificationPreviewRowV1 = {
  readonly type: NotificationEventType;
  readonly label: string;
  readonly when: string;
};

export const SOURCE_PREVIEW: Readonly<Record<NotificationSourceGroup, NotificationPreviewRowV1>> = {
  analysis: { label: "Analysis complete", type: "analysis_complete", when: "when your funding plan is ready" },
  applications: { label: "Application update", type: "application_update", when: "when your team records one" },
  enrollment: { label: "Enrollment step done", type: "enrollment_milestone", when: "when you finish a step" },
  monitoring: { label: "Credit source alert", type: "monitoring_alert", when: "when your monitoring flags a change" },
  support: { label: "Message from your team", type: "team_message", when: "when they write to you" },
  uploads: { label: "Document received", type: "document", when: "when a file lands in your vault" },
};

export const SOURCE_CLAUSE: Readonly<Record<NotificationSourceGroup, string>> = {
  analysis: "your analysis completes",
  applications: "there's an update on one of your applications",
  enrollment: "you complete an enrollment step",
  monitoring: "your monitoring flags a change",
  support: "your team sends you a message",
  uploads: "a document is received",
};

/**
 * The consumer nav labels, so a row names its destination the way the sidebar does.
 *
 * The nav arrays themselves live in `consumer.tsx`, which imports this module's view — importing
 * them back would close a cycle. The pairing is held instead by a test that reads those arrays out
 * of the surface and asserts every label here still matches, so a rename there fails the suite
 * rather than leaving a row pointing at a view nobody calls that any more.
 */
const NAV_LABEL: Readonly<Record<NotificationTarget, string>> = {
  coach: "Team Chat",
  credit: "Credit Monitoring",
  dashboard: "Overview",
  documents: "Onboarding & Docs",
  optimization: "Optimization",
  plan: "Your Funding",
};

export function navLabel(target: NotificationTarget): string {
  return NAV_LABEL[target];
}

export type NotificationTypeMeta = {
  /** The word above the headline: "Credit monitoring · 5 hours ago". */
  label: string;
  /** The filter chip's label, shorter than the row label because chips compete for width. */
  chipLabel: string;
  target: NotificationTarget;
  icon: NotificationIconName;
  source: NotificationSourceGroup;
  /** This type's half of the empty state's teaching sentence. */
  clause: string;
  /** `(count) => [title, detail]` for a same-type same-day collapse. */
  bundle: (count: number) => readonly [string, string];
};

/**
 * Contract order. The chip row is offered in this order rather than by count, so the chips do not
 * reshuffle under a consumer between two visits to the same page.
 *
 * No bundle string carries a raw plan version, the word "outcome" or the word "paid" (R2 B22).
 */
export const TYPE_META: Readonly<Record<NotificationEventType, NotificationTypeMeta>> = {
  monitoring_alert: {
    bundle: (n) => [`${n} credit source alerts are ready`, "Open Credit Monitoring to see what changed on the source record."],
    chipLabel: "Monitoring",
    clause: "your monitoring flags a change",
    icon: "activity",
    label: "Credit monitoring",
    source: "monitoring",
    target: "credit",
  },
  stage_change: {
    bundle: (n) => [`${n} stage changes were recorded`, "Your team recorded the changes."],
    chipLabel: "Stage",
    clause: "your stage changes",
    icon: "route",
    label: "Stage change",
    source: "analysis",
    target: "dashboard",
  },
  analysis_complete: {
    bundle: (n) => [`${n} plan updates are ready`, "Open Your Funding for the recalculated next steps."],
    chipLabel: "Analysis",
    clause: "your analysis completes",
    icon: "clipboard-check",
    label: "Analysis",
    source: "analysis",
    target: "plan",
  },
  refresh_result: {
    bundle: (n) => [`${n} credit refreshes are complete`, "Your plan and next steps were updated from the new snapshots."],
    chipLabel: "Refresh",
    clause: "a credit refresh finishes",
    icon: "refresh-cw",
    label: "Credit refresh",
    source: "analysis",
    target: "plan",
  },
  enrollment_milestone: {
    // B21: Onboarding & Docs is where the enrollment checklist actually lives.
    bundle: (n) => [`${n} enrollment milestones completed`, "Recorded in your enrollment."],
    chipLabel: "Enrollment",
    clause: "you complete an enrollment step",
    icon: "badge-check",
    label: "Enrollment",
    source: "enrollment",
    target: "documents",
  },
  document: {
    bundle: (n) => [`${n} documents were received`, "Your team can see them in your document vault."],
    chipLabel: "Documents",
    clause: "your documents are received",
    icon: "file-text",
    label: "Document",
    source: "uploads",
    target: "documents",
  },
  team_message: {
    bundle: (n) => [`${n} new messages from your team`, "Open Team Chat to read them."],
    chipLabel: "Messages",
    clause: "your team sends you a message",
    icon: "message-square",
    label: "Message",
    source: "support",
    target: "coach",
  },
  application_update: {
    bundle: (n) => [`${n} application updates were recorded`, "Your team recorded them. Open Your Funding for the record."],
    chipLabel: "Applications",
    clause: "there's an update on an application",
    icon: "landmark",
    label: "Application",
    source: "applications",
    target: "plan",
  },
};

const TYPE_ORDER = Object.keys(TYPE_META) as NotificationEventType[];

export function typeLabel(type: NotificationEventType): string {
  return TYPE_META[type].label;
}

/**
 * The clauses the empty state teaches, generated from the classes the caller says can arrive.
 *
 * Types that share a flag collapse to one clause: promising "your analysis completes", "a credit
 * refresh finishes" and "your stage changes" as three separate futures would be three promises one
 * switch turns off together, and the sentence stops being readable at eight clauses anyway.
 */
/** The enabled sources, in §8 priority, capped -- the one selector both empty-state registers use. */
export function previewSources(sources: readonly NotificationEventType[]): NotificationSourceGroup[] {
  const groups = new Set(
    sources.filter((type) => Object.hasOwn(TYPE_META, type)).map((type) => TYPE_META[type].source),
  );
  return SOURCE_ORDER.filter((group) => groups.has(group)).slice(0, EMPTY_STATE_CLAUSE_LIMIT);
}

/**
 * Every type's deep-link target, derived from the one table that already holds it.
 *
 * Callers outside this module (the fixture, for one) need the pairing without reaching into
 * `TYPE_META` and picking a field, and a second hand-written copy of it is exactly the drift the
 * round-5 standard is about.
 */
export const NOTIFICATION_TARGET: Readonly<Record<NotificationEventType, NotificationTarget>> =
  Object.freeze(
    Object.fromEntries(
      (Object.keys(TYPE_META) as NotificationEventType[]).map((type) => [type, TYPE_META[type].target]),
    ) as Record<NotificationEventType, NotificationTarget>,
  );

/** The §9 preview rows: the same picks as `emptyStateClauses`, rendered as feed rows. */
export function emptyStatePreview(sources: readonly NotificationEventType[]): NotificationPreviewRowV1[] {
  return previewSources(sources).map((group) => SOURCE_PREVIEW[group]);
}

export function emptyStateClauses(sources: readonly NotificationEventType[]): string[] {
  return previewSources(sources).map((group) => SOURCE_CLAUSE[group]);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parse(iso: string): Date | null {
  const when = new Date(iso);
  return Number.isNaN(when.getTime()) ? null : when;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** The Sunday that opens `date`'s calendar week, at local midnight. */
function startOfWeek(date: Date): number {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  day.setDate(day.getDate() - day.getDay());
  return day.getTime();
}

/** Whole local days between two instants. Local, because "Today" is a local-midnight question. */
function daysAgo(when: Date, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(when)) / 86_400_000);
}

function monthDay(when: Date): string {
  return `${MONTHS[when.getMonth()]} ${when.getDate()}`;
}

function clockTime(when: Date): string {
  const minutes = String(when.getMinutes()).padStart(2, "0");
  const hours24 = when.getHours();
  const suffix = hours24 >= 12 ? "PM" : "AM";
  return `${hours24 % 12 || 12}:${minutes} ${suffix}`;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/**
 * "just now" · "25 minutes ago" · "8 hours ago" · "yesterday" · "Aug 12".
 *
 * A source row stamped slightly ahead of the browser clock reads as "just now" rather than as a
 * negative age; database and browser clocks drift, and a notification from the future is a worse
 * lie than a rounded one. An unparseable timestamp returns the empty string, so the metadata line
 * simply loses its age instead of printing "Invalid Date".
 */
export function relativeTime(iso: string, now: Date): string {
  const when = parse(iso);
  if (!when) return "";
  const minutes = Math.round((now.getTime() - when.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}${plural(minutes, " minute ago", " minutes ago")}`;
  const days = daysAgo(when, now);
  if (days === 0) {
    const hours = Math.round(minutes / 60);
    return `${hours}${plural(hours, " hour ago", " hours ago")}`;
  }
  if (days === 1) return "yesterday";
  return monthDay(when);
}

/** A bundle child's timestamp: the clock alone while the day is still obvious, dated after that. */
export function childWhen(iso: string, now: Date): string {
  const when = parse(iso);
  if (!when) return "";
  return daysAgo(when, now) < 2 ? clockTime(when) : `${monthDay(when)} · ${clockTime(when)}`;
}

/**
 * The day-group heading an event falls under.
 *
 * "Earlier this week" is the same calendar week on a US Sunday start, not a rolling seven days
 * (R1 #18). On a Monday it therefore matches nothing, because the only earlier day in that week is
 * Sunday and Sunday is already Yesterday. That is the correct answer, not a missing group.
 */
export function dayLabel(iso: string, now: Date): string {
  const when = parse(iso);
  if (!when) return "Undated";
  const days = daysAgo(when, now);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (startOfWeek(when) === startOfWeek(now)) return "Earlier this week";
  return monthDay(when);
}

export type NotificationDayGroupV1 = {
  label: string;
  /** Counted over the underlying events, never over the rows a bundle collapses them into. */
  unreadCount: number;
  events: NotificationEventV2[];
};

/**
 * Newest-first day groups. The route already promises newest-first, but the sort is repeated here
 * because a group boundary drawn on an unsorted list silently splits one day into two headings.
 */
export function groupByDay(
  events: readonly NotificationEventV2[],
  now: Date,
): NotificationDayGroupV1[] {
  const sorted = [...events].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );
  const groups: NotificationDayGroupV1[] = [];
  for (const event of sorted) {
    const label = dayLabel(event.occurredAt, now);
    let group = groups.at(-1);
    if (!group || group.label !== label) {
      group = { events: [], label, unreadCount: 0 };
      groups.push(group);
    }
    group.events.push(event);
    if (event.readAt === null) group.unreadCount += 1;
  }
  return groups;
}

export type NotificationRowV1 =
  | { kind: "event"; event: NotificationEventV2 }
  | {
      kind: "bundle";
      /** Stable across filter switches and reads: the (type, calendar day) pair itself. */
      id: string;
      type: NotificationEventType;
      occurredAt: string;
      title: string;
      detail: string;
      target: NotificationTarget;
      unread: boolean;
      /** Unread children among those rendered. */
      unreadCount: number;
      /** Every event of this (type, day), including the ones the filter hides. */
      totalCount: number;
      /** The children the active filter leaves visible. */
      children: NotificationEventV2[];
    };

const BUNDLE_THRESHOLD = 3;

/**
 * Three or more events of one type inside one calendar day collapse into a single row carrying its
 * children.
 *
 * The threshold is three because two rows of the same shape still read as two facts, while five
 * identical "a document was received" rows read as a broken list.
 *
 * R2 B8: the decision to bundle, the title's count and the date all come from ALL the day's events
 * of that type, while only the filtered ones render as children. A four-document day still says
 * "4 documents were received" under the Unread filter and shows the two unread ones — counting the
 * filtered set instead would make the title a different, smaller claim every time a chip changed.
 */
export function bundleRows(
  dayEventsAll: readonly NotificationEventV2[],
  dayEventsVisible: readonly NotificationEventV2[],
): NotificationRowV1[] {
  const byKey = new Map<string, NotificationEventV2[]>();
  for (const event of dayEventsAll) {
    const key = `${event.type}|${startOfDay(new Date(event.occurredAt))}`;
    const seen = byKey.get(key);
    if (seen) seen.push(event);
    else byKey.set(key, [event]);
  }

  const emitted = new Set<string>();
  const rows: NotificationRowV1[] = [];
  for (const event of dayEventsVisible) {
    const key = `${event.type}|${startOfDay(new Date(event.occurredAt))}`;
    const siblings = byKey.get(key) ?? [event];
    if (siblings.length < BUNDLE_THRESHOLD) {
      rows.push({ event, kind: "event" });
      continue;
    }
    if (emitted.has(key)) continue;
    emitted.add(key);
    const newestFirst = [...siblings].sort(
      (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    );
    const visibleIds = new Set(dayEventsVisible.map((row) => row.id));
    const children = newestFirst.filter((child) => visibleIds.has(child.id));
    const [title, detail] = TYPE_META[event.type].bundle(siblings.length);
    rows.push({
      children,
      detail,
      id: `bundle:${key}`,
      kind: "bundle",
      occurredAt: newestFirst[0].occurredAt,
      target: TYPE_META[event.type].target,
      title,
      totalCount: siblings.length,
      type: event.type,
      unread: children.some((child) => child.readAt === null),
      unreadCount: children.filter((child) => child.readAt === null).length,
    });
  }
  return rows;
}

export type NotificationFilterV1 = "all" | "unread" | NotificationEventType;

export type NotificationFilterCountV1 = {
  filter: NotificationFilterV1;
  label: string;
  count: number;
};

/** Below this there is nothing to filter, so the chip row does not render at all (R2 B26). */
const CHIPS_MIN_EVENTS = 2;

/**
 * The chips to offer: All, Unread, then one per type actually present, each with its count.
 *
 * Only present types are offered, because a chip that always resolves to an empty list is a dead
 * control. A one-event feed offers none at all — filtering one row is theatre, and a row of chips
 * over a single notification reads as a page that lost something.
 */
export function filterCounts(events: readonly NotificationEventV2[]): NotificationFilterCountV1[] {
  if (events.length < CHIPS_MIN_EVENTS) return [];
  const chips: NotificationFilterCountV1[] = [
    { count: events.length, filter: "all", label: "All" },
    { count: events.filter((event) => event.readAt === null).length, filter: "unread", label: "Unread" },
  ];
  for (const type of TYPE_ORDER) {
    const count = events.filter((event) => event.type === type).length;
    if (count > 0) chips.push({ count, filter: type, label: TYPE_META[type].chipLabel });
  }
  return chips;
}

export function applyFilter(
  events: readonly NotificationEventV2[],
  filter: NotificationFilterV1,
): NotificationEventV2[] {
  if (filter === "all") return [...events];
  if (filter === "unread") return events.filter((event) => event.readAt === null);
  return events.filter((event) => event.type === filter);
}
