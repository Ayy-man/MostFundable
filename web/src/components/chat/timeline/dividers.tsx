"use client";

// The two rows that are about the thread rather than about an event.
//
// **The new-since divider** marks what arrived while the operator was elsewhere, drawn from the
// counterpart read watermark and from nothing else — a "new" marker that means "recent" is a claim
// about somebody's attention, which is the same lie a read receipt tells when it is derived rather
// than reported. It is labelled, not `aria-hidden`, because it is the one divider that carries
// information a sighted reader gets from its colour.
//
// **The read-failure line** is the whole point of the events being a separate read: the messages are
// current and say nothing about it, and the failure is one row with a real retry rather than a toast
// that has already gone. `role="alert"` on the runtime path, because it appears after first paint in
// response to something that failed.

import { AlertCircle } from "lucide-react";

import { cn } from "@/lib/utils";

import { dayLabel } from "../time";

export function TimelineNewSinceDivider({ at }: { readonly at: string }) {
  const label = `New since your last visit · ${dayLabel(at)}`;
  return (
    <div
      aria-label={label}
      className="flex items-center gap-3 py-1"
      role="separator"
    >
      <span aria-hidden className="h-px flex-1 bg-[var(--success)]" />
      <span className="text-xs font-semibold uppercase tracking-[0.11em] text-[var(--success)]">
        {label}
      </span>
      <span aria-hidden className="h-px flex-1 bg-[var(--success)]" />
    </div>
  );
}

export function TimelineReadFailedLine({ onRetry }: { readonly onRetry?: () => void }) {
  return (
    <div className="grid justify-items-center gap-1.5">
      <div
        className={cn(
          "inline-flex max-w-[min(100%,30rem)] items-center gap-2 rounded-full border px-3 py-1 text-xs",
          "border-[var(--destructive)] bg-[color-mix(in_srgb,var(--destructive),transparent_94%)] text-[var(--destructive)]",
        )}
        role="alert"
      >
        <AlertCircle aria-hidden className="size-3.5 shrink-0" />
        <span className="min-w-0">
          <b className="font-semibold">Updates couldn&apos;t load.</b> Messages are current.
        </span>
        {onRetry ? (
          <button
            className={cn(
              "inline-flex min-h-8 shrink-0 items-center rounded-lg border border-[var(--destructive)] px-2 text-xs font-semibold",
              "transition-colors duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)]",
              "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              "@max-[480px]:min-h-11",
            )}
            onClick={onRetry}
            type="button"
          >
            Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}
