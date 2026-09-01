"use client";

import { ChevronDown, FileText } from "lucide-react";

import { Task, TaskContent, TaskItem, TaskItemFile, TaskTrigger } from "@/components/ai-elements/task";
import { ThinkingOrb, orbActivity } from "@/components/chat/thinking-orb";
import { useTickingClock } from "@/components/assistant/use-elapsed";
import { cn } from "@/lib/utils";

import type { KbProgressEvent } from "@/lib/kb/progress";

const LABELS = {
  searching: "Searching the knowledge base",
  reading: "Reading retrieved knowledge",
  composing: "Composing the answer",
  reviewing: "Checking the answer",
} as const;

function eventLabel(event: KbProgressEvent): string {
  return event.stage === "reading" && event.titles.length === 1
    ? `Reading ${event.titles[0]}`
    : LABELS[event.stage];
}

export function ReasoningTrace({
  active,
  ground = "navy",
  seconds,
  startedAt,
  steps,
}: {
  readonly active: boolean;
  readonly ground?: "light" | "navy";
  readonly seconds?: number;
  readonly startedAt?: number | null;
  readonly steps: readonly KbProgressEvent[];
}) {
  const now = useTickingClock(active);
  const elapsed = active && startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : seconds ?? 0;
  const current = steps.at(-1);
  const activity = active
    ? orbActivity({ kind: "assistant", stage: current ? eventLabel(current) : null, streamOpen: active })
    : null;

  return (
    <Task
      className={cn(
        ground === "navy" ? "border-white/12 bg-[color-mix(in_srgb,var(--background),transparent_95%)] text-white" : "border-[var(--border)] bg-[var(--surface-raised)] text-foreground",
        active ? "[&_[data-slot=collapsible-content]]:block" : undefined,
      )}
      defaultOpen={active}
      open={active ? true : undefined}
    >
      <TaskTrigger className={cn("group flex min-h-9 items-center gap-2", ground === "navy" ? "text-white/65 hover:text-white" : "text-muted-foreground hover:text-foreground")} title={active ? "Working through sources" : `Thought for ${elapsed}s`}>
        {/* The orb renders `activity.label` itself — orb and words are one component, exactly as
            the other three call sites use it — so while a turn is active this span must stay
            empty or the current stage reads twice in the header ("Composing the answer
            Composing the answer", reported 2026-08-24). It keeps its flex-1 so the chevron
            stays pinned right. */}
        {activity ? <ThinkingOrb activity={activity} ground={ground} size="sm" /> : null}
        <span className="min-w-0 flex-1 truncate text-left text-xs font-medium">
          {active ? (activity ? null : "Working on your answer") : `Thought for ${elapsed}s`}
        </span>
        <ChevronDown aria-hidden className="size-3.5 transition-transform group-data-[panel-open]/collapsible-trigger:rotate-180" />
      </TaskTrigger>
      <TaskContent className={ground === "navy" ? "[&_ol]:border-white/12" : "[&_ol]:border-[var(--border)]"}>
        {steps.map((event, index) => (
          <TaskItem
            className={ground === "navy" ? "text-white/80" : "text-muted-foreground"}
            key={`${event.stage}-${index}`}
            state={active && index === steps.length - 1 ? "running" : "done"}
          >
            <span>
              {LABELS[event.stage]}
              {event.stage === "reading" ? (
                <span className="mt-1.5 flex flex-wrap gap-1.5">
                  {event.titles.map((title) => (
                    <TaskItemFile className={ground === "navy" ? "border-white/12 bg-[color-mix(in_srgb,var(--background),transparent_94%)] text-white/80" : "border-[var(--border)] bg-background text-foreground"} key={title}>
                      <FileText aria-hidden className="size-3" /> {title}
                    </TaskItemFile>
                  ))}
                </span>
              ) : null}
            </span>
          </TaskItem>
        ))}
      </TaskContent>
    </Task>
  );
}
