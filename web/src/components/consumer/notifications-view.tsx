"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Bell,
  Check,
  CheckCheck,
  ChevronRight,
  ClipboardCheck,
  FileText,
  Info,
  Landmark,
  MessageSquare,
  RefreshCw,
  Route,
  TriangleAlert,
} from "lucide-react";

import { ConsumerPageHeader } from "@/components/consumer/consumer-kit";
import { ConsumerNotificationPreferences } from "@/components/consumer/notification-preferences";
import { Button } from "@/components/ui/button";
import { useFreshKeys } from "@/lib/motion/hooks";
import { cn } from "@/lib/utils";
import type { ConsumerNotificationPreferences as ConsumerNotificationPreferenceList } from "@/lib/notifications/preferences";

import type {
  NotificationEventType,
  NotificationEventV2,
  NotificationTarget,
} from "./notifications/types";
import { NOTIFICATION_WINDOW_DAYS } from "./notifications/types";
import {
  applyFilter,
  bundleRows,
  childWhen,
  emptyStatePreview,
  filterCounts,
  groupByDay,
  navLabel,
  relativeTime,
  TYPE_META,
  type NotificationFilterV1,
  type NotificationIconName,
  type NotificationRowV1,
} from "./notifications/view-model";

/**
 * The consumer Notifications view.
 *
 * Four answers and no fifth, matching the read path: the workspace has no notification store at
 * all, the read is in flight, the read failed, or the window is here. An empty list is a claim
 * about the account and an outage is not, so they never render as the same screen.
 *
 * The state itself is lifted into `consumer.tsx`, because the shell's nav badge counts the same
 * unread rows this list draws. This component owns the shaping, the filter, and the optimistic
 * overlay while a read marker is in flight; it owns no source of truth.
 */

export type NotificationsSurfaceStateV1 =
  /** A durable workspace with the ancillary set switched off: there is no store to read. */
  | { readonly status: "absent"; readonly notice: string }
  | { readonly status: "loading" }
  /** `failures` counts consecutive failed reads, so the second one can offer a human instead. */
  | { readonly status: "error"; readonly failures: number }
  | {
      readonly status: "ready";
      readonly events: readonly NotificationEventV2[];
      readonly windowDays?: number;
      readonly capped?: boolean;
      readonly sources?: readonly NotificationEventType[];
    };

const ICONS: Readonly<Record<NotificationIconName, typeof Activity>> = {
  activity: Activity,
  "badge-check": BadgeCheck,
  "clipboard-check": ClipboardCheck,
  "file-text": FileText,
  landmark: Landmark,
  "message-square": MessageSquare,
  "refresh-cw": RefreshCw,
  route: Route,
};

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--consumer-accent-ink)]";

/**
 * The one ink used for every timestamp and count on this page.
 *
 * `text-muted-foreground` resolves to `--muted-foreground`, which measures below 4.5:1 once it sits
 * on the unread row's tint. This is a fixed slate that clears 4.5:1 on the card and on the tint,
 * which is where these strings actually live (R1 #12).
 */
const META_INK = "text-[#5f6b80]";

/**
 * The chip strip's box, in one place. R3 C3: the list has to start at the same y in the loading
 * skeleton and in the ready state for EVERY fixture, and B26 says the chips themselves do not
 * render under two events -- so the box is reserved unconditionally and the controls move in and
 * out of it. Every site that reserves or fills this box reads this constant, so the three cannot
 * drift apart. 44px chip + 6px scroll gutter on touch, 34px + 6px from lg.
 */
const CHIP_STRIP_BOX = "mb-4 h-[50px] lg:h-[40px]";

function Section({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-[10px] border border-[var(--consumer-surface-border)] bg-card text-card-foreground shadow-[var(--consumer-surface-shadow)]",
        className,
      )}
    >
      {children}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Filter chips                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A radiogroup on a roving tabindex: exactly one filter is active, arrows move between chips, and
 * the whole strip is one stop in the tab order rather than nine (R2 B11). The count lives in the
 * accessible name because the visible digit is decorative beside the label it belongs to.
 *
 * The strip scrolls at 390, so each edge carries a fade that appears only when there is something
 * past it — a scrollable row with no edge cue reads as a row that simply ends.
 */
