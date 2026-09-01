"use client";

// AI Elements `task`, restyled — the disclosure a stage stream renders into.
//
// This is what stands in for the registry's `reasoning` component, which was skipped: `reasoning`
// depends on `@radix-ui/react-use-controllable-state` in a repository that is on Base UI, pulls
// `streamdown`, and exists to stream a model's thinking tokens onto the screen. Contract R1 rules
// that out — the supervisor reviews an answer before any of it is shown, and streaming would put
// unreviewed text in front of a person and then retract it.
//
// What is truthful, and what this renders, is the stage stream: `retrieving` → `drafting` →
// `reviewing`, each one a thing the server actually reported doing. `<TaskItem>` therefore carries
// an explicit state rather than inferring one from position in the list, because "the third one is
// probably running" is how a UI ends up claiming a step that never happened.
//
// The indent guide is a neutral hairline, not a coloured stripe. DESIGN.md bans coloured
// side-stripes and it is right to: they are decoration pretending to be meaning. A 1px rule that
// connects a parent to its children is structure, and it reads as structure.

import { Check, ChevronDown, Circle, TriangleAlert } from "lucide-react";
import type { ComponentProps } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export type TaskProps = ComponentProps<typeof Collapsible>;

export const Task = ({ defaultOpen = true, className, ...props }: TaskProps) => (
  <Collapsible
    className={cn(
      "rounded-[10px] border border-[var(--surface-border)] bg-card px-3 py-2",
      className,
    )}
    defaultOpen={defaultOpen}
    {...props}
  />
);

export type TaskTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  title: string;
};

export const TaskTrigger = ({ children, className, title, ...props }: TaskTriggerProps) => (
  <CollapsibleTrigger
    className={cn("w-full text-muted-foreground hover:text-foreground", className)}
    {...props}
  >
    {children ?? (
      <>
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{title}</span>
        <ChevronDown
          aria-hidden
          className="size-3.5 shrink-0 transition-transform duration-[var(--acc-expand)] ease-[var(--acc-ease)] group-data-[panel-open]/collapsible-trigger:rotate-180"
        />
      </>
    )}
  </CollapsibleTrigger>
);

export type TaskContentProps = ComponentProps<typeof CollapsibleContent>;

export const TaskContent = ({ children, className, ...props }: TaskContentProps) => (
  <CollapsibleContent className={className} {...props}>
    <ol className="mt-2 space-y-2 border-l border-[var(--border)] pl-4">{children}</ol>
  </CollapsibleContent>
);

/** What a stage is actually doing, as reported. Never inferred from its position in the list. */
export type TaskItemState = "pending" | "running" | "done" | "failed";

const STATE_NOUN: Readonly<Record<TaskItemState, string>> = {
  done: "Done",
  failed: "Failed",
  pending: "Waiting",
  running: "Running",
};

export type TaskItemProps = ComponentProps<"li"> & {
  state?: TaskItemState;
};

export const TaskItem = ({ children, className, state = "pending", ...props }: TaskItemProps) => (
  <li
    className={cn(
      "flex items-start gap-2 text-sm leading-6",
      state === "pending" ? "text-muted-foreground" : "text-foreground",
      className,
    )}
    {...props}
  >
    <span className="mt-1 grid size-4 shrink-0 place-items-center" data-state={state}>
      {state === "done" ? (
        <Check aria-hidden className="size-3.5 text-[var(--success)]" />
      ) : state === "failed" ? (
        <TriangleAlert aria-hidden className="size-3.5 text-destructive" />
      ) : state === "running" ? (
        <Circle
          aria-hidden
          className="size-2.5 fill-[var(--primary-ink)] text-[var(--primary-ink)]"
        />
      ) : (
        <Circle aria-hidden className="size-2.5 text-muted-foreground" />
      )}
    </span>
    {/* The state has a text channel as well as a glyph, so colour is never the only signal. */}
    <span className="sr-only">{STATE_NOUN[state]}:</span>
    <span className="min-w-0">{children}</span>
  </li>
);

export type TaskItemFileProps = ComponentProps<"span">;

export const TaskItemFile = ({ children, className, ...props }: TaskItemFileProps) => (
  <span
    className={cn(
      "inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-muted px-1.5 py-0.5 text-xs text-foreground",
      className,
    )}
    {...props}
  >
    {children}
  </span>
);
