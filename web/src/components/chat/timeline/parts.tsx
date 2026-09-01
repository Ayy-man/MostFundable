"use client";

// The pieces every timeline row shares: the time, the title, the status chip and an action.
//
// **The time is absolute, not relative.** A message says "3h" because a conversation is read
// forwards and the gap between two replies is the useful thing. An event says "9:01 AM" because the
// row exists to date something, and "3h" beside a readiness figure is exactly the ambiguity the
// dated-observation rule was written to remove. The date is in the `<time datetime>` value and,
// spelled out, in an sr-only span — a screen reader hears "Aug 22, 9:01 AM" and does not have to
// infer the day from a divider several rows up. No `title`: the mockup carried one and it made every
// timestamp announce itself twice.
//
// **A title carries emphasis as data.** The catalog returns segments, so a stage name can be bold
// without any string in this module reaching `dangerouslySetInnerHTML`.
//
// **A status chip always has a word.** DESIGN.md's marker grammar is a shape *and* a label:
// solid for a dated confirmation, an outlined accent for something recorded but not confirmed,
// dashed while work is genuinely in flight, dashed neutral for paused with its last value kept. The
// dot alone would make colour the only signal, and the spin is the one piece of motion here that
// reduced-motion removes outright.

import { Lock } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import type { TimelineMarker, TimelineStatus, TimelineTitle } from "./catalog";
import { timelineDate, timelineTime } from "./format";

/** The instant a row sits at: the clock time, with the date spelled out for assistive technology. */
export function TimelineTime({ at, className }: { at: string; className?: string }) {
  return (
    <time
      className={cn("shrink-0 text-xs tabular-nums text-muted-foreground", className)}
      dateTime={at}
    >
      <span className="sr-only">{timelineDate(at)}, </span>
      {timelineTime(at)}
    </time>
  );
}

export function TimelineTitleText({ title }: { title: TimelineTitle }) {
  return (
    <>
      {title.map((part, index) =>
        typeof part === "string" ? (
          part
        ) : (
          <b className="font-semibold text-foreground" key={`${part.strong}-${index}`}>
            {part.strong}
          </b>
        ),
      )}
    </>
  );
}

const MARKER_STYLE: Readonly<Record<TimelineMarker, string>> = {
  paused: "border-dashed",
  reported: "border-[var(--success)] text-[var(--success)]",
  todo: "",
  verified: "border-[var(--success)] bg-[var(--accent)] text-[var(--success)]",
  verifying: "border-dashed border-[var(--success)] text-[var(--success)]",
};

const DOT_STYLE: Readonly<Record<TimelineMarker, string>> = {
  paused: "",
  reported: "",
  todo: "",
  verified: "bg-[var(--success)]",
  verifying: "border-dashed animate-spin motion-reduce:animate-none",
};

/** The verification marker. Inside a narrow frame it takes its own line, as the copy does. */
export function TimelineStatusChip({ status }: { status: TimelineStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-[var(--surface-border)] bg-card px-2 py-0.5 text-xs font-medium text-muted-foreground",
        "@max-[480px]:basis-full",
        MARKER_STYLE[status.marker],
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-2 shrink-0 rounded-full border-[1.5px] border-current",
          DOT_STYLE[status.marker],
        )}
      />
      {status.label}
    </span>
  );
}

/** "Only your team sees this." The lock is beside the words, never instead of them. */
export function TimelineTeamOnlyNote() {
  return (
    <p className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <Lock aria-hidden className="size-3 shrink-0" />
      Only your team sees this.
    </p>
  );
}

/**
 * A row's control.
 *
 * `filled` is granted to at most one band in the whole thread, which is what keeps Electric Green an
 * accent rather than a column of fields; everything else is an outline or a quiet link. Buttons size
 * to their label and nothing stretches. 44px inside a frame narrower than 480px, decided by the
 * frame's own width rather than the window's, because the operator's Inbox is a narrow column inside
 * a wide page.
 */
export function TimelineActionButton({
  children,
  filled = false,
  onClick,
  pressed,
  quiet = false,
}: {
  readonly children: ReactNode;
  readonly filled?: boolean;
  readonly onClick: () => void;
  readonly pressed?: boolean;
  readonly quiet?: boolean;
}) {
  return (
    <button
      aria-pressed={pressed}
      className={cn(
        "inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[var(--surface-border)] bg-card px-3 text-[0.8125rem] font-semibold text-foreground",
        "transition-colors duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)]",
        "hover:border-[var(--success)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        "@max-[480px]:min-h-11",
        quiet && "border-transparent bg-transparent text-[var(--success)] hover:bg-[var(--accent)]",
        filled && "border-transparent bg-[var(--primary)] text-[var(--primary-foreground)]",
        pressed && "border-[var(--success)] bg-[var(--accent)] text-[var(--success)]",
      )}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
