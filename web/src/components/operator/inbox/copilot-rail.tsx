"use client";

// Pane 3: the rail, behind two tabs.
//
// Tabs rather than two stacked sections, which is Intercom's call and the right one: stacked
// sections turn a 320px column into a scroll, and the two things an operator wants here are
// rarely wanted at the same moment. Deciding what to say next is one job; checking the client's
// state is another.
//
// **The Copilot tab holds the draft workflow and a digest, and no summary written by a model.**
// There is no summarise endpoint in this product — nothing under `/api/support` answers one and
// this lane may not add a route — so the alternative to the digest below would be an orb over a
// computation, which contract §6 calls the interface lying about what the machine is doing. Every
// line in the digest is a fact already true somewhere else, gathered where it is needed. The one
// orb on this rail sits over `POST …/draft`, which is a language model actually running.
//
// **Every figure on the Details tab carries where it came from.** A readiness score with no
// snapshot date is a number an operator will quote to a client as though it were true today, and
// DESIGN.md's product-state rule exists for exactly that.

import { Info, Sparkles, X } from "lucide-react";

import {
  PaneSkeletonBar,
  PaneSkeletonRows,
  PaneState,
  ThinkingOrb,
  orbActivity,
  type PaneFallback,
} from "@/components/chat";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { SnapshotRow, ThreadDigest } from "./view-model";

export type RailTab = "copilot" | "details";

export interface CopilotRailProps {
  readonly tab: RailTab;
  readonly onTabChange: (tab: RailTab) => void;
  /** Loading, empty, error or disabled. Absent means the rail has a thread to describe. */
  readonly state?: PaneFallback;

  readonly digest?: ThreadDigest | null;
  /** The relative time for `digest.at`, formatted by the caller with the foundation's helper. */
  readonly digestAt?: string | null;

  /** True only while `POST …/draft` is actually out. */
  readonly drafting: boolean;
  /** Absent where no suggestion can be asked for: a resolved thread, or a thread already holding one. */
  readonly onGenerateDraft?: () => void;
  readonly draftBlockedReason?: string | null;

  readonly snapshot?: readonly SnapshotRow[];
  /** Said once, under the rows, rather than as a dash in five of them. */
  readonly snapshotNote?: string | null;
  /** The one way out of this tab, where there is somewhere to go. */
  readonly snapshotAction?: { readonly label: string; readonly onAct: () => void };

  /** Closes the rail where it is a sheet. Absent on the wide layout. */
  readonly onClose?: () => void;
  readonly className?: string;
}

const TABS: readonly { value: RailTab; label: string }[] = [
  { label: "Copilot", value: "copilot" },
  { label: "Details", value: "details" },
];

