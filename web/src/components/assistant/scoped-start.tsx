"use client";

import { ArrowUpRight, BarChart3, FileCheck2, Sparkles, UsersRound } from "lucide-react";

import { PaneSkeletonBar } from "@/components/chat/pane-state";
import { cn } from "@/lib/utils";

import type { AssistantGreeting } from "./greeting";
import type { AssistantScopeProfile } from "./scope";

interface ScopedAssistantStartProps {
  readonly profile: AssistantScopeProfile;
  readonly greeting: AssistantGreeting;
  readonly greetingState: "loading" | "unavailable" | "ready";
  readonly onAsk: (question: string) => void;
  readonly busy: boolean;
}

const ACTION_ICONS = [UsersRound, FileCheck2, BarChart3, Sparkles] as const;

export function ScopedAssistantStart({
  busy,
  greeting,
  greetingState,
  onAsk,
  profile,
}: ScopedAssistantStartProps) {
  return (
    <div className="m-auto flex w-full max-w-[42rem] flex-col gap-5 py-5">
      <div className="relative overflow-hidden rounded-2xl bg-[var(--assistant-ground)] px-5 py-5 text-[var(--accent-on-dark)]">
        <div aria-hidden className="absolute -right-8 -top-10 size-32 rounded-full border border-[color-mix(in_srgb,var(--background),transparent_90%)] bg-[color-mix(in_srgb,var(--background),transparent_96%)]" />
        <div aria-hidden className="absolute -bottom-12 right-12 size-24 rounded-full border border-[var(--success)]/25" />
        <span className="mb-4 grid size-10 place-items-center rounded-xl bg-[var(--success)] text-[var(--success-foreground)] shadow-sm">
          <Sparkles aria-hidden className="size-5" />
        </span>
        <h2 className="relative text-xl font-semibold leading-7 tracking-[-0.01em]">
          {greeting.salutation}
        </h2>
        {greetingState === "loading" ? (
          <PaneSkeletonBar className="mt-2 w-56 bg-[color-mix(in_srgb,var(--background),transparent_80%)]" />
        ) : (
          <p className="relative mt-1 max-w-[34rem] text-sm leading-6 text-[color-mix(in_srgb,var(--background),var(--assistant-ground)_30%)]">
            {greetingState === "unavailable" || greeting.detail === null
              ? profile.grounding
              : greeting.detail}
          </p>
        )}
      </div>

      <div>
        <p className="mb-2 text-[0.6875rem] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Start with
        </p>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {profile.suggestions.map((suggestion, index) => {
            const Icon = ACTION_ICONS[index] ?? Sparkles;
            return (
              <li className="min-w-0" key={suggestion.question}>
                <button
                  className={cn(
                    "group flex h-full min-h-[6.75rem] w-full flex-col items-start rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 text-left shadow-[var(--surface-shadow)]",
                    "transition-[border-color,background-color,transform] duration-200 hover:-translate-y-0.5 hover:border-[var(--success)]/45 hover:bg-[var(--accent)]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
                    "disabled:pointer-events-none disabled:opacity-50",
                  )}
                  disabled={busy}
                  onClick={() => onAsk(suggestion.question)}
                  type="button"
                >
                  <span className="mb-3 grid size-8 place-items-center rounded-lg bg-[var(--assistant-ground)] text-[var(--accent-on-dark)]">
                    <Icon aria-hidden className="size-4" />
                  </span>
                  <span className="flex w-full items-end justify-between gap-3">
                    <span className="text-sm font-medium leading-5 text-foreground">
                      {suggestion.question}
                    </span>
                    <ArrowUpRight aria-hidden className="mb-0.5 size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-[var(--success)]" />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
