"use client";

// The empty centre: a greeting, the input under it, and the questions this pane can answer.
//
// This is the view most people see most often, so it does the teaching the design brief asks an
// empty state to do — it says what this pane answers and gives one-tap ways to find out, rather
// than an icon and the words "No conversations yet".
//
// The greeting's second sentence is durable or absent. While the book read is out it is a skeleton
// bar of the same geometry, and if the read failed it says so in one quiet line instead of
// inventing a number. That is the same rule as the suggestions: nothing on this screen names a
// figure that no read produced.
//
// The suggestions are one list and not two systems. The first build put five short pills above
// three cards of two different sizes, which is a pill cluster and an unequal card grid doing the
// same job — a reader had to work out whether the difference between a pill and a card meant
// anything, and it did not. DESIGN.md bans the pill cluster and the identical card grid in one
// sentence, so the way out is neither: rows of one kind, separated by a hairline, each printing the
// whole question it asks. The text on the control is the text that gets sent, which also ends the
// small dishonesty of a three-word label standing in for a fifteen-word question.

import { ArrowUpRight } from "lucide-react";

import { PaneSkeletonBar } from "@/components/chat/pane-state";
import { cn } from "@/lib/utils";

import type { AssistantGreeting } from "./greeting";
import type { AssistantScopeProfile } from "./scope";
import type { ReactNode } from "react";

export interface AssistantStartProps {
  readonly profile: AssistantScopeProfile;
  readonly greeting: AssistantGreeting;
  /** Whether the durable read behind the greeting's second sentence is still out, or failed. */
  readonly greetingState: "loading" | "unavailable" | "ready";
  readonly onAsk: (question: string) => void;
  readonly busy: boolean;
  /** The composer, mounted by the workspace so one component owns the send. */
  readonly composer: ReactNode;
  readonly compact?: boolean;
}

export function AssistantStart({
  busy,
  compact = false,
  composer,
  greeting,
  greetingState,
  onAsk,
  profile,
}: AssistantStartProps) {
  return (
    // The bottom padding is the same strip the pinned footer reserves: the console's support
    // launcher is fixed to the bottom-right of the viewport, and at 390px the last suggestion sat
    // under it — measured, not assumed. Nothing here can move the launcher, so this pane keeps its
    // own controls out from under it.
    <div className={cn("m-auto flex w-full max-w-[44rem] flex-col gap-6 px-1", compact ? "pb-6 pt-6 sm:pt-8" : "pb-24 pt-6 sm:pb-24 sm:pt-10")}>
      <div className="space-y-2">
        <h2 className="text-[1.5rem] font-semibold leading-8 tracking-[-0.01em] text-foreground sm:text-[1.75rem]">
          {greeting.salutation}
        </h2>
        {greetingState === "loading" ? (
          <PaneSkeletonBar className="w-56" />
        ) : greeting.detail === null ? (
          <p className="text-sm leading-6 text-muted-foreground">
            {greetingState === "unavailable"
              ? "Today's summary could not be read just now."
              : profile.grounding}
          </p>
        ) : (
          <p className="text-sm leading-6 text-[var(--secondary-foreground)]">{greeting.detail}</p>
        )}
      </div>

      {composer}

      <div className="space-y-1">
        <p className="text-[0.6875rem] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Start with
        </p>
        <ul className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
          {profile.suggestions.map((suggestion) => (
            <li key={suggestion.question}>
              <button
                className={cn(
                  "group flex w-full min-h-11 items-start justify-between gap-3 py-3 pl-1 pr-2 text-left",
                  "transition-colors duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)] hover:bg-[var(--accent)]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
                  "disabled:pointer-events-none disabled:opacity-50",
                )}
                disabled={busy}
                onClick={() => onAsk(suggestion.question)}
                type="button"
              >
                <span className="text-[0.875rem] font-medium leading-6 text-foreground">
                  {suggestion.question}
                </span>
                <ArrowUpRight
                  aria-hidden
                  className="mt-1 size-3.5 shrink-0 text-muted-foreground transition-colors duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)] group-hover:text-[var(--primary-ink)]"
                />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
