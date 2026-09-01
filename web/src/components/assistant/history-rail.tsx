"use client";

// The history rail: new chat, search, then every conversation grouped by day.
//
// Persisted per profile because the server persists it — these are `assistant_conversations` rows
// scoped by RLS to the person, not a `localStorage` list that would vanish on a different machine
// and would be a second, quieter copy of somebody's questions besides.
//
// Loading, error and ready are rendered by `<PaneState>` rather than by a bare `null`, which is
// contract §4's rule and the reason the pane cannot come up blank. Two of the five are answered by
// the rail not existing: with `FEATURE_KB` off there is no rail because there is nothing for it to
// be a rail of, and with no conversation stored the workspace does not give it a column either —
// an empty rail was a quarter of the width at 1440 holding one small card, and the empty state it
// held is better said by the centre, which is where the reader is looking and where the control
// that fills the history actually is.
//
// A deleted conversation is gone. The route's `DELETE` is a hard delete and takes the turns with
// it, so the row leaves this list only when the server has said it did — never optimistically,
// because a person who watches their own history reappear stops trusting the control.

import { Plus, Search, Trash2 } from "lucide-react";

import { PaneSkeletonRows, PaneState } from "@/components/chat/pane-state";
import { relativeTime } from "@/components/chat/time";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { groupConversations, searchConversations } from "./history";

import type { AssistantConversation } from "@/lib/assistant/types";

export interface HistoryRailProps {
  /** `null` while the first read is still out. */
  readonly failed: boolean;
  readonly loading: boolean;
  readonly conversations: readonly AssistantConversation[];
  readonly activeId: string | null;
  readonly search: string;
  readonly now: Date;
  /** The conversation currently being deleted, so its row can say so. */
  readonly deletingId: string | null;
  readonly onSearch: (value: string) => void;
  readonly onSelect: (conversationId: string) => void;
  readonly onDelete: (conversationId: string) => void;
  readonly onNew: () => void;
  readonly onRetry: () => void;
}

function Row({
  conversation,
  active,
  deleting,
  now,
  onDelete,
  onSelect,
}: {
  readonly conversation: AssistantConversation;
  readonly active: boolean;
  readonly deleting: boolean;
  readonly now: Date;
  readonly onDelete: (conversationId: string) => void;
  readonly onSelect: (conversationId: string) => void;
}) {
  return (
    <div className="group relative">
      <button
        aria-current={active ? "true" : undefined}
        className={cn(
          "flex w-full min-h-11 flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 pr-9 text-left transition-colors duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
          active
            ? "bg-[var(--accent)] text-foreground"
            : "text-[var(--secondary-foreground)] hover:bg-[var(--muted)]",
        )}
        onClick={() => onSelect(conversation.id)}
        type="button"
      >
        <span
          className={cn(
            "line-clamp-2 w-full text-[0.8125rem] leading-5",
            active ? "font-medium" : "font-normal",
          )}
        >
          {conversation.title}
        </span>
        <span className="text-[0.6875rem] tabular-nums text-muted-foreground">
          {deleting ? "Removing…" : relativeTime(conversation.lastActivityAt, now)}
        </span>
      </button>
      <Button
        aria-label={`Delete the conversation titled ${conversation.title}`}
        className={cn(
          "absolute right-1 top-1.5 opacity-0 transition-opacity duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)]",
          "group-hover:opacity-100 group-focus-within:opacity-100",
        )}
        disabled={deleting}
        onClick={() => onDelete(conversation.id)}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <Trash2 aria-hidden className="size-3.5" />
      </Button>
    </div>
  );
}

export function HistoryRail({
  activeId,
  conversations,
  deletingId,
  failed,
  loading,
  now,
  onDelete,
  onNew,
  onRetry,
  onSearch,
  onSelect,
  search,
}: HistoryRailProps) {
  const matches = searchConversations(conversations, search);
  const groups = groupConversations(matches, now);
  const searching = search.trim().length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Outline rather than filled. Electric Green is the one dominant action per view
          (DESIGN.md) and in this view that is the composer's send; a full-width green block here
          is the "green becomes wallpaper" the same document bans. */}
      {conversations.length > 0 ? (
        <Button className="min-h-11 w-full justify-start" onClick={onNew} type="button" variant="outline">
          <Plus aria-hidden className="size-4" />
          New chat
        </Button>
      ) : null}

      {/* The search field is present whenever there is something to search. Hiding it while the
          history loads makes the rail jump; showing it over an empty history offers a control that
          cannot do anything. */}
      {conversations.length > 0 ? (
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            aria-label="Search your conversations"
            className={cn(
              "min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] pl-8 pr-2.5",
              "text-[0.8125rem] outline-none transition-colors duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)] placeholder:text-muted-foreground",
              "focus-visible:border-[var(--primary-ink)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
            )}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search"
            type="search"
            value={search}
          />
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        {loading ? (
          <PaneState label="Loading your conversations" skeleton={<PaneSkeletonRows rows={4} />} status="loading" />
        ) : failed ? (
          <PaneState
            action={{ label: "Try again", onAct: onRetry }}
            description="Your earlier questions are still stored. This read did not complete."
            status="error"
            title="Your history could not be loaded"
          />
        ) : conversations.length === 0 ? (
          /* Nothing, deliberately. The rail is not rendered at all until it has rows or a
             conversation is open (the workspace decides that), so the only way to be here is the
             seconds between somebody's first question and the conversation it creates. An empty
             card in that window would be a pane telling a reader their history is empty while the
             thing that fills it is on screen and running. The teaching this used to do is in the
             centre, where the reader already is. */
          null
        ) : matches.length === 0 ? (
          <div className="px-1 py-6 text-center" role="status">
            <p className="text-[0.8125rem] font-medium text-foreground">No conversation matches that</p>
            <Button className="mt-2 min-h-11" onClick={() => onSearch("")} size="sm" type="button" variant="outline">
              Clear the search
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <section key={group.key}>
                <h4 className="px-2.5 pb-1 text-[0.6875rem] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  {group.label}
                </h4>
                <div className="space-y-0.5">
                  {group.conversations.map((conversation) => (
                    <Row
                      active={conversation.id === activeId}
                      conversation={conversation}
                      deleting={conversation.id === deletingId}
                      key={conversation.id}
                      now={now}
                      onDelete={onDelete}
                      onSelect={onSelect}
                    />
                  ))}
                </div>
              </section>
            ))}
            {searching ? (
              <p className="px-2.5 pb-1 text-[0.6875rem] tabular-nums text-muted-foreground">
                {matches.length} of {conversations.length} shown
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
