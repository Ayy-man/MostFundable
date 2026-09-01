"use client";

// The thread: groups, bubbles, day dividers, delivery state.
//
// Four decisions here are product decisions rather than layout ones, and each is the reason the
// obvious alternative was not taken.
//
// **Only one side gets a bubble.** The person reading is on the right, on a filled surface; the
// other party is on the left, flat, under their name. Bubbles on both sides is the default
// everywhere and it is wrong for this product: contract R3 turns on a reader being able to tell a
// human reply from a machine's at a glance, and symmetric bubbles are precisely the treatment that
// makes them look alike. The assistant, when it appears at all, appears in its own navy panel.
//
// **A read tick is only ever shown from a watermark.** `delivery` comes from the caller and the
// caller only says `read` when contract §3.1's `lastReadAt` actually covers the message. A tick
// that says "read" and means "sent" is a claim about another person's attention, and §4 names it
// as a review failure by itself.
//
// **An internal note is a different object, not a coloured message.** Warning tokens, a stated
// label, and a rule down the side — and it renders only where the caller passes it, because RLS
// is what keeps it away from a consumer, not this component.
//
// **Grouping is by author and by time, not by author alone.** Two messages four hours apart from
// the same person are two moments; collapsing them under one timestamp loses the gap, which in a
// support thread is usually the most informative thing on the screen.

import { AlertCircle, Check, CheckCheck, LoaderCircle, Lock } from "lucide-react";
import type { ReactNode } from "react";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { MessageAttachment, MessageAttachments } from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { PaneState, type PaneFallback } from "./pane-state";
import { absoluteTime, dayLabel, relativeTime } from "./time";
import { groupThreadItems } from "./grouping";
import { TimelineEventBand, type TimelineActionHandlers } from "./timeline/event-band";
import { TimelineEventFold } from "./timeline/event-fold";
import { TimelineEventLine } from "./timeline/event-line";
import { TimelineEventRun } from "./timeline/event-run";
import { TimelineNewSinceDivider, TimelineReadFailedLine } from "./timeline/dividers";
import { groupTimeline, type TimelineGroupOptions } from "./timeline/group";
import type { ChatEvent, ChatMessage, ChatThreadItem } from "./types";

// ---------------------------------------------------------------------------------------------
// Small parts
// ---------------------------------------------------------------------------------------------

