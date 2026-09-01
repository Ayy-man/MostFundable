"use client";

import { useRef, useState } from "react";
import { AlertTriangle, ArrowUpRight, Landmark, Phone } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { BANK_DETAILS, type BankDetail } from "@/lib/demo/co-fixtures";
import { cn } from "@/lib/utils";
import {
  formatDemoMoney,
  formatDemoPercent,
  type BankHistoricalStat,
} from "@/lib/demo/feedback-fixtures";
import type { VaultReadState } from "@/lib/vault/types";

function DetailSection({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <section>
      <h3 className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {title}
      </h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/**
 * Yes / No / Not recorded. The third branch exists because `banks_cache` can
 * hold no answer at all, and a panel that prints "No" for "nobody recorded it"
 * is telling the reader something the vault never said.
 */
function requiredLabel(required: boolean | null) {
  if (required === null) return "Not recorded";
  return required ? "Yes" : "No";
}

export function BankDetailSheet({
  bank,
  durableDetail,
  durableState,
  fixtureDetailAllowed = true,
  onClose,
}: {
  bank: BankHistoricalStat | null;
  /**
   * Phase 8, behind FEATURE_VAULT: the same four blocks read from
   * `banks_cache` instead of from the fixture map. Absent — which is every
   * caller with the flag off, and `admin.tsx` either way — the lookup below is
   * exactly what it was before, so the fixture path renders unchanged.
   */
  durableDetail?: BankDetail | null;
  /**
   * Which of the four states that durable read is in. Absent or `idle` means
   * the flag is off and the fixture lookup below is the whole story. Anything
   * else means the operator asked for their own lender record, and the fixture
   * map stops being an acceptable answer: it carries invented deposit minimums
   * and example.com application links, and a panel that renders those while the
   * read is failing is telling the operator something untrue about a lender
   * they are about to act on.
   */
  durableState?: VaultReadState | null;
  /**
   * Whether this caller is allowed to fall back to the illustrative
   * `BANK_DETAILS` map when no durable read is in play. Default `true` keeps
   * the flags-OFF fixture shell rendering exactly what it always did.
   *
   * A caller passes `false` when its reader is looking at a real workspace --
   * the platform admin's lender table is the live one -- because the fixture
   * map carries invented deposit minimums and example.com application links,
   * and neither belongs in front of somebody governing the lender database.
   * With `false` and no durable payload the four §6 blocks are simply absent
   * and the panel says so.
   */
  fixtureDetailAllowed?: boolean;
  onClose: () => void;
}) {
  const durableMode = durableState != null && durableState !== "idle";
  const unreadable = durableState === "loading" || durableState === "failed";
  const detail = durableMode
    ? (durableDetail ?? undefined)
    : fixtureDetailAllowed && bank
      ? BANK_DETAILS[bank.bankId]
      : undefined;
  /**
   * The 30-day block above is derived from recorded outcomes and stands on its
   * own, so a caller with no §6 detail still gets a useful panel; only the four
   * detail sections drop out. That is why the sheet opens on `bank` alone once
   * the fixture fallback is off, rather than staying shut.
   */
  const canOpen = Boolean(bank && (detail || unreadable || !fixtureDetailAllowed));
  const [width, setWidth] = useState(672);
  const resizeState = useRef<{ startWidth: number; startX: number } | null>(null);

  return (
    <Sheet
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open={canOpen}
    >
      <SheetContent
        className="w-full gap-0 p-0"
        side="right"
        style={{ maxWidth: `min(92vw, ${width}px)` }}
      >
        {bank && canOpen ? (
          <>
            <div
              aria-label="Drag to resize the bank panel"
              className="absolute inset-y-0 left-0 z-10 hidden w-2 cursor-col-resize touch-none hover:bg-primary/20 sm:block"
              onPointerDown={(event) => {
                resizeState.current = {
                  startWidth: width,
                  startX: event.clientX,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                const resize = resizeState.current;
                if (!resize) return;
                setWidth(
                  Math.min(
                    Math.round(window.innerWidth * 0.92),
                    Math.max(420, resize.startWidth + (resize.startX - event.clientX)),
                  ),
                );
              }}
              onPointerUp={(event) => {
                resizeState.current = null;
                event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              role="separator"
            />
            <SheetHeader className="border-b border-border px-5 py-4 pr-14">
              <div className="flex items-center gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary-ink">
                  <Landmark aria-hidden className="size-4" />
                </span>
                <SheetTitle>{bank.bankName}</SheetTitle>
              </div>
            </SheetHeader>
            <div className="flex-1 space-y-6 overflow-y-auto p-5">
              <section className="rounded-xl border border-border bg-muted/25 p-4">
                {/* TODO(#212: confirm referent vs screenshot) */}
                <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  30-day data
                </h3>
                <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <dt className="text-[0.65rem] font-semibold uppercase tracking-[0.11em] text-muted-foreground">Recorded outcomes</dt>
                    <dd className="mt-1 text-lg font-semibold tabular-nums">{bank.outcomes}</dd>
                  </div>
                  <div>
                    <dt className="text-[0.65rem] font-semibold uppercase tracking-[0.11em] text-muted-foreground">Historical approval rate</dt>
                    <dd className="mt-1 text-lg font-semibold tabular-nums">{bank.outcomes ? formatDemoPercent(bank.approvalRate) : "None"}</dd>
                  </div>
                  <div>
                    <dt className="text-[0.65rem] font-semibold uppercase tracking-[0.11em] text-muted-foreground">Historical average funded</dt>
                    <dd className="mt-1 text-lg font-semibold tabular-nums">{bank.fundedCount ? formatDemoMoney(bank.averageFundedAmount) : "None"}</dd>
                  </div>
                </dl>
                <p className="mt-4 text-xs leading-5 text-muted-foreground">
                  These are recorded historical outcomes, not an offer, decision or projection.
                </p>
              </section>

              <div className="rounded-lg border border-[color-mix(in_srgb,var(--consumer-warning-border),transparent_72%)] bg-[color-mix(in_srgb,var(--consumer-warning),transparent_88%)] p-4">
                <div className="flex gap-3">
                  <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-[var(--consumer-warning-ink)]" />
                  <p className="text-sm font-medium leading-6 text-[var(--consumer-warning-ink)]">
                    For educational purposes only. This page does not provide an offer or decision.
                  </p>
                </div>
              </div>

              {detail ? (
                <>
              <DetailSection title="Channel">
                <div className="rounded-lg border border-border p-4 text-sm">
                  {detail.applyChannel.type === "online" ? (
                    <a className="inline-flex items-center gap-2 font-medium text-primary-ink underline-offset-4 hover:underline" href={detail.applyChannel.value} rel="noreferrer" target="_blank">
                      {durableMode ? "Open online application" : "Open illustrative online application"} <ArrowUpRight aria-hidden className="size-4" />
                    </a>
                  ) : detail.applyChannel.type === "phone" ? (
                    <div className="space-y-2">
                      <p className="text-muted-foreground">Call the bank at the number below.</p>
                      <a className="inline-flex items-center gap-2 font-medium text-primary-ink underline-offset-4 hover:underline" href={`tel:${detail.applyChannel.value}`}>
                        <Phone aria-hidden className="size-4" /> {detail.applyChannel.value}
                      </a>
                    </div>
                  ) : (
                    <p className="leading-6">Research a local branch and contact it directly for the current application process.</p>
                  )}
                </div>
              </DetailSection>

              <DetailSection title="Checking account">
                <dl className="grid grid-cols-1 gap-3 rounded-lg border border-border p-4 sm:grid-cols-3">
                  <div><dt className="text-xs text-muted-foreground">Required</dt><dd className="mt-1 text-sm font-semibold">{requiredLabel(detail.checking.required)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Deposit amount</dt><dd className="mt-1 text-sm font-semibold">{detail.checking.depositAmountCents === null ? "Not specified" : formatDemoMoney(detail.checking.depositAmountCents / 100)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Seasoning time</dt><dd className="mt-1 text-sm font-semibold">{detail.checking.seasoning}</dd></div>
                </dl>
              </DetailSection>

              <DetailSection title="Relationship manager">
                <div className="rounded-lg border border-border p-4">
                  <p className="text-sm font-semibold">{requiredLabel(detail.relationshipManager.required)}</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail.relationshipManager.tip}</p>
                </div>
              </DetailSection>

              <DetailSection title="Application questions">
                <dl className="divide-y divide-border rounded-lg border border-border">
                  {detail.applicationQuestions.map((question) => (
                    <div className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(10rem,0.7fr)_minmax(0,1.3fr)] sm:gap-5" key={question.id}>
                      <dt className="text-sm font-medium">{question.label}</dt>
                      <dd className="text-sm leading-6 text-muted-foreground">{question.responseBasis}</dd>
                    </div>
                  ))}
                </dl>
              </DetailSection>
                </>
              ) : (
                <p
                  className={cn(
                    "text-sm",
                    durableState === "failed" ? "text-destructive" : "text-muted-foreground",
                  )}
                  role={durableState === "failed" ? "alert" : "status"}
                >
                  {durableState === "failed"
                    ? "Unable to load this lender record."
                    : durableState === "loading"
                      ? "Loading this lender record…"
                      : "Channel, checking-account, relationship-manager and application-question details are not recorded for this lender."}
                </p>
              )}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
