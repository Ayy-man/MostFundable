"use client";

// One grammar for loading, empty, error and disabled, used by every pane in all four views.
//
// The rule it enforces is the plan's §1.4: no pane may ever render as a blank card. That failure
// is not cosmetic — a blank card is indistinguishable from a pane whose data is genuinely empty,
// which is indistinguishable from a pane whose read failed, and the person looking at it has to
// guess which. So every state here says what it is, and the two that a person can do something
// about carry the thing to do.
//
// Three details are deliberate.
//
// The skeleton mirrors the geometry it is standing in for, in light neutrals, with no shimmer
// sweep and no spinner (DESIGN.md's loading rules). A shape that matches what arrives makes the
// arrival feel like the page finishing; a spinner makes it feel like the page starting again.
//
// `error` is announced with `role="alert"` and the others with `role="status"`, because a failed
// read is the one a screen-reader user must be interrupted for.
//
// And `disabled` is a separate state from `empty`. "This is not connected in this environment"
// and "there is nothing here yet" are opposite answers, and collapsing them is how a demo teaches
// somebody that a feature is broken.
//
// The props are a discriminated union rather than a bag of optionals, and that is the part doing
// the work. The consumer Team Chat currently renders the sentence "Loading the conversation..." as
// unstyled text in a 600px void for three and a half seconds and then resolves to an empty box —
// two failures, and both of them are representable in a props bag and neither is representable
// here. `loading` cannot be constructed without a skeleton, so there is no path to a wall of text
// standing in for the geometry. `empty` cannot be constructed without a title, a description and
// an action, so "teaches, with one action" is a compile error rather than a review note. `error`
// cannot be constructed without a way out.
//
// Optionals would have been friendlier to write against and would have failed exactly the way the
// pane being replaced failed.

import { AlertTriangle, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { PaneStatus } from "./types";

/** The single thing to do about it. A pane with two equal actions has no dominant job. */
export interface PaneAction {
  readonly label: string;
  readonly onAct: () => void;
  /**
   * How loudly the action is drawn. Primary by default, so nothing already written changes.
   *
   * `"secondary"` covers two shapes that turned out to be the same one. A pane whose real primary
   * action is elsewhere on the same screen — a thread's empty state sitting directly above its own
   * composer, where a filled button outshouts the control it is pointing at. And the actions worth
   * offering that are not worth pressing: a reload, a check-again, which drawn at full weight
   * outrank every real control on the surface and leave a pane with a refresh as its loudest
   * element. Outlined rather than ghosted in both cases, because the control keeps its boundary and
   * still yields the saturated green to whatever the real primary is.
   *
   * It is not a way to make an action optional: the `empty` member still requires one, because an
   * empty pane with no way forward is a dead end.
   */
  readonly emphasis?: "primary" | "secondary";
}

/**
 * One member per state, each carrying exactly what that state cannot be honest without.
 *
 * `PaneStatus` still names the five; this is what each of them owes the reader.
 */
export type PaneStateProps = { readonly className?: string } & (
  | {
      readonly status: Extract<PaneStatus, "ready">;
      readonly children: ReactNode;
    }
  | {
      readonly status: Extract<PaneStatus, "loading">;
      /**
       * Required, and it must mirror the geometry of what is coming. This is the whole reason the
       * union exists: an optional skeleton becomes no skeleton, and no skeleton becomes a
       * sentence in a void.
       */
      readonly skeleton: ReactNode;
      /** What a screen reader hears while it waits. */
      readonly label?: string;
    }
  | {
      readonly status: Extract<PaneStatus, "empty">;
      /** What this pane is for. Never "No conversations yet", which teaches nothing. */
      readonly title: string;
      readonly description: string;
      /** The one action that fills it. An empty pane with no way forward is a dead end. */
      readonly action: PaneAction;
      readonly icon?: LucideIcon;
    }
  | {
      readonly status: Extract<PaneStatus, "error">;
      /** What failed, in words the reader can act on. */
      readonly title: string;
      readonly description?: string;
      /** The retry. A failure with no way out is a wall. */
      readonly action: PaneAction;
    }
  | {
      readonly status: Extract<PaneStatus, "disabled">;
      readonly title: string;
      /** Why it is off here. "Not connected in this environment" is information; silence is not. */
      readonly description: string;
    }
);

/**
 * `never` for as long as the union above covers every state `PaneStatus` names.
 *
 * The discriminants are written as `Extract<PaneStatus, "empty">` rather than as bare strings, so
 * renaming a status in `types.ts` breaks this file rather than silently leaving a member nobody
 * can construct. This alias closes the other direction: add a sixth status and it stops being
 * `never`, which is the signal that a state exists with nothing to render it.
 */
export type UncoveredPaneStatus = Exclude<PaneStatus, PaneStateProps["status"]>;

/** Everything except the ready state, which is what a pane hands to `PaneState` while it waits. */
export type PaneFallback = Exclude<PaneStateProps, { status: "ready" }>;

/** A neutral bar. `mf-skeleton-shape` is the repo's existing breathe, already reduced-motion safe. */
export function PaneSkeletonBar({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("mf-skeleton-shape block h-3 rounded-full bg-[var(--secondary)]", className)}
    />
  );
}