function FilterChips({
  chips,
  onChange,
  radioId,
  value,
}: {
  chips: ReturnType<typeof filterCounts>;
  onChange: (filter: NotificationFilterV1) => void;
  radioId: (filter: NotificationFilterV1) => string;
  value: NotificationFilterV1;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ end: false, start: false });

  const measure = useCallback(() => {
    const node = strip.current;
    if (!node) return;
    setEdges({
      end: node.scrollLeft + node.clientWidth < node.scrollWidth - 1,
      start: node.scrollLeft > 1,
    });
  }, []);

  useEffect(() => {
    measure();
    const node = strip.current;
    if (!node) return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [chips.length, measure]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const keys = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const index = chips.findIndex((chip) => chip.filter === value);
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? chips.length - 1
          : forward
            ? (index + 1) % chips.length
            : (index - 1 + chips.length) % chips.length;
    onChange(chips[next].filter);
    strip.current
      ?.querySelector<HTMLButtonElement>(`#${CSS.escape(radioId(chips[next].filter))}`)
      ?.focus();
  }

  return (
    <div className={cn("relative", CHIP_STRIP_BOX)}>
      <div
        aria-label="Filter notifications"
        className="flex gap-2 overflow-x-auto pb-1.5 [-ms-overflow-style:none] [scroll-padding-inline:52px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onKeyDown={onKeyDown}
        onScroll={measure}
        ref={strip}
        role="radiogroup"
      >
        {chips.map((chip) => {
          const active = chip.filter === value;
          return (
            <button
              aria-checked={active}
              aria-label={`${chip.label}, ${chip.count} ${chip.count === 1 ? "notification" : "notifications"}`}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[0.78rem] font-semibold whitespace-nowrap lg:min-h-[34px] lg:px-3 lg:text-[0.76rem]",
                FOCUS_RING,
                active
                  ? "border-[var(--assistant-ground)] bg-[var(--assistant-ground)] text-[var(--card)]"
                  : "border-[var(--consumer-border)] bg-card text-[var(--consumer-muted)] hover:bg-[var(--surface-raised)]",
              )}
              id={radioId(chip.filter)}
              key={chip.filter}
              onClick={() => onChange(chip.filter)}
              role="radio"
              tabIndex={active ? 0 : -1}
              type="button"
            >
              <span aria-hidden>{chip.label}</span>
              <span
                aria-hidden
                className={cn(
                  "text-[0.7rem] font-bold tabular-nums",
                  active ? "text-[var(--accent-on-dark)]" : META_INK,
                )}
              >
                {chip.count}
              </span>
            </button>
          );
        })}
      </div>
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 bottom-1.5 w-13 bg-gradient-to-r from-[var(--consumer-canvas)] from-30% to-transparent transition-opacity duration-[var(--duration-quick)] motion-reduce:transition-none",
          edges.start ? "opacity-100" : "opacity-0",
        )}
      />
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 bottom-1.5 w-13 bg-gradient-to-l from-[var(--consumer-canvas)] from-30% to-transparent transition-opacity duration-[var(--duration-quick)] motion-reduce:transition-none",
          edges.end ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Rows                                                                       */
/* -------------------------------------------------------------------------- */

function TargetLabel({ className, label }: { className?: string; label: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex items-center gap-1 text-[0.7rem] font-semibold text-[var(--consumer-accent-ink)]",
        className,
      )}
    >
      {label}
      <ChevronRight aria-hidden className="size-3" />
    </span>
  );
}

/**
 * One feed row, whether it stands for a single event or for a bundle.
 *
 * Nothing about it is keyed on read state, so marking read mutates this node rather than replacing
 * it and the tint and dot actually animate out (R2 B3). The accessible name carries the relative
 * time, because on a feed of eight "A credit source alert is ready" rows the date is the half that
 * tells them apart (R2 B5).
 */
