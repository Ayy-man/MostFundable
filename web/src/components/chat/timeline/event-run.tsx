"use client";

// A run: two or more adjacent low-weight lines behind one disclosure.
//
// The label says what is inside it — the count, the nouns, and the times it spans — because a
// disclosure reading "4 updates" makes the reader open it to find out whether they care. Collapsed
// by default; only *adjacent* rows are ever gathered, so expanding one can never reorder it against
// a band, and nothing sticky is ever in here.

import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { TimelineEventLine } from "./event-line";
import type { TimelineLineEntry } from "./group";

export function TimelineEventRun({
  label,
  lines,
}: {
  readonly label: string;
  readonly lines: readonly TimelineLineEntry[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="grid w-full max-w-[34rem] justify-items-center gap-1.5">
      <button
        aria-expanded={open}
        className={cn(
          "inline-flex min-h-8 items-center gap-2 rounded-full border border-dashed border-[var(--surface-border)] bg-[var(--background)] px-3 text-xs font-semibold text-muted-foreground",
          "transition-colors duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)]",
          "hover:border-[var(--success)] hover:text-[var(--success)]",
          "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          "@max-[480px]:min-h-11",
        )}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {label}
        <ChevronDown
          aria-hidden
          className={cn(
            "size-3 shrink-0 transition-transform duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)]",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <div className="grid w-full justify-items-center gap-1.5">
          {lines.map((entry) => (
            <TimelineEventLine key={entry.row.ref} view={entry.view} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
