"use client";

// A line: one pill for something that needs no action.
//
// A pill on the canvas colour, centred, with no author and no side. That is the whole point of the
// treatment — given a bubble and an avatar, "Marked resolved" reads as an announcement somebody
// made, which is untrue and, for a product whose differentiator is that a person reviews every
// reply, corrosive. So: `role="note"`, and the screen reader hears "System event, Conversation:"
// before the sentence, because the kind must not be carried by the glyph alone.
//
// Operator-only lines sit on the utility rail with a "Team only ·" prefix. Not amber: DESIGN.md
// spends amber on an internal note and a held draft, and a row the client cannot see is neither.

import { cn } from "@/lib/utils";

import { TimelineTime, TimelineTitleText } from "./parts";
import type { ResolvedLine } from "./resolve";
import { TIMELINE_GLYPHS } from "./glyphs";

export function TimelineEventLine({ view }: { readonly view: ResolvedLine }) {
  const Glyph = TIMELINE_GLYPHS[view.glyph];
  return (
    <div className="grid justify-items-center gap-1.5">
      <div
        className={cn(
          "inline-flex max-w-[min(100%,30rem)] min-h-7 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--background)] px-3 py-1 text-xs text-muted-foreground",
          view.operatorOnly && "bg-[var(--secondary)]",
        )}
        role="note"
      >
        <Glyph aria-hidden className="size-3.5 shrink-0" />
        <span className="sr-only">System event, {view.noun}: </span>
        <span className="min-w-0">
          {view.operatorOnly ? "Team only · " : null}
          <TimelineTitleText title={view.title} />
        </span>
        <TimelineTime at={view.at} />
      </div>
    </div>
  );
}
