"use client";

// A band: a recessed full-width row for something that carries state, facts, or work.
//
// **A band, not a card.** Top and bottom hairlines, the canvas colour, no radius and no shadow. The
// frame around the thread is already the card, and DESIGN.md forbids nested cards — a bordered,
// lifted panel inside a bordered, lifted pane is the treatment that makes a thread look like a
// dashboard. Recessed is also what says "this is the surface talking", which is the whole job.
//
// **No author, no side, no bubble.** Opened by its noun in tracked caps, with the instant on the
// right. A screen reader hears "System event, Analysis" before the title.
//
// **At most two actions, and at most one of them filled in the whole thread.** `view.primary` is
// decided by `primaryTarget` over the rows the reader can actually see, so filtering can never leave
// the one green control hidden inside a band that is not on screen. Everything else is an outline or
// a quiet link.
//
// **Every action does something.** A handler the host has not supplied means the action is not
// rendered at all, rather than rendered as a control that fails — a Send that cannot send is the
// exact shape the contract bans, and the same reasoning applies to a link with nowhere to go.

import { cn } from "@/lib/utils";

import type { TimelineAction, TimelineRow, TimelineTarget } from "./catalog";
import { TIMELINE_GLYPHS } from "./glyphs";
import {
  TimelineActionButton,
  TimelineStatusChip,
  TimelineTeamOnlyNote,
  TimelineTime,
  TimelineTitleText,
} from "./parts";
import type { ResolvedBand } from "./resolve";

/**
 * What a host can honour.
 *
 * `onOpen` is required: a band with no way to open anything would render deep links that do nothing.
 * The other three are the operator's, and the two POSTing handlers are the approved change orders —
 * absent until the routes exist, and their actions simply do not render while that is true.
 */
export interface TimelineActionHandlers {
  readonly onOpen: (target: TimelineTarget, row: TimelineRow) => void;
  /** Opens the in-thread request composer. Operator only. */
  readonly onRequestDocument?: () => void;
  /**
   * Records a review receipt against one document. Operator only.
   *
   * Takes the upload id the catalog put on the action, not the row: the host does not narrow the
   * event union to find out which field is the document.
   */
  readonly onReview?: (uploadId: string) => void;
  /** Fills the composer with a reminder for the operator to read and send themselves. */
  readonly onDraftReminder?: (body: string) => void;
}

function ActionControl({
  action,
  filled,
  handlers,
  row,
}: {
  readonly action: TimelineAction;
  readonly filled: boolean;
  readonly handlers: TimelineActionHandlers;
  readonly row: TimelineRow;
}) {
  if (action.intent === "open") {
    return (
      <TimelineActionButton
        filled={filled && action.style === "primary"}
        onClick={() => handlers.onOpen(action.target, row)}
        quiet={action.style === "quiet"}
      >
        {action.label}
      </TimelineActionButton>
    );
  }
  if (action.intent === "request-document") {
    if (!handlers.onRequestDocument) return null;
    return (
      <TimelineActionButton filled={filled} onClick={handlers.onRequestDocument}>
        {action.label}
      </TimelineActionButton>
    );
  }
  if (action.intent === "draft-reminder") {
    if (!handlers.onDraftReminder) return null;
    const { body } = action;
    return (
      <TimelineActionButton onClick={() => handlers.onDraftReminder?.(body)} quiet>
        {action.label}
      </TimelineActionButton>
    );
  }
  if (!handlers.onReview) return null;
  // Reviewed is a state, not a second control: the button reports it and stops being fillable.
  const { uploadId } = action;
  return (
    <TimelineActionButton
      filled={filled && !action.done}
      onClick={() => handlers.onReview?.(uploadId)}
      pressed={action.done}
    >
      {action.done ? "Reviewed" : action.label}
    </TimelineActionButton>
  );
}

export interface TimelineEventBandProps {
  readonly row: TimelineRow;
  readonly view: ResolvedBand;
  readonly handlers: TimelineActionHandlers;
  /** The row's state changed since this reader last saw it: the hairline settles once. */
  readonly settled?: boolean;
  readonly className?: string;
}

export function TimelineEventBand({
  className,
  handlers,
  row,
  settled = false,
  view,
}: TimelineEventBandProps) {
  const Glyph = TIMELINE_GLYPHS[view.glyph];
  // Decided before rendering rather than by letting a control return null, so the footer knows
  // whether it has anything in it and an empty action row never draws a rule of its own.
  const renderable = view.actions.filter((action) =>
    action.intent === "open"
      ? true
      : action.intent === "request-document"
        ? handlers.onRequestDocument !== undefined
        : action.intent === "draft-reminder"
          ? handlers.onDraftReminder !== undefined
          : handlers.onReview !== undefined,
  );
  const controls = renderable.map((action, index) => (
    <ActionControl
      action={action}
      filled={view.primary}
      handlers={handlers}
      key={`${action.intent}-${action.label}-${index}`}
      row={row}
    />
  ));

  return (
    <article
      className={cn(
        "grid w-full max-w-[34rem] gap-2 border-t border-b border-[var(--surface-border)] bg-[var(--background)] px-4 pt-3 pb-3",
        view.operatorOnly && "bg-[var(--secondary)]",
        className,
      )}
      data-timeline-settle={settled ? "" : undefined}
    >
      <div className="flex items-center gap-2">
        <Glyph aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-[0.11em] text-muted-foreground">
          <span className="sr-only">System event, </span>
          {view.noun}
        </span>
        <TimelineTime at={view.at} className="ml-auto" />
      </div>

      <p className="text-[0.9375rem] leading-[1.35] font-semibold text-foreground">
        <TimelineTitleText title={view.title} />
      </p>

      {view.body ? <p className="text-sm text-muted-foreground">{view.body}</p> : null}

      {view.facts.length > 0 ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[0.8125rem]">
          {view.facts.map((fact) => (
            <span className="text-muted-foreground" key={fact.label}>
              {fact.label} <b className="font-semibold text-foreground">{fact.value}</b>
            </span>
          ))}
        </div>
      ) : null}

      {view.operatorOnly ? <TimelineTeamOnlyNote /> : null}

      {view.status !== null || controls.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {view.status === null ? null : <TimelineStatusChip status={view.status} />}
          <span aria-hidden className="flex-1" />
          {controls}
        </div>
      ) : null}
    </article>
  );
}
