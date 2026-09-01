"use client";

// The client's own snapshot, beside their own conversation.
//
// Two rules govern what may appear here and both are older than this lane.
//
// **Only this client's own record.** The rail is handed a `ConsumerClientSnapshot`, which is eight
// fields narrowed from the tracker row and contains no identifier at all, so it could not name
// another record if it wanted to.
//
// **Every figure carries its provenance.** DESIGN.md's product-state rules say a material metric
// shows a source, a snapshot date, or an adjacent path to the evidence, and readiness is the one
// number here that a person might otherwise read as a live score. So it renders with the date it
// was observed on, and when nothing has been observed it says that instead of showing a zero. A
// readiness of 0 and a readiness nobody has measured are different facts and must not share a
// rendering.
//
// Rows rather than cards, and a hairline rather than a border box: the design brief's spine says a
// card appears only where something genuinely lifts off the surface, and a stack of five facts is
// not that. The one thing here that does lift is the assistant entry, because it is a different
// kind of thing from everything above it, and the navy says so before the words do.
//
// The two halves are exported separately because the narrow layout splits them. Below `xl` the
// snapshot folds into a disclosure above the thread while the assistant entry stays on screen — a
// door that is one tap away is fine, a door hidden inside a collapsed section is a feature nobody
// finds.

import type { ComponentType, ReactNode } from "react";
import { CalendarClock, CircleDot, ListChecks, UserRound } from "lucide-react";

import { PaneSkeletonBar, PaneState, type PaneFallback } from "@/components/chat";

import { observedOn } from "./client-snapshot";
import type { ConsumerClientSnapshot } from "./types";

function Row({
  children,
  icon: Icon,
  label,
}: {
  children: ReactNode;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-3">
      {/* The label is the side that gives, and that ordering is the whole of W2-20. Both columns
          were shrinkable, so the value was squeezed first and "Observed 22 Aug 2026" broke across
          two lines with the year alone on the second — a date is one fact and reads as a wrapping
          accident when it is split. A label is a phrase and wraps without losing anything. */}
      <span className="inline-flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon aria-hidden className="size-3.5 shrink-0" />
        {label}
      </span>
      <span className="shrink-0 text-right text-xs font-semibold tabular-nums text-foreground">
        {children}
      </span>
    </div>
  );
}

/** The rail's own skeleton, shaped like the five rows it resolves into rather than like a spinner. */
export function WorkspaceSnapshotSkeleton() {
  return (
    <div className="divide-y divide-[var(--border)]">
      {["w-1/2", "w-2/3", "w-1/3", "w-3/5", "w-1/2"].map((width) => (
        <div className="flex items-center justify-between gap-3 py-3" key={width}>
          <PaneSkeletonBar className="w-24" />
          <PaneSkeletonBar className={width} />
        </div>
      ))}
    </div>
  );
}

export interface WorkspaceSnapshotProps {
  /** Present only in the ready state; `state` covers the other four. */
  readonly snapshot: ConsumerClientSnapshot | null;
  readonly state?: PaneFallback;
}

export function WorkspaceSnapshot({ snapshot, state }: WorkspaceSnapshotProps) {
  if (state) return <PaneState {...state} />;
  if (snapshot === null) return null;

  const readinessObserved = observedOn(snapshot.analysisAt);
  const refreshOn = observedOn(snapshot.nextRefreshAt);

  return (
    <div className="divide-y divide-[var(--border)]">
      <Row icon={CircleDot} label="Stage">
        {snapshot.stageLabel}
      </Row>

      <Row icon={ListChecks} label="Verified readiness">
        {snapshot.readiness !== null && readinessObserved !== null ? (
          <>
            {/* W2-19: the denominator, in the visible convention the rest of the surface already
                uses — `consumer.tsx` prints this number as `{readiness} / 100` wherever a person
                reads it, and describes it to a screen reader as "out of 100". A bare 99 beside the
                word "readiness" reads as a percentage or as a score, and this rail's own accessible
                description was already saying out of 100 while the figure it described did not. */}
            {snapshot.readiness}
            <span className="ml-1 font-medium text-muted-foreground">/ 100</span>
            {/* The provenance travels with the figure rather than sitting in a legend. A readiness
                without its snapshot date reads as a live score, which is the claim this product
                may never make. `whitespace-nowrap` because the date is one fact. */}
            <span className="block whitespace-nowrap text-xs font-medium text-muted-foreground">
              Observed {readinessObserved}
            </span>
          </>
        ) : (
          <span className="font-medium text-muted-foreground">
            {snapshot.analysisPending === null ? "No review yet" : "Review in progress"}
          </span>
        )}
      </Row>

      <Row icon={ListChecks} label="Open actions">
        {snapshot.openActionCount === null ? (
          <span className="font-medium text-muted-foreground">Not recorded</span>
        ) : (
          snapshot.openActionCount
        )}
      </Row>

      <Row icon={CalendarClock} label="Next credit refresh">
        {refreshOn === null ? (
          <span className="font-medium text-muted-foreground">Not scheduled</span>
        ) : (
          refreshOn
        )}
      </Row>

      <Row icon={UserRound} label="Your team">
        {snapshot.assignedToName === null ? (
          <span className="font-medium text-muted-foreground">Your funding team</span>
        ) : (
          snapshot.assignedToName
        )}
      </Row>
    </div>
  );
}
