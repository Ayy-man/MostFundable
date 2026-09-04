"use client";

// The thread list: rows, filters, skeleton, empty.
//
// At 390px this is a screen and the conversation opens over it, which is the mobile shape every
// reference uses and the one the contract requires (§7). That is a layout decision the surfaces
// make, but it drives two things here: a row is a full-width target with a 44px floor, and nothing
// in it is small enough that hitting it needs precision.
//
// The unread count is rendered, never computed. Contract §3.1 derives it server-side from
// `support_messages` against the reader's own watermark, because a browser counting "messages
// after the last one I saw" gets it wrong the moment two devices are open — and a badge that is
// wrong about whether somebody is waiting on you is worse than no badge.
//
// The team filter is a Base UI Select, not a `<select>`. The native control cannot be styled to
// match anything, renders differently on every platform, and on iOS opens a wheel; the contract
// bans it outright and the combobox task in the plan is the same ruling.
//
// Status is tabs rather than a second dropdown, because Open / Pending / Resolved is a view the
// operator switches between constantly and burying it behind a click is the difference between a
// daily driver and a prototype.

import { Inbox, Search, X } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BrandSelect } from "@/components/ui/brand-select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { PaneSkeletonBar, PaneState, type PaneAction } from "./pane-state";
import { MessageTime } from "./message-thread";
import { threadPreview } from "./thread-preview";
import type { ChatThreadStatus, ChatThreadSummary } from "./types";

// ---------------------------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------------------------

export interface ThreadListItemProps {
  readonly thread: ChatThreadSummary;
  readonly selected: boolean;
  readonly onSelect: (threadRef: string) => void;
  readonly className?: string;
}

