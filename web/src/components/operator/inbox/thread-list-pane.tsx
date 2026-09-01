"use client";

// Pane 1: the list, its filters, and the way into the keyboard vocabulary.
//
// Almost all of this is `<ThreadList>` and `<ThreadListFilters>` from the shared foundation. What
// lives here is the pane around them: the heading, the shortcuts control, and the three things a
// list has to say for itself that only this surface knows — an inbox with nothing in it, a filter
// that matched nothing, and a read that failed. Those are three different sentences and the
// foundation deliberately refuses to guess which one applies.
//
// Long lists are handled by the browser rather than by a virtualiser. `content-visibility: auto`
// with an intrinsic size that matches the row band lets the engine skip layout and paint for rows
// outside the viewport, which is most of the benefit of windowing with none of the scroll-anchor
// and focus-restoration bugs a hand-rolled one brings — and no new dependency, which this lane may
// not add anyway.

import { Keyboard } from "lucide-react";

import {
  ThreadList,
  ThreadListFilters,
  type ChatThreadStatus,
  type ChatThreadSummary,
  type ThreadListEmptyProps,
} from "@/components/chat";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The id the `/` shortcut reaches for. `<ThreadListFilters>` labels its own field. */
export const SEARCH_FIELD_LABEL = "Search conversations";

export interface ThreadListPaneProps {
  readonly threads: readonly ChatThreadSummary[];
  readonly selectedRef: string | null;
  readonly onSelect: (threadRef: string) => void;
  readonly status: "loading" | "error" | "ready";
  readonly onRetry: () => void;
  readonly empty: ThreadListEmptyProps;

  readonly statusTab: ChatThreadStatus;
  readonly onStatusTabChange: (status: ChatThreadStatus) => void;
  readonly counts: Partial<Record<ChatThreadStatus, number>>;
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  readonly members?: readonly { readonly value: string; readonly label: string }[];
  readonly member?: string;
  readonly onMemberChange?: (member: string) => void;

  readonly onShowShortcuts: () => void;
  readonly listRef?: React.RefObject<HTMLDivElement | null>;
  readonly className?: string;
}

export function ThreadListPane({
  className,
  counts,
  empty,
  listRef,
  member,
  members,
  onMemberChange,
  onQueryChange,
  onRetry,
  onSelect,
  onShowShortcuts,
  onStatusTabChange,
  query,
  selectedRef,
  status,
  statusTab,
  threads,
}: ThreadListPaneProps) {
  const total = (counts.open ?? 0) + (counts.pending ?? 0) + (counts.resolved ?? 0);
  return (
    <section
      aria-label="Conversations"
      className={cn(
        "flex min-h-0 min-w-0 flex-col border-[var(--border)] bg-card xl:border-r",
        className,
      )}
      ref={listRef}
    >
      <div className="flex min-h-14 shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] px-3 sm:px-4">
        <h2 className="min-w-0 truncate text-sm font-semibold text-foreground">Inbox</h2>
        <Button
          aria-label="Keyboard shortcuts"
          onClick={onShowShortcuts}
          size="icon-lg"
          title="Keyboard shortcuts"
          type="button"
          variant="ghost"
        >
          <Keyboard aria-hidden className="size-4" />
        </Button>
      </div>

      <ThreadList
        className={cn(
          "min-h-0 flex-1 gap-2 px-2 pb-2 pt-2",
          // Rows outside the viewport cost nothing to lay out. The intrinsic size is the row band
          // from the design brief, so the scrollbar stays honest before anything is painted.
          "[&_li]:[contain-intrinsic-size:auto_3.25rem] [&_li]:[content-visibility:auto]",
        )}
        empty={empty}
        filters={
          <div className="px-1">
            <ThreadListFilters
              counts={counts}
              member={member}
              members={members}
              onMemberChange={onMemberChange}
              onQueryChange={onQueryChange}
              onStatusChange={onStatusTabChange}
              query={query}
              status={statusTab}
            />
            <p className="px-1 pt-2 text-[0.68rem] text-muted-foreground tabular-nums">
              {threads.length} shown · {total} total in this inbox
            </p>
          </div>
        }
        onRetry={onRetry}
        onSelect={onSelect}
        selectedRef={selectedRef}
        status={status}
        threads={threads}
      />
    </section>
  );
}