function initialsFor(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function DayDivider({ at }: { at: string }) {
  return (
    <div aria-hidden className="flex items-center gap-3 py-1">
      <span className="h-px flex-1 bg-[var(--border)]" />
      <span className="text-xs font-semibold uppercase tracking-[0.11em] text-muted-foreground">
        {dayLabel(at)}
      </span>
      <span className="h-px flex-1 bg-[var(--border)]" />
    </div>
  );
}

/**
 * The relative time, with the absolute local and UTC values in `title`.
 *
 * `title` rather than a tooltip, and that is a real tradeoff worth stating: a Base UI tooltip
 * would be focus-reachable, but it would also put a tab stop on every timestamp in a long thread,
 * which makes keyboard navigation through the conversation worse than the thing it fixes. The
 * `<time datetime>` value carries the full instant to assistive technology regardless.
 */
export function MessageTime({ at, className }: { at: string; className?: string }) {
  return (
    <time
      className={cn("shrink-0 text-xs tabular-nums text-muted-foreground", className)}
      dateTime={at}
      title={absoluteTime(at)}
    >
      {relativeTime(at)}
    </time>
  );
}

const DELIVERY_LABEL: Readonly<Record<ChatMessage["delivery"], string>> = {
  delivered: "Delivered",
  failed: "Not sent",
  read: "Read",
  sending: "Sending",
  sent: "Sent",
};

function DeliveryMark({ state }: { state: ChatMessage["delivery"] }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      {state === "sending" ? (
        <LoaderCircle aria-hidden className="size-3 animate-spin motion-reduce:animate-none" />
      ) : state === "failed" ? (
        <AlertCircle aria-hidden className="size-3 text-destructive" />
      ) : state === "sent" ? (
        <Check aria-hidden className="size-3" />
      ) : (
        <CheckCheck
          aria-hidden
          className={cn("size-3", state === "read" && "text-[var(--success)]")}
        />
      )}
      {/*
        The state always has a word, never only a glyph and a colour. `read` gets the accent and
        a heavier weight together for the same reason: the word is what carries the meaning to a
        screen reader and to anyone who cannot separate the two greens, and the weight is what
        separates it from `delivered` at a glance without asking colour to do the work alone.
      */}
      <span
        className={cn(
          state === "failed" && "text-destructive",
          state === "read" && "font-medium text-[var(--success)]",
        )}
      >
        {DELIVERY_LABEL[state]}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Bubble
// ---------------------------------------------------------------------------------------------

export interface MessageBubbleProps {
  readonly message: ChatMessage;
  /** True when the signed-in person wrote it. Decides the side and the surface. */
  readonly own: boolean;
  /** False for the second and later messages in a group: no avatar, no name, no timestamp. */
  readonly leading?: boolean;
  readonly className?: string;
}

export function MessageBubble({ className, leading = true, message, own }: MessageBubbleProps) {
  const note = message.visibility === "internal";
  const failed = message.delivery === "failed";
  const initials = message.author.initials ?? initialsFor(message.author.name);

  return (
    <div
      className={cn("group/message flex w-full gap-3", own ? "justify-end" : "justify-start", className)}
      data-own={own || undefined}
    >
      {own ? null : leading ? (
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--secondary)] text-xs font-semibold text-[var(--muted-foreground)]">
          {initials}
        </span>
      ) : (
        // The gutter stays, so a grouped message lines up under the one above it.
        <span aria-hidden className="size-8 shrink-0" />
      )}

      <div className={cn("flex min-w-0 flex-col gap-1.5", own ? "items-end" : "items-start")}>
        {leading ? (
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-foreground">{message.author.name}</span>
            {message.author.roleLabel ? (
              <span className="rounded-full border border-[var(--border)] px-1.5 py-0.5 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                {message.author.roleLabel}
              </span>
            ) : null}
            <MessageTime at={message.sentAt} />
          </p>
        ) : null}

        <div
          className={cn(
            "w-fit min-w-0 max-w-[min(100%,34rem)] rounded-[10px] px-4 py-3 text-[0.9375rem] leading-[1.5] break-words transition-colors duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)]",
            note
              ? // An internal note: warning ink on its own tint, with a rule that says it is a
                // different kind of thing from everything around it.
                "border border-[var(--warning-border)] bg-[color-mix(in_srgb,var(--warning),transparent_88%)] text-[var(--warning-ink)]"
              : own
                ? "border border-[var(--surface-border)] bg-[var(--surface-raised)] text-foreground"
                : "border border-transparent bg-card text-foreground shadow-[var(--surface-shadow)]",
            failed && "border-[color-mix(in_srgb,var(--destructive),transparent_55%)]",
          )}
        >
          {note ? (
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.1em]">
              <Lock aria-hidden className="size-3" />
              Internal note · not visible to the client
            </p>
          ) : null}
          <p className="whitespace-pre-wrap">{message.body}</p>
          {message.origin === "ai_assisted" ? (
            <p className="mt-2 inline-flex rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              Written with a suggestion, sent by a person
            </p>
          ) : null}
        </div>

        {message.attachments && message.attachments.length > 0 ? (
          <MessageAttachments className={own ? "justify-end" : undefined}>
            {message.attachments.map((attachment) => (
              <MessageAttachment
                data={{
                  filename: attachment.filename,
                  mediaType: attachment.mediaType,
                  type: "file",
                  url: attachment.url,
                }}
                key={attachment.ref}
              />
            ))}
          </MessageAttachments>
        ) : null}

        {own ? <DeliveryMark state={message.delivery} /> : null}

        {/* The failure is a real chip with a real retry, not a toast that has already gone. */}
        {failed && message.failure ? (
          <div
            className="flex flex-wrap items-center gap-2 rounded-lg border border-[color-mix(in_srgb,var(--destructive),transparent_55%)] bg-[color-mix(in_srgb,var(--destructive),transparent_94%)] px-3 py-2"
            role="alert"
          >
            <span className="text-xs text-destructive">{message.failure.reason}</span>
            <Button
              className="min-h-11"
              onClick={message.failure.onRetry}
              size="lg"
              type="button"
              variant="outline"
            >
              Try again
            </Button>
            {message.failure.onDiscard ? (
              <Button
                className="min-h-11"
                onClick={message.failure.onDiscard}
                size="lg"
                type="button"
                variant="ghost"
              >
                Discard
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Group
// ---------------------------------------------------------------------------------------------

export interface MessageGroupProps {
  readonly messages: readonly ChatMessage[];
  readonly own: boolean;
  readonly className?: string;
}

/** Consecutive messages from one person inside the grouping window: one header, several bubbles. */
export function MessageGroup({ className, messages, own }: MessageGroupProps) {
  if (messages.length === 0) return null;
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {messages.map((message, index) => (
        <MessageBubble key={message.ref} leading={index === 0} message={message} own={own} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Thread
// ---------------------------------------------------------------------------------------------

export interface MessageThreadProps {
  readonly items: readonly ChatThreadItem[];
  readonly isOwn: (message: ChatMessage) => boolean;
  /** How an event row renders. `<EventCard>` is the one the four views use. */
  readonly renderEvent: (event: ChatEvent) => ReactNode;
  /** Anything above the first message: a welcome, a security line, a copilot summary. */
  readonly header?: ReactNode;
  /** Anything below the last one: a typing indicator, a thinking orb. */
  readonly footer?: ReactNode;
  /**
   * Loading, empty and error come through here so no thread ever renders as a blank column.
   *
   * The whole fallback, not a slice of it: `PaneFallback` is the union minus `ready`, so a caller
   * that says `loading` is made to hand over a skeleton and one that says `empty` is made to teach.
   */
  readonly state?: PaneFallback;
  /**
   * The conversation timeline, or absent for the thread this product has shipped since Drop 7.
   *
   * Absent is the flag-OFF path and it is byte-for-byte the old one: `groupThreadItems`, day
   * dividers, `renderEvent`. Present is what `FEATURE_TIMELINE` switches on, and the switch is this
   * prop rather than a flag read in here — a shared component that reads an environment variable
   * cannot be rendered in either state by a test, and both states are what has to be provable.
   */
  readonly timeline?: TimelineThreadOptions;
  readonly className?: string;
}

/** What a surface hands over to render events as timeline rows. */
export interface TimelineThreadOptions extends TimelineGroupOptions {
  readonly audience: "consumer" | "operator";
  readonly handlers: TimelineActionHandlers;
  /** Retries the event read. The messages were never affected. */
  readonly onRetry?: () => void;
  /** @opaque Refs of rows whose state changed since this reader last saw them. Never rendered. */
  readonly settledRefs?: readonly string[];
}

export function MessageThread({
  className,
  footer,
  header,
  isOwn,
  items,
  renderEvent,
  state,
  timeline,
}: MessageThreadProps) {
  // The fallback is passed whole rather than sliced apart, so a caller that says `loading` is made
  // to hand over a skeleton and one that says `empty` is made to teach — the guarantees live in
  // the union and this component does not get to weaken them on the way through.
  if (state) {
    return (
      <div className={cn("flex min-h-0 flex-1 flex-col justify-center px-4 py-5", className)}>
        <PaneState {...state} className={cn("mx-auto w-full max-w-[44rem]", state.className)} />
      </div>
    );
  }

  // A caller who declared no fallback and handed over nothing still cannot get a blank column.
  // A failed event read is the one exception: it has something to say, and saying "nothing here
  // yet" over it would be the thread claiming the conversation is empty because a second read broke.
  if (items.length === 0 && timeline?.readFailed !== true) {
    return (
      <div className={cn("flex min-h-0 flex-1 flex-col justify-center px-4 py-5", className)}>
        <PaneState
          // Secondary on purpose, and for both of the reasons the rank exists. A conversation with
          // nothing in it is not a problem to solve, so a filled brand button reading "Reload" was
          // the loudest thing in the pane; and the composer the operator actually came for sits
          // directly underneath this pane, which is the control the eye should land on.
          action={{ emphasis: "secondary", label: "Reload", onAct: () => window.location.reload() }}
          className="mx-auto w-full max-w-[44rem]"
          description="No messages have been sent in this conversation yet. Reloading picks up anything that arrived since this page opened."
          status="empty"
          title="Nothing here yet"
        />
      </div>
    );
  }

  // `@container` only in timeline mode: the band ergonomics follow the frame's own width rather
  // than the window's, and declaring a containment context the shipped path does not use would
  // change the layout of a frozen surface for nothing.
  return (
    <Conversation className={cn(timeline ? "@container" : undefined, className)}>
      <ConversationContent>
        {header}
        {timeline
          ? renderTimelineBlocks(items, isOwn, timeline)
          : groupThreadItems(items, isOwn).map((block, index) =>
              block.type === "divider" ? (
                <DayDivider at={block.at} key={`divider-${block.at}-${index}`} />
              ) : block.type === "event" ? (
                <div key={block.event.ref}>{renderEvent(block.event)}</div>
              ) : (
                <MessageGroup
                  key={block.messages[0].ref}
                  messages={block.messages}
                  own={block.own}
                />
              ),
            )}
        {footer}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}

/**
 * The timeline path.
 *
 * Everything decidable — which rows this audience sees, what they say, which one carries the filled
 * action, what folds — was decided in `timeline/group.ts` before this function was called. What is
 * left here is one block kind to one component, which is the only shape in which "the operator sees
 * a row the client cannot" is checkable without a browser.
 */
function renderTimelineBlocks(
  items: readonly ChatThreadItem[],
  isOwn: (message: ChatMessage) => boolean,
  timeline: TimelineThreadOptions,
): ReactNode {
  const settled = new Set(timeline.settledRefs ?? []);
  const { blocks } = groupTimeline(items, timeline.audience, isOwn, timeline);

  return blocks.map((block, index) => {
    switch (block.type) {
      case "divider":
        return block.newSince ? (
          <TimelineNewSinceDivider at={block.at} key={`new-since-${block.at}`} />
        ) : (
          <DayDivider at={block.at} key={`divider-${block.at}-${index}`} />
        );
      case "group":
        return (
          <MessageGroup key={block.messages[0].ref} messages={block.messages} own={block.own} />
        );
      case "line":
        return <TimelineEventLine key={block.row.ref} view={block.view} />;
      case "band":
        return (
          <div className="flex justify-center" key={block.row.ref}>
            <TimelineEventBand
              handlers={timeline.handlers}
              row={block.row}
              settled={settled.has(block.row.ref)}
              view={block.view}
            />
          </div>
        );
      case "run":
        return (
          <div className="flex justify-center" key={`run-${block.lines[0].row.ref}`}>
            <TimelineEventRun label={block.label} lines={block.lines} />
          </div>
        );
      case "fold":
        return (
          <div className="flex justify-center" key={`fold-${block.bands[0].row.ref}`}>
            <TimelineEventFold
              at={block.at}
              bands={block.bands}
              body={block.body}
              glyph={block.glyph}
              handlers={timeline.handlers}
              noun={block.noun}
              title={block.title}
            />
          </div>
        );
      case "read-failed":
        return <TimelineReadFailedLine key="read-failed" onRetry={timeline.onRetry} />;
    }
  });
}

export { groupThreadItems, type ThreadBlock } from "./grouping";