function Row({
  detail,
  icon,
  label,
  onOpen,
  targetLabel,
  title,
  typeText,
  unread,
  when,
}: {
  detail: string;
  icon: NotificationIconName;
  label: string;
  onOpen: () => void;
  targetLabel: string;
  title: string;
  typeText: string;
  unread: boolean;
  when: string;
}) {
  const Icon = ICONS[icon];
  return (
    <button
      aria-label={label}
      className={cn(
        "group grid w-full grid-cols-[14px_32px_minmax(0,1fr)] items-start gap-x-3 px-4 py-3.5 text-left",
        "lg:grid-cols-[14px_32px_minmax(0,1fr)_auto] lg:gap-x-3.5 lg:px-5 lg:py-4",
        "transition-colors duration-[var(--duration-medium)] ease-[var(--ease-smooth-out)] motion-reduce:transition-none",
        FOCUS_RING,
        "focus-visible:ring-inset",
        unread
          ? "bg-[var(--consumer-accent-tint)] hover:bg-[color-mix(in_srgb,var(--consumer-accent-tint),var(--consumer-accent)_8%)]"
          : "hover:bg-[var(--surface-raised)]",
      )}
      onClick={onOpen}
      type="button"
    >
      <span className="flex justify-center pt-[13px]">
        <span
          aria-hidden
          className={cn(
            "size-[7px] rounded-full bg-[var(--consumer-accent-ink)]",
            "transition-[opacity,transform] duration-[var(--duration-medium)] ease-[var(--ease-smooth-out)] motion-reduce:transition-none",
            unread ? "opacity-100" : "scale-[0.4] opacity-0",
          )}
        />
      </span>
      <span
        aria-hidden
        className={cn(
          "mt-px grid size-8 place-items-center rounded-[8px] border transition-colors duration-[var(--duration-medium)] ease-[var(--ease-smooth-out)] motion-reduce:transition-none",
          unread
            ? "border-[color-mix(in_srgb,var(--consumer-accent-ink),transparent_62%)] bg-card text-[var(--consumer-accent-ink)]"
            : "border-[var(--consumer-border)] bg-[var(--consumer-canvas)] text-[var(--consumer-muted)]",
        )}
      >
        <Icon aria-hidden className="size-4" />
      </span>
      <span className="min-w-0">
        <span
          aria-hidden
          className={cn("block text-[0.63rem] font-bold uppercase tracking-[0.085em]", META_INK)}
        >
          {typeText}
          {when ? <span className="font-semibold normal-case tracking-[0.04em]"> · {when}</span> : null}
        </span>
        <span
          aria-hidden
          className={cn(
            "mt-0.5 block text-sm leading-snug tracking-[-0.01em]",
            unread ? "font-bold" : "font-medium",
          )}
        >
          {title}
        </span>
        <span aria-hidden className="mt-1 block max-w-[68ch] text-[0.78rem] leading-relaxed text-muted-foreground">
          {detail}
        </span>
        <TargetLabel className="mt-2 lg:hidden" label={targetLabel} />
      </span>
      <TargetLabel className="hidden self-center lg:col-start-4 lg:inline-flex" label={targetLabel} />
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Empty, loading and error states                                            */
/* -------------------------------------------------------------------------- */

function StatePanel({
  action,
  body,
  footnote,
  glyph,
  role,
  title,
  tone = "accent",
}: {
  action?: ReactNode;
  body: ReactNode;
  /** A small line BELOW the action -- §9 puts the retention statement at the card's bottom. */
  footnote?: string;
  glyph: ReactNode;
  role?: "status" | "alert";
  title: string;
  tone?: "accent" | "warning";
}) {
  return (
    // A full-width card holding one short block of prose reads as broken, so the panel hugs its
    // copy rather than framing a void.
    <Section className="max-w-[44rem]">
      <div className="px-4 pb-7 pt-6 sm:px-5 sm:pb-8 sm:pt-7" role={role}>
        <span
          className={cn(
            "grid size-11 place-items-center rounded-[12px] border",
            tone === "warning"
              ? "border-[color-mix(in_srgb,var(--consumer-warning-border),transparent_40%)] bg-[color-mix(in_srgb,var(--consumer-warning),transparent_62%)] text-[var(--consumer-warning-ink)]"
              : "border-[color-mix(in_srgb,var(--consumer-accent-ink),transparent_66%)] bg-[var(--consumer-accent-tint)] text-[var(--consumer-accent-ink)]",
          )}
        >
          {glyph}
        </span>
        <h2 className="mt-4 text-[1.25rem] font-semibold leading-[1.24] tracking-[-0.03em] lg:text-[1.44rem]">
          {title}
        </h2>
        <div className="max-w-[62ch] text-[0.85rem] leading-relaxed text-muted-foreground [&>p]:mt-2.5">
          {body}
        </div>
        {action ? <div className="mt-5">{action}</div> : null}
        {footnote ? <p className={cn("mt-4 text-[0.72rem]", META_INK)}>{footnote}</p> : null}
      </div>
    </Section>
  );
}

/**
 * The loading state reserves the chip strip and the mark-all control as well as the rows (R1 #13,
 * R2 B7), so nothing on the page moves when the read lands. The reservations use the same
 * geometry as the real controls rather than a guessed height.
 */
function LoadingRows() {
  const bar = "animate-pulse rounded-md bg-[var(--surface-raised)] motion-reduce:animate-none";
  return (
    <div aria-live="polite" role="status">
      <span className="sr-only">Loading your notifications.</span>
      <div aria-hidden className={cn("flex gap-2 overflow-hidden pb-1.5", CHIP_STRIP_BOX)}>
        {[72, 96, 118, 92, 104, 128].map((width) => (
          <span
            className="h-11 shrink-0 animate-pulse rounded-full bg-[var(--surface-raised)] motion-reduce:animate-none lg:h-[34px]"
            key={width}
            style={{ width }}
          />
        ))}
      </div>
      <Section>
        {[0, 1, 2, 3, 4].map((row) => (
          <div
            aria-hidden
            className="grid grid-cols-[14px_32px_minmax(0,1fr)] gap-x-3 border-t border-[var(--consumer-border)] px-4 py-4 first:border-t-0 lg:gap-x-3.5 lg:px-5"
            key={row}
          >
            <span />
            <span className={cn("size-8 rounded-[8px]", bar)} />
            <span className="flex max-w-[34rem] flex-col gap-[7px] pt-0.5">
              <span className={cn("h-2 w-[38%]", bar)} />
              <span className={cn("h-3", bar)} style={{ width: row === 2 ? "56%" : row === 4 ? "84%" : "72%" }} />
              <span className={cn("h-2", bar)} style={{ width: row === 2 ? "64%" : row === 4 ? "71%" : "92%" }} />
            </span>
          </div>
        ))}
      </Section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The view                                                                   */
/* -------------------------------------------------------------------------- */

export function ConsumerNotificationsView({
  markAllRead,
  markRead,
  navigate,
  now,
  onPreferencesSaved,
  preferencesEnabled,
  retry,
  state,
}: {
  /** Resolves false when the write failed; the caller owns the toast and the authoritative rows. */
  markAllRead: () => Promise<boolean>;
  markRead: (eventKey: string) => Promise<boolean>;
  navigate: (target: NotificationTarget) => void;
  /** Injected only by tests and screenshot walks; the browser passes nothing. */
  now?: Date;
  /** Reconciles the lifted feed and unread badge after a persisted preference change. */
  onPreferencesSaved: (preferences: ConsumerNotificationPreferenceList) => void;
  /** Durable notification workspaces expose persisted event and channel choices. */
  preferencesEnabled: boolean;
  retry: () => void;
  state: NotificationsSurfaceStateV1;
}) {
  const [filter, setFilter] = useState<NotificationFilterV1>("all");
  /** Keys marked read locally while the PATCH is in flight, dropped again if it fails. */
  const [optimistic, setOptimistic] = useState<ReadonlySet<string>>(new Set());
  const [markingAll, setMarkingAll] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const feed = useRef<HTMLUListElement>(null);
  const chipPrefix = useId();
  const radioId = useCallback(
    (value: NotificationFilterV1) => `${chipPrefix}-${value}`,
    [chipPrefix],
  );

  const clock = useMemo(() => now ?? new Date(), [now]);

  const events = useMemo(() => {
    const source = state.status === "ready" ? state.events : [];
    return source.map((event) =>
      event.readAt === null && optimistic.has(event.id)
        ? { ...event, readAt: clock.toISOString() }
        : event,
    );
  }, [clock, optimistic, state]);

  const chips = useMemo(() => filterCounts(events), [events]);
  const unreadCount = events.filter((event) => event.readAt === null).length;
  // Rows that arrived while the page was open enter and cool; the list that mounts full does not.
  const freshIds = useFreshKeys(events.map((event) => event.id));

  /**
   * A refetch can drop the last event of a type and take its chip with it. The fallback to All is
   * derived here rather than corrected in an effect, so the list is never rendered once against a
   * chip that no longer exists.
   */
  const active: NotificationFilterV1 =
    filter === "all" || chips.some((chip) => chip.filter === filter) ? filter : "all";

  /**
   * Move focus to the row that took the place of the one that just left the filtered view (R2 B10).
   *
   * Reading a row under the Unread filter removes it, and the browser's answer to a focused element
   * disappearing is to drop focus on the body — which sends the next Tab back to the top of the
   * page. The successor is found by DOM position rather than by id, because the row that follows is
   * the one the reader was working towards; the group heading is the fallback when the row was last.
   */
  const restoreFocus = useCallback((index: number) => {
    requestAnimationFrame(() => {
      const container = feed.current;
      if (!container) return;
      if (container.contains(document.activeElement) && document.activeElement !== document.body) return;
      const rows = container.querySelectorAll<HTMLElement>("[data-feed-row]");
      const next = rows[Math.min(index, rows.length - 1)];
      if (next) {
        next.focus();
        return;
      }
      container.querySelector<HTMLElement>("[data-group-heading]")?.focus();
    });
  }, []);

  /** Tint the row now, then let the PATCH confirm or take it back. Never navigates. */
  const recordRead = useCallback(
    (event: NotificationEventV2) => {
      if (event.readAt !== null) return;
      setOptimistic((current) => new Set(current).add(event.id));
      void markRead(event.id).then((ok) => {
        if (ok) return;
        setOptimistic((current) => {
          const next = new Set(current);
          next.delete(event.id);
          return next;
        });
      });
    },
    [markRead],
  );

  const openEvent = useCallback(
    (event: NotificationEventV2, index: number) => {
      // Navigation is not conditional on the read marker landing, and a row that is already read
      // still navigates: reading is a side effect of opening, never a gate (R2 B6). Refusing to
      // open a record because a read flag failed to save would withhold the thing the consumer
      // asked for over bookkeeping; the failure still surfaces as a toast from the caller.
      const wasUnread = event.readAt === null;
      recordRead(event);
      if (wasUnread && active === "unread") restoreFocus(index);
      navigate(event.target);
    },
    [active, navigate, recordRead, restoreFocus],
  );

  const openRow = useCallback(
    (row: NotificationRowV1, index: number) => {
      if (row.kind === "event") {
        openEvent(row.event, index);
        return;
      }
      // A bundle stands for its children, so opening it reads all of them — but it navigates once,
      // not once per child.
      const hadUnread = row.children.some((child) => child.readAt === null);
      for (const child of row.children) recordRead(child);
      if (hadUnread && active === "unread") restoreFocus(index);
      navigate(row.target);
    },
    [active, navigate, openEvent, recordRead, restoreFocus],
  );

  const onMarkAll = useCallback(async () => {
    if (unreadCount === 0 || markingAll) {
      // The control is `aria-disabled` rather than `disabled`, so it keeps its place in the tab
      // order and can still be reached and read. Pressing it in that state does nothing, which is
      // what its accessible name already says.
      return;
    }
    setMarkingAll(true);
    const keys = events.filter((event) => event.readAt === null).map((event) => event.id);
    setOptimistic((current) => new Set([...current, ...keys]));
    const ok = await markAllRead();
    if (ok) {
      setAnnouncement(`${keys.length} ${keys.length === 1 ? "notification" : "notifications"} marked read.`);
    } else {
      setOptimistic((current) => {
        const next = new Set(current);
        for (const key of keys) next.delete(key);
        return next;
      });
      setAnnouncement("Your notifications could not be marked read.");
    }
    setMarkingAll(false);
  }, [events, markAllRead, markingAll, unreadCount]);

  const onFilter = useCallback(
    (next: NotificationFilterV1, count: number) => {
      setFilter(next);
      const label = chips.find((chip) => chip.filter === next)?.label ?? "All";
      setAnnouncement(`${label} filter. ${count} ${count === 1 ? "notification" : "notifications"}.`);
    },
    [chips],
  );

  /**
   * One polite region, mounted once outside everything that re-renders and updated by text only
   * (R1 #15, R2 B4). A live region that is destroyed and recreated with each render announces
   * nothing at all in most screen readers, because the node the reader was watching is gone.
   */
  const liveRegion = (
    <p aria-live="polite" className="sr-only" role="status">
      {announcement}
    </p>
  );

  /**
   * The bulk control is absent while loading, after a failure, and on an account that has never
   * had a notification: in the first two the unread count is unknown, and in the third a
   * permanently inert control over teaching copy is clutter. Once the account has events it stays
   * put and merely goes inert, so it does not appear and vanish between visits.
   */
  const showMarkAll = state.status === "ready" && events.length > 0;
  const markAllInert = unreadCount === 0 || markingAll;

  const header = (
    <>
      <ConsumerPageHeader
        actions={
          showMarkAll ? (
            <button
              aria-disabled={markAllInert}
              aria-label={
                markAllInert ? "Mark all read, nothing unread" : `Mark all read, ${unreadCount} unread`
              }
              className={cn(
                "inline-flex min-h-11 items-center gap-1.5 rounded-[8px] border border-transparent px-2.5 text-[0.8rem] font-semibold text-[var(--consumer-accent-ink)]",
                FOCUS_RING,
                markAllInert ? "cursor-default text-muted-foreground" : "hover:bg-[var(--consumer-accent-tint)]",
              )}
              onClick={() => void onMarkAll()}
              type="button"
            >
              <CheckCheck aria-hidden className="size-4" />
              <span aria-hidden>Mark all read</span>
            </button>
          ) : null
        }
        eyebrow="Account activity"
        title="Notifications"
      />
      <ConsumerNotificationPreferences
        enabled={preferencesEnabled}
        onSaved={onPreferencesSaved}
      />
    </>
  );

  if (state.status === "absent") {
    return (
      <div>
        {header}
        {liveRegion}
        <StatePanel
          body={<p>{state.notice}</p>}
          glyph={<Bell aria-hidden className="size-5" />}
          role="status"
          title="No notification record in this workspace"
        />
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div>
        {header}
        {liveRegion}
        <LoadingRows />
      </div>
    );
  }

  if (state.status === "error") {
    // R1 #16: a second consecutive failure stops offering the same button as though nothing had
    // happened, and names the way to reach a person who can send what the consumer came for.
    const repeated = state.failures > 1;
    return (
      <div>
        {header}
        {liveRegion}
        <StatePanel
          action={
            <Button className="min-h-11" onClick={retry} variant="outline">
              <RefreshCw aria-hidden /> {repeated ? "Try once more" : "Retry"}
            </Button>
          }
          body={
            <>
              <p>
                Nothing on this page can be opened or marked read until it loads. Your records are
                unaffected: every analysis, document, stage change, and message is still where it was,
                and your team can still see all of them.
              </p>
              {repeated ? (
                <p>
                  This is the second time it has failed. If it keeps failing, open{" "}
                  <b className="font-semibold text-foreground">Team Chat</b> and your team can send
                  you what you are looking for.
                </p>
              ) : null}
            </>
          }
          glyph={<TriangleAlert aria-hidden className="size-5" />}
          role="alert"
          title="Your notifications could not be loaded"
          tone="warning"
        />
      </div>
    );
  }

  const windowDays = state.windowDays ?? NOTIFICATION_WINDOW_DAYS;
  const visible = applyFilter(events, active);
  const allGroups = groupByDay(events, clock);
  const groups = groupByDay(visible, clock);

  if (events.length === 0) {
    // Never had one. §9's hierarchy: the headline is the only heavy element, one muted lead line,
    // then the feed's own row geometry previewing what will land in it -- a picture of the page
    // rather than a description of it. The rows are generated from the classes the read said can
    // arrive and capped at §8's three, so the page never previews a notification with no source
    // behind it (B2), and the cap decides how many get shown, never whether a shown one is real.
    const preview = emptyStatePreview(state.sources ?? []);
    return (
      <div>
        {header}
        {liveRegion}
        <StatePanel
          action={
            <Button className="min-h-11" onClick={() => navigate("dashboard")} variant="outline">
              <ArrowRight aria-hidden /> Go to Overview
            </Button>
          }
          body={
            preview.length > 0 ? (
              <>
                <p>Here&apos;s what will show up:</p>
                <ul className="mt-3.5 list-none">
                  {preview.map((row) => {
                    const Icon = ICONS[TYPE_META[row.type].icon];
                    return (
                      <li
                        className="grid grid-cols-[14px_32px_minmax(0,1fr)] items-center gap-x-3 border-t border-[var(--consumer-border)] py-[11px] first:border-t-0 lg:gap-x-3.5 lg:py-3"
                        key={row.type}
                      >
                        <span />
                        <span className="grid size-8 place-items-center rounded-[8px] border border-[var(--consumer-border)] bg-[var(--consumer-canvas)] text-[var(--consumer-muted)]">
                          <Icon aria-hidden className="size-4" />
                        </span>
                        <span className="min-w-0">
                          <b className="block text-[0.85rem] font-semibold leading-[1.3] tracking-[-0.01em] text-foreground">
                            {row.label}
                          </b>
                          <span className={cn("mt-0.5 block text-[0.76rem] leading-normal", META_INK)}>
                            {row.when}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <p>
                Nothing on your account is set up to send notifications yet. Your team holds every
                record in the meantime.
              </p>
            )
          }
          footnote={`Kept for ${windowDays} days.`}
          glyph={<Bell aria-hidden className="size-5" />}
          title="No notifications yet"
        />
      </div>
    );
  }


  // Under two events there is nothing to filter, so no chip renders (B26) -- but the box stays,
  // because the skeleton reserved it and a one-event feed must not jump when the read lands (C3).
  const chipRow =
    chips.length > 0 ? (
      <FilterChips
        chips={chips}
        onChange={(next) => onFilter(next, chips.find((chip) => chip.filter === next)?.count ?? 0)}
        radioId={radioId}
        value={active}
      />
    ) : (
      <div aria-hidden className={CHIP_STRIP_BOX} />
    );

  // R2 B9: when the cap binds, say so where the consumer is standing rather than 200 rows below the
  // fold. The footer line stays as the retention statement.
  // §9: ONE disclosure line, at the head of the list card, present whenever there are events.
  // It used to be a banner above the card plus a footer line below 200 rows -- the same fact
  // twice, and the half a capped consumer needed most sat past the fold.
  const disclosure = (
    <p
      className={cn(
        "flex items-start gap-[7px] border-b border-[var(--consumer-border)] px-4 py-3.5 text-[0.72rem] leading-normal lg:px-5",
        META_INK,
      )}
    >
      <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span>
        {state.capped
          ? `Showing the 200 most recent notifications from the last ${windowDays} days. Older ones are not shown here, and your team still holds every record.`
          : `Showing the last ${windowDays} days.`}
      </span>
    </p>
  );

  if (visible.length === 0) {
    // Cleared out is a different sentence from never had, and the way back is to All rather than
    // to an unrelated view. The chips stay rendered with their counts intact, so an empty Unread
    // filter can never be mistaken for an empty account.
    const chip = chips.find((entry) => entry.filter === active);
    return (
      <div>
        {header}
        {liveRegion}
        {chipRow}
        <StatePanel
          action={
            <Button className="min-h-11" onClick={() => onFilter("all", events.length)} variant="outline">
              <ArrowRight aria-hidden /> Show all notifications
            </Button>
          }
          body={
            <p>
              {/* §9: one short sentence each. The second half of both used to explain the page
                  to somebody who is already looking at it. */}
              {active === "unread"
                ? `Every notification in your last ${windowDays} days has been opened.`
                : `You have no ${chip?.label.toLowerCase() ?? "matching"} notifications in the last ${windowDays} days.`}
            </p>
          }
          glyph={<Check aria-hidden className="size-5" />}
          role="status"
          title={active === "unread" ? "You're all caught up" : "Nothing under this filter"}
        />
      </div>
    );
  }

  /**
   * The feed, flattened once before render so every row knows its absolute position. Focus
   * restoration needs that position, and computing it by mutating a counter mid-render would make
   * the number depend on how many times React chose to call this function.
   */
  const renderGroups = groups.map((group) => {
    const entry = allGroups.find((candidate) => candidate.label === group.label);
    return {
      dayEventsAll: entry?.events ?? group.events,
      groupUnread: entry?.unreadCount ?? 0,
      label: group.label,
      rows: bundleRows(entry?.events ?? group.events, group.events),
    };
  });
  const rowOffsets = renderGroups.reduce<number[]>(
    (offsets, group) => [...offsets, (offsets.at(-1) ?? 0) + group.rows.length],
    [0],
  );

  return (
    <div>
      {header}
      {liveRegion}
      {chipRow}
      
      <Section>
        {disclosure}
        {/*
          A real list, so a screen reader is told how many notifications there are before it starts
          reading them, and a bundle's children are announced as a list nested inside their row
          rather than as more siblings (R2 B12).
        */}
        <ul className="list-none" ref={feed}>
          {renderGroups.map((group, groupIndex) => {
            // Only the newest group takes the accent, and only while it holds something unread.
            const { groupUnread } = group;
            const fresh = groupIndex === 0 && groupUnread > 0;
            return (
              <li className="border-t border-[var(--consumer-border)] first:border-t-0" key={group.label}>
                <h2
                  className={cn(
                    "flex items-baseline justify-between gap-3 px-4 pb-2 pt-4 text-[0.66rem] font-bold uppercase tracking-[0.11em] outline-none lg:px-5 lg:pt-[18px]",
                    fresh ? "text-[var(--consumer-accent-ink)]" : META_INK,
                  )}
                  data-group-heading
                  tabIndex={-1}
                >
                  <span>{group.label}</span>
                  {groupUnread > 0 ? (
                    <span className="text-[0.63rem] font-bold normal-case tracking-[0.04em] tabular-nums text-[var(--consumer-accent-ink)]">
                      {groupUnread} unread
                    </span>
                  ) : null}
                </h2>
                <ul className="list-none">
                  {group.rows.map((row, withinGroup) => {
                    const index = rowOffsets[groupIndex] + withinGroup;
                    if (row.kind === "event") {
                      const meta = TYPE_META[row.event.type];
                      const when = relativeTime(row.event.occurredAt, clock);
                      return (
                        <li
                          className="border-t border-[var(--consumer-border)] [&:first-child]:border-t-0"
                          data-feed-row
                          data-motion-fresh={freshIds.has(row.event.id) ? "" : undefined}
                          key={row.event.id}
                        >
                          <Row
                            detail={row.event.detail}
                            icon={meta.icon}
                            label={`${row.event.readAt === null ? "Unread. " : ""}${row.event.title}. ${row.event.detail} ${when}. Opens ${navLabel(meta.target)}.`}
                            onOpen={() => openRow(row, index)}
                            targetLabel={navLabel(meta.target)}
                            title={row.event.title}
                            typeText={meta.label}
                            unread={row.event.readAt === null}
                            when={when}
                          />
                        </li>
                      );
                    }
                    const meta = TYPE_META[row.type];
                    const when = relativeTime(row.occurredAt, clock);
                    return (
                      <li
                        // No tint here. The header Row tints itself like any other row, and each
                        // unread child tints its own full width -- a tint on the wrapper painted
                        // the whole block including children that had already been read.
                        className="border-t border-[var(--consumer-border)] [&:first-child]:border-t-0"
                        data-feed-row
                        key={row.id}
                      >
                        <Row
                          detail={row.detail}
                          icon={meta.icon}
                          label={`${row.unreadCount > 0 ? `${row.unreadCount} unread. ` : ""}${row.title}. ${row.detail} ${when}. Opens ${navLabel(meta.target)}, and marks ${row.children.length} read.`}
                          onOpen={() => openRow(row, index)}
                          targetLabel={navLabel(meta.target)}
                          title={row.title}
                          typeText={meta.label}
                          unread={row.unread}
                          when={when}
                        />
                        {/*
                          The children are a continuation of the row above, not a card floating
                          inside it. Two edges, deliberately different: each child's BOX runs the
                          row's full width, so an unread child's tint is the same edge-to-edge
                          band the header above it paints -- an inset tint inside a full-bleed one
                          reads as a broken block, which is the fault this whole layout is fixing.
                          Its CONTENT and its hairline sit between the parent title's x (the row's
                          padding plus the dot and glyph columns and both gaps) and the row's own
                          padding edge, where the target label sits. So the padding lives on the
                          child, never on this list.
                        */}
                        <ul className="list-none pb-2 lg:pb-2.5">
                          {row.children.map((child) => {
                            const childUnread = child.readAt === null;
                            return (
                              <li
                                // The hairline is drawn by the inner content box, so it stops at
                                // the same edges the text does rather than running under the tint.
                                className="[&:first-child_[data-child-line]]:border-t-0"
                                key={child.id}
                              >
                                <button
                                  aria-label={`${childUnread ? "Unread. " : ""}${child.title}, ${childWhen(child.occurredAt, clock)}. Opens ${navLabel(TYPE_META[child.type].target)}.`}
                                  className={cn(
                                    "block w-full pl-[86px] pr-4 text-left lg:pl-[94px] lg:pr-5",
                                    "transition-colors duration-[var(--duration-medium)] ease-[var(--ease-smooth-out)] motion-reduce:transition-none",
                                    FOCUS_RING,
                                    "focus-visible:ring-inset",
                                    childUnread
                                      ? "bg-[var(--consumer-accent-tint)] hover:bg-[color-mix(in_srgb,var(--consumer-accent-tint),var(--consumer-accent)_8%)]"
                                      : "hover:bg-[var(--surface-raised)]",
                                  )}
                                  onClick={() => openEvent(child, index)}
                                  type="button"
                                >
                                  <span
                                    className="flex min-h-11 w-full items-center gap-2.5 border-t border-dashed border-[var(--consumer-border)] py-2 lg:min-h-9 lg:py-[7px]"
                                    data-child-line
                                  >
                                  <span
                                    aria-hidden
                                    className={cn(
                                      "size-1.5 shrink-0 rounded-full bg-[var(--consumer-accent-ink)]",
                                      "transition-opacity duration-[var(--duration-medium)] ease-[var(--ease-smooth-out)] motion-reduce:transition-none",
                                      childUnread ? "opacity-100" : "opacity-0",
                                    )}
                                  />
                                  <span
                                    aria-hidden
                                    className={cn(
                                      "min-w-0 flex-1 text-[0.78rem] leading-snug",
                                      childUnread ? "font-semibold" : "font-normal",
                                    )}
                                  >
                                    {child.title}
                                  </span>
                                  <span
                                    aria-hidden
                                    className={cn("shrink-0 text-[0.7rem] tabular-nums", META_INK)}
                                  >
                                    {childWhen(child.occurredAt, clock)}
                                  </span>
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      </Section>
    </div>
  );
}