export function CopilotRail({
  className,
  digest = null,
  digestAt = null,
  draftBlockedReason = null,
  drafting,
  onClose,
  onGenerateDraft,
  onTabChange,
  snapshot = [],
  snapshotAction,
  snapshotNote = null,
  state,
  tab,
}: CopilotRailProps) {
  // The one orb on this pane, and it cannot be constructed without the in-flight flag.
  const activity = orbActivity({ inFlight: drafting, kind: "held_draft" });

  return (
    <aside
      aria-label="Client panel"
      className={cn("flex min-h-0 min-w-0 flex-col bg-[var(--background)]", className)}
    >
      <div className="flex min-h-14 shrink-0 items-center gap-1 border-b border-[var(--border)] px-2">
        <div aria-label="Panel" className="flex min-w-0 flex-1 items-center gap-1" role="tablist">
          {TABS.map((each) => (
            <button
              aria-selected={tab === each.value}
              className={cn(
                "inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium transition-colors duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)]",
                "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                tab === each.value
                  ? "bg-[var(--accent)] text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              key={each.value}
              onClick={() => onTabChange(each.value)}
              role="tab"
              type="button"
            >
              {each.label}
            </button>
          ))}
        </div>
        {onClose ? (
          <Button
            aria-label="Close the client panel"
            className="shrink-0"
            onClick={onClose}
            size="icon-lg"
            type="button"
            variant="ghost"
          >
            <X aria-hidden className="size-4" />
          </Button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {state ? (
          <PaneState {...state} />
        ) : tab === "copilot" ? (
          <div className="space-y-5">
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                This conversation
              </h3>
              {digest === null ? (
                <p className="text-sm leading-6 text-muted-foreground">
                  Open a conversation to see where it stands.
                </p>
              ) : (
                <>
                  <p className="text-sm leading-6 text-foreground">
                    {digest.lead}
                    {digestAt ? (
                      <span className="text-muted-foreground"> {digestAt}</span>
                    ) : null}
                  </p>
                  {digest.bullets.length === 0 ? null : (
                    <ul className="space-y-1.5">
                      {digest.bullets.map((bullet) => (
                        <li
                          className="flex gap-2 text-xs leading-5 text-muted-foreground"
                          key={bullet}
                        >
                          <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-[var(--muted-foreground)]" />
                          <span className="min-w-0">{bullet}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {/*
                    Said out loud, because a panel that looks like a summary is read as one — and
                    said only where there is something to say it about. The digest decides that,
                    not this pane: on a conversation with nothing in it the lead has already said
                    so, and a caption explaining where an absent count came from was two of the
                    three sentences the pane spent on a zero.
                  */}
                  {digest.provenance === null ? null : (
                    <p className="flex items-start gap-1.5 text-xs leading-5 text-muted-foreground">
                      <Info aria-hidden className="mt-0.5 size-3 shrink-0" />
                      {digest.provenance}
                    </p>
                  )}
                </>
              )}
            </section>

            <section className="space-y-2 border-t border-[var(--border)] pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                Suggested reply
              </h3>
              {activity ? (
                <div className="flex items-center gap-3 py-1">
                  <ThinkingOrb activity={activity} size="sm" />
                  <p className="min-w-0 text-sm leading-6 text-foreground">{activity.label}</p>
                </div>
              ) : onGenerateDraft ? (
                <>
                  <Button
                    className="min-h-11 w-full"
                    onClick={onGenerateDraft}
                    size="lg"
                    type="button"
                    variant="outline"
                  >
                    <Sparkles aria-hidden className="size-3.5" />
                    Suggest a reply
                  </Button>
                  {/*
                    A caption, and it stays word for word: it is what makes the control safe to
                    press, because it says both what happens and what does not. What changed is
                    where it sits. Three lines of it above the button made this section read as an
                    explanation with a control attached, in a rail whose job is to offer the
                    control; under the button it is read in the order it is wanted.
                  */}
                  <p className="text-xs leading-4 text-muted-foreground">
                    A suggestion is written into your composer for you to read, change or throw
                    away. Nothing reaches the client until you press send.
                  </p>
                </>
              ) : (
                <p className="text-xs leading-5 text-muted-foreground" role="status">
                  {draftBlockedReason ?? "No suggestion can be prepared for this conversation."}
                </p>
              )}
            </section>
          </div>
        ) : (
          <div className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Client snapshot
            </h3>
            {snapshot.length === 0 ? null : (
              <dl className="space-y-3">
                {snapshot.map((row) => (
                  <div className="space-y-0.5" key={row.label}>
                    <dt className="text-xs text-muted-foreground">{row.label}</dt>
                    <dd className="text-sm font-medium tabular-nums text-foreground">{row.value}</dd>
                    {row.provenance ? (
                      <dd className="text-xs leading-5 text-muted-foreground">{row.provenance}</dd>
                    ) : null}
                  </div>
                ))}
              </dl>
            )}
            {snapshotNote ? (
              <p className="text-xs leading-5 text-muted-foreground" role="status">
                {snapshotNote}
              </p>
            ) : null}
            {snapshotAction ? (
              <Button
                className="min-h-11 w-full"
                onClick={snapshotAction.onAct}
                size="lg"
                type="button"
                variant="outline"
              >
                {snapshotAction.label}
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </aside>
  );
}

/** The rail's own loading geometry: a heading bar, then rows the shape of the digest. */
export function RailSkeleton() {
  return (
    <div className="space-y-4">
      <PaneSkeletonBar className="w-1/3" />
      <PaneSkeletonRows rows={2} />
    </div>
  );
}
