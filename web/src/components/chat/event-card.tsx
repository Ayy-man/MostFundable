"use client";

// In-thread system events: a rule, a glyph, one line.
//
// The whole point is that this must not look like a message. Analysis finishing, a stage moving,
// a document filing, a thread being resolved — these are things that happened, and the Braintrust
// pattern renders them as a quiet marker in the flow rather than as something somebody said.
// Given a bubble and an avatar they read as an announcement from the team, which is both untrue
// and, for a product whose differentiator is that a person reviews every reply, corrosive.
//
// So: no avatar, no bubble, no side, centred in the column, and the sentence is written by the
// caller in product voice. Where a person caused it, they are named — "Resolved by Avery" is a
// different fact from "Resolved", and the audit rail has the actor either way.
//
// The glyph is never the only channel: every kind has a noun in the text, so the row still reads
// correctly with colour and icons stripped out.

import {
  ArrowRightLeft,
  CircleCheck,
  FileCheck2,
  Gauge,
  RefreshCw,
  RotateCcw,
  UserRoundCheck,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

import { MessageTime } from "./message-thread";
import type { ChatEvent, ChatEventKind } from "./types";

const EVENT_ICON: Readonly<Record<ChatEventKind, LucideIcon>> = {
  analysis_completed: Gauge,
  assigned: UserRoundCheck,
  document_uploaded: FileCheck2,
  refresh_completed: RefreshCw,
  stage_changed: ArrowRightLeft,
  thread_reopened: RotateCcw,
  thread_resolved: CircleCheck,
};

/** The noun a screen reader hears before the summary, so the kind is not carried by the icon. */
const EVENT_NOUN: Readonly<Record<ChatEventKind, string>> = {
  analysis_completed: "Analysis",
  assigned: "Assignment",
  document_uploaded: "Document",
  refresh_completed: "Refresh",
  stage_changed: "Stage",
  thread_reopened: "Conversation",
  thread_resolved: "Conversation",
};

export interface EventCardProps {
  readonly event: ChatEvent;
  readonly className?: string;
}

export function EventCard({ className, event }: EventCardProps) {
  const Icon = EVENT_ICON[event.kind];
  return (
    <div className={cn("flex items-center gap-3 py-1", className)} role="note">
      <span aria-hidden className="h-px flex-1 bg-[var(--border)]" />
      <span className="inline-flex min-w-0 max-w-[min(100%,30rem)] items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--background)] px-3 py-1.5">
        <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="sr-only">{EVENT_NOUN[event.kind]}:</span>
        <span className="min-w-0 truncate text-xs text-[var(--muted-foreground)]">
          {event.summary}
          {event.actorName ? (
            <span className="text-muted-foreground"> · {event.actorName}</span>
          ) : null}
        </span>
        <MessageTime at={event.occurredAt} />
      </span>
      <span aria-hidden className="h-px flex-1 bg-[var(--border)]" />
    </div>
  );
}