/**
 * Two presets, because a required skeleton has to be cheap to satisfy.
 *
 * If mirroring the geometry meant hand-building a shape every time, the path of least resistance
 * would become passing an empty div, and the union would have bought a compile error instead of a
 * loading state. These are the two geometries the four views actually have.
 */

/** A list's shape: avatar, name line, preview line. What the thread list resolves into. */
export function PaneSkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: rows }, (_, index) => (
        <div className="flex gap-3" key={index}>
          <span
            aria-hidden
            className="mf-skeleton-shape size-8 shrink-0 rounded-lg bg-[var(--secondary)]"
          />
          <div className="min-w-0 flex-1 space-y-2 pt-1">
            <PaneSkeletonBar className="w-1/3" />
            <PaneSkeletonBar className="w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function PaneState(props: PaneStateProps) {
  if (props.status === "ready") return <>{props.children}</>;

  if (props.status === "loading") {
    return (
      <div
        aria-busy
        aria-live="polite"
        className={cn("p-1", props.className)}
        data-motion-state
        role="status"
      >
        <span className="sr-only">{props.label ?? "Loading"}</span>
        {props.skeleton}
      </div>
    );
  }

  const failed = props.status === "error";
  const Icon = props.status === "empty" ? props.icon : undefined;
  const action = props.status === "disabled" ? undefined : props.action;

  return (
    <div
      className={cn(
        // No container for empty, loading or disabled. Every pane that mounts this already has a
        // frame of its own — the thread's messages sit on a recessed ground inside a hairline
        // border — so a bordered box here was a box inside a box, and the dashed edge is what
        // turned the inner one into a file drop target. Centred content with the icon tile
        // carrying the weight reads as "nothing here yet" without claiming to be a container.
        //
        // `error` keeps its panel, and keeps it solid rather than dashed: there the tint is
        // carrying the meaning rather than drawing a shape, and it pairs with `role="alert"`.
        "flex flex-col items-center justify-center gap-3 rounded-[10px] px-6 py-10 text-center",
        failed
          ? "border border-[color-mix(in_srgb,var(--destructive),transparent_60%)] bg-[color-mix(in_srgb,var(--destructive),transparent_94%)]"
          : null,
        props.className,
      )}
      data-motion-state
      role={failed ? "alert" : "status"}
    >
      {failed ? (
        <span className="grid size-10 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--destructive),transparent_88%)] text-destructive">
          <AlertTriangle aria-hidden className="size-4" />
        </span>
      ) : Icon ? (
        <span className="grid size-10 place-items-center rounded-xl bg-[var(--accent)] text-[var(--primary-ink)]">
          <Icon aria-hidden className="size-4" />
        </span>
      ) : null}

      <div className="space-y-1">
        <p className={cn("text-sm font-semibold", failed ? "text-destructive" : "text-foreground")}>
          {props.title}
        </p>
        {props.description ? (
          <p className="mx-auto max-w-sm text-xs leading-5 text-muted-foreground">
            {props.description}
          </p>
        ) : null}
      </div>

      {/* A disabled pane offers nothing to press: a control that cannot act is absent, not
          disabled with a tooltip (contract §7). The union has already made that unrepresentable. */}
      {action ? (
        <Button
          className="min-h-11"
          onClick={action.onAct}
          size="lg"
          type="button"
          variant={failed || action.emphasis === "secondary" ? "outline" : "default"}
        >
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * A conversation's shape: alternating sides, varying widths, a couple of lines each.
 *
 * Uneven on purpose. A column of identical bars reads as a loading widget; blocks that sit where
 * the messages will sit read as the page arriving, which is the difference DESIGN.md is after
 * when it says the shapes mirror the final geometry.
 */
export function PaneSkeletonThread({ messages = 4 }: { messages?: number }) {
  // Fixed widths rather than random ones: a skeleton that reshuffles on every render draws
  // attention to itself, which is the one thing it must not do.
  const shape = [
    { lines: 2, own: false, width: "w-[62%]" },
    { lines: 1, own: true, width: "w-[44%]" },
    { lines: 3, own: false, width: "w-[71%]" },
    { lines: 1, own: true, width: "w-[38%]" },
    { lines: 2, own: false, width: "w-[55%]" },
  ];
  return (
    <div className="space-y-5">
      {shape.slice(0, messages).map((row, index) => (
        <div className={cn("flex gap-3", row.own && "flex-row-reverse")} key={index}>
          {row.own ? null : (
            <span
              aria-hidden
              className="mf-skeleton-shape size-8 shrink-0 rounded-lg bg-[var(--secondary)]"
            />
          )}
          <div className={cn("space-y-2 rounded-[10px] p-3", row.width, row.own && "ml-auto")}>
            {Array.from({ length: row.lines }, (_, line) => (
              <PaneSkeletonBar className={line === row.lines - 1 ? "w-3/5" : "w-full"} key={line} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
