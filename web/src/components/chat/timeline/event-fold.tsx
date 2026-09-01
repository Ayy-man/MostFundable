"use client";

// A fold: adjacent same-kind bands summarised into one, with the count that matters.
//
// "3 documents filed · Bank statement, Lease agreement, Articles of organization · 2 not yet
// reviewed" is the sentence an operator scanning ten days of uploads actually needs; three identical
// bands are three rows saying the same thing. Only bands of one kind fold together, and only
// adjacent ones.
//
// The band that holds the thread's one filled action is never in here — `groupTimeline` hoists it out
// and renders it under the summary. A primary control inside a collapsed disclosure is a primary
// control nobody presses.

import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { TimelineEventBand, type TimelineActionHandlers } from "./event-band";
import { TIMELINE_GLYPHS } from "./glyphs";
import type { TimelineBandEntry } from "./group";
import type { TimelineGlyph } from "./catalog";
import { TimelineTime } from "./parts";

export function TimelineEventFold({
  at,
  bands,
  body,
  glyph,
  handlers,
  noun,
  title,
}: {
  readonly at: string;
  readonly bands: readonly TimelineBandEntry[];
  readonly body: string;
  readonly glyph: TimelineGlyph;
  readonly handlers: TimelineActionHandlers;
  readonly noun: string;
  readonly title: string;
}) {
  const [open, setOpen] = useState(false);
  const Glyph = TIMELINE_GLYPHS[glyph];
  return (
    <div className="grid w-full max-w-[34rem] gap-1.5">
      <article className="grid w-full gap-2 border-t border-b border-[var(--surface-border)] bg-[var(--background)] px-4 pt-3 pb-3">
        <div className="flex items-center gap-2">
          <Glyph aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="text-xs font-semibold uppercase tracking-[0.11em] text-muted-foreground">
            <span className="sr-only">System event, </span>
            {noun}
          </span>
          <TimelineTime at={at} className="ml-auto" />
        </div>
        <p className="text-[0.9375rem] leading-[1.35] font-semibold text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{body}</p>
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <span aria-hidden className="flex-1" />
          <button
            aria-expanded={open}
            className={cn(
              "inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-transparent px-3 text-[0.8125rem] font-semibold text-[var(--success)]",
              "transition-colors duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)]",
              "hover:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              "@max-[480px]:min-h-11",
            )}
            onClick={() => setOpen((current) => !current)}
            type="button"
          >
            Show each
            <ChevronDown
              aria-hidden
              className={cn(
                "size-3 shrink-0 transition-transform duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)]",
                open && "rotate-180",
              )}
            />
          </button>
        </div>
      </article>
      {open ? (
        <div className="grid gap-2">
          {bands.map((entry) => (
            <TimelineEventBand
              handlers={handlers}
              key={entry.row.ref}
              row={entry.row}
              view={entry.view}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