/**
 * Two-line initials, from the name the directory resolved.
 *
 * Never from the handle: an avatar built out of an opaque ref is a raw identifier on screen with
 * extra steps, and `no-raw-identifiers.test.ts` is watching for exactly that.
 */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function ThreadListItem({ className, onSelect, selected, thread }: ThreadListItemProps) {
  const unread = thread.unreadCount > 0;
  return (
    <button
      aria-current={selected ? "true" : undefined}
      className={cn(
        "group/thread relative flex w-full min-w-0 items-start gap-2.5 overflow-hidden rounded-[10px] py-2.5 pr-3 pl-3.5 text-left",
        // 52px floor: the top of the design brief's 44-52px list band, which is also comfortably
        // past the 44px touch minimum. Two lines, and the name owns the first one on its own: a
        // client name that truncates at eleven characters to leave room for a stage chip is the
        // one thing in a row a reader cannot work around, and the chip and the preview both can.
        // They share the second line, where the preview is what gives way.
        "min-h-[3.25rem] transition-colors duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)]",
        "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        selected
          ? "bg-[var(--accent)]"
          : "bg-card hover:bg-[var(--background)]",
        className,
      )}
      onClick={() => onSelect(thread.ref)}
      type="button"
    >
      {/*
        The one coloured left marker in this entire body of work.
        It is allowed here because it marks *selection* — it appears if and only if this row is the
        selected one, and it disappears with it. It is deliberately not a prop: a marker somebody
        can switch on becomes a decorative stripe on the next surface, which is the banned thing.
        Drawn as an element rather than a `border-l-2` so the blanket side-stripe ban in
        `design-rails.test.ts` stays absolute with no file exemption to erode.
      */}
      {selected ? (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-0.5 bg-[var(--primary)]"
          data-selected-marker=""
        />
      ) : null}

      <span
        aria-hidden
        className={cn(
          "mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg text-xs font-semibold",
          selected
            ? "bg-[var(--primary-ink)] text-[var(--background)]"
            : "bg-[var(--secondary)] text-[var(--muted-foreground)]",
        )}
      >
        {initials(thread.title)}
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          {/* The dot has a word beside it in the accessible name, so it is never colour alone. */}
          {unread ? (
            <span
              className="size-2 shrink-0 rounded-full bg-[var(--primary-ink)]"
              role="presentation"
            />
          ) : null}
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm",
              unread ? "font-semibold text-foreground" : "font-medium text-foreground",
            )}
          >
            {thread.title}
          </span>
          <MessageTime at={thread.lastActivityAt} className="shrink-0" />
        </span>

        {/*
          The same fix as the name a line above, for the same reason and with the same mechanism.
          `flex-1` is `flex: 1 1 0%`, so the preview's hypothetical main size is zero: the line
          never breaks, and the preview is handed whatever the stage chip and the unread badge —
          both `shrink-0`, and rightly so — leave behind. In a 288px list column that is 80px of a
          203px line, because the chip alone is 87px of it, and a preview shown 80px wide reads
          "Good progr…".

          `basis-36` is 144px, and it is chosen to sit between the two measurements rather than
          picked for roundness: the 1440 column leaves the preview 80px and the 390 list leaves it
          150px. Above the floor nothing moves, so the phone keeps the single line it already had;
          below it the line breaks and the preview takes a row of its own instead of a sliver of
          one. Neither the chip nor the badge gives way at any width, which is the point — moving
          the crush onto the stage label would not be fixing it.

          `gap-y-0.5` rather than the horizontal gap, so a row that does break grows by a line of
          text and not by a line of text plus a gutter.
        */}
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          {thread.stage ? (
            <span className="shrink-0 rounded-full border border-[var(--border)] px-1.5 py-px text-xs font-medium text-[var(--muted-foreground)]">
              {thread.stage}
            </span>
          ) : null}
          <span className="min-w-0 flex-1 basis-36 truncate text-xs text-muted-foreground">
            {threadPreview(thread)}
          </span>
          {unread ? (
            <span className="shrink-0 rounded-full bg-[var(--primary-ink)] px-1.5 py-0.5 text-xs font-semibold tabular-nums text-[var(--background)]">
              <span className="sr-only">Unread messages: </span>
              {thread.unreadCount}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------------------------

export const THREAD_STATUS_TABS: readonly { value: ChatThreadStatus; label: string }[] = [
  { label: "Open", value: "open" },
  { label: "Pending", value: "pending" },
  { label: "Resolved", value: "resolved" },
];

export interface ThreadListFiltersProps {
  readonly status: ChatThreadStatus;
  readonly onStatusChange: (status: ChatThreadStatus) => void;
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  /** Display names. Omit entirely where there is no team to filter by. */
  readonly members?: readonly { readonly value: string; readonly label: string }[];
  readonly member?: string;
  readonly onMemberChange?: (member: string) => void;
  /** Per-status counts, when the caller has them. Rendered on the tab. */
  readonly counts?: Partial<Record<ChatThreadStatus, number>>;
  readonly className?: string;
}

export function ThreadListFilters({
  className,
  counts,
  member = "all",
  members,
  onMemberChange,
  onQueryChange,
  onStatusChange,
  query,
  status,
}: ThreadListFiltersProps) {
  return (
    <div className={cn("space-y-2", className)}>
      <Tabs
        onValueChange={(value) => onStatusChange(value as ChatThreadStatus)}
        value={status}
      >
        <TabsList className="w-full" variant="line">
          {THREAD_STATUS_TABS.map((tab) => (
            <TabsTrigger className="min-h-11 flex-1" key={tab.value} value={tab.value}>
              {tab.label}
              {counts?.[tab.value] === undefined ? null : (
                <span className="ml-1 tabular-nums text-muted-foreground">
                  {counts[tab.value]}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/*
        The two controls wrap rather than crush. `min-w-0 flex-1` on the field let it shrink to
        whatever was left after the picker, which in a 320px column is about fifty pixels of text —
        the placeholder rendered as "Searc". A real minimum is what makes `flex-wrap` mean
        anything: below roughly 350px of row the picker drops to its own line and both are legible,
        above it they sit side by side and share the space.
      */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-44 flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Search conversations"
            className="min-h-11 pl-9 pr-9"
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search conversations"
            type="search"
            value={query}
          />
          {/* The clear control exists only when there is something to clear. */}
          {query === "" ? null : (
            <Button
              aria-label="Clear search"
              className="absolute right-1 top-1/2 -translate-y-1/2"
              onClick={() => onQueryChange("")}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <X aria-hidden className="size-3.5" />
            </Button>
          )}
        </div>

        {/*
          `BrandSelect`, never a native select. It is `main`'s one on-brand replacement for every
          select in the product, and it is the right control here for the reason it was built: past
          eight options it grows a filter box, which is what a team of twenty needs and what an OS
          menu cannot do at 390px. Building a second combobox for this lane would have given the
          surface two keyboard contracts to disagree about.
        */}
        {members && members.length > 0 && onMemberChange ? (
          <BrandSelect
            ariaLabel="Filter by team member"
            className="min-w-40 flex-1"
            onValueChange={onMemberChange}
            options={[
              { label: "Everyone", value: "all" },
              ...members.map((option) => ({ label: option.label, value: option.value })),
            ]}
            value={member}
          />
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Loading and empty
// ---------------------------------------------------------------------------------------------

/** Rows that match the geometry of the real ones: title line, preview line, chip. */
export function ThreadListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-busy aria-label="Loading conversations" className="space-y-1" role="status">
      {Array.from({ length: rows }, (_, index) => (
        <div className="space-y-2 rounded-[10px] px-3 py-3" key={index}>
          <div className="flex items-center gap-2">
            <PaneSkeletonBar className="w-1/3" />
            <PaneSkeletonBar className="ml-auto w-8" />
          </div>
          <PaneSkeletonBar className="w-4/5" />
          <PaneSkeletonBar className="h-2.5 w-16" />
        </div>
      ))}
    </div>
  );
}

export interface ThreadListEmptyProps {
  /**
   * Why it is empty and what the pane is for. A filtered-to-nothing list is not an empty inbox,
   * and only the caller knows which one this is — which is why none of these has a default.
   *
   * "No conversations yet" was the default here and it is exactly what the design brief calls a
   * failure: it names the absence and teaches nothing.
   */
  readonly title: string;
  readonly description: string;
  /** The one action that fills it. */
  readonly action: PaneAction;
  readonly className?: string;
}

export function ThreadListEmpty({ action, className, description, title }: ThreadListEmptyProps) {
  return (
    <PaneState
      action={action}
      className={className}
      description={description}
      icon={Inbox}
      status="empty"
      title={title}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------------------------

export interface ThreadListProps {
  readonly threads: readonly ChatThreadSummary[];
  readonly selectedRef: string | null;
  readonly onSelect: (threadRef: string) => void;
  readonly status?: "loading" | "error" | "ready";
  /**
   * Required, because `status` can be `"error"` and an error with no way out is a wall. A caller
   * that believes it never fails still owes the reader a retry for the time it does.
   */
  readonly onRetry: () => void;
  /** Required for the same reason: a list that can be empty must say what it is for. */
  readonly empty: ThreadListEmptyProps;
  readonly filters?: ReactNode;
  readonly className?: string;
  readonly label?: string;
}

export function ThreadList({
  className,
  empty,
  filters,
  label = "Conversations",
  onRetry,
  onSelect,
  selectedRef,
  status = "ready",
  threads,
}: ThreadListProps) {
  return (
    <div className={cn("flex min-h-0 flex-col gap-3", className)}>
      {filters}
      {status === "loading" ? (
        <ThreadListSkeleton />
      ) : status === "error" ? (
        <PaneState
          action={{ label: "Try again", onAct: onRetry }}
          description="Nothing was lost. The list could not be read just now."
          status="error"
          title="Conversations could not be loaded"
        />
      ) : threads.length === 0 ? (
        <ThreadListEmpty {...empty} />
      ) : (
        <ul aria-label={label} className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {threads.map((thread) => (
            <li key={thread.ref}>
              <ThreadListItem
                onSelect={onSelect}
                selected={thread.ref === selectedRef}
                thread={thread}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
