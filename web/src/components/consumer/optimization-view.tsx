"use client";

import { useCallback, useId, useState, useSyncExternalStore, type ComponentProps, type KeyboardEvent, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, ChevronDown, Flag } from "lucide-react";

import {
  ConsumerPageHeader,
  SourceStamp,
  StateMarker,
  StatusTag,
  WorkspaceSection,
} from "@/components/consumer/consumer-kit";
import { PlanNarrative } from "@/components/consumer/plan-narrative";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { OptimizationReportError, useConsumerOptimization, type ReportActionV1 } from "@/lib/optimization/client";
import {
  buckets,
  DISPLAY_STATE_LABEL_V1,
  displayState,
  documentNoun,
  nextUp,
  OWNER_LABEL_V1,
  ownerOf,
  referencedTrack,
  shortDate,
  signalCopy,
  sortedUtilizationAccounts,
  trackSummary,
  type DisplayStateV1,
  type TrackKindV1,
} from "@/lib/optimization/view-model";
import { factorAnchorId, narrativeNoteFor } from "@/lib/optimization/narrative-view";
import { useCountUp, useLingering, usePrevious } from "@/lib/motion/hooks";
import { cn } from "@/lib/utils";

import type { ConsumerOptimizationV1, FactorV1, TrackV1 } from "@/lib/optimization/types";

/**
 * The consumer Optimization view on a durable workspace.
 *
 * Everything on it comes from `GET /api/optimization`, which the consumer's own session reads
 * under RLS: the factor states, the readiness score, the utilization percentages and the
 * checklist receipts. Nothing here is a fixture, and nothing here carries a balance, a limit or
 * an account age. Where the read has nothing to say the section says why and what happens next.
 */

type NavTarget = "plan" | "coach" | "documents";

const UTILIZATION_TARGET_PCT = 30;
const BUSINESS_ROLLUP_FACTOR_KEY = "business_profile";

/** Educational steps behind the Instructions control. No partner links, no promises. */
const INSTRUCTIONS: Readonly<Record<"utilization_under_30" | "business", { title: string; steps: readonly string[] }>> = {
  business: {
    steps: [
      "Gather your formation documents, business identifier, business email and website address.",
      "Upload them in Onboarding & Docs, one item per factor, and confirm the business name matches your filings.",
      "Your funding team checks each item and marks it here; ask in Team Chat if anything is unclear.",
    ],
    title: "Send your business details",
  },
  utilization_under_30: {
    steps: [
      "Confirm the target for each account with your funding team before sending a payment.",
      "Make the payment through your card issuer and save the confirmation. Do not close the account.",
      "Tell your funding team what you paid, then wait for a dated bureau update before treating it as verified.",
    ],
    title: "Pay down your revolving balances",
  },
};

const DESKTOP_QUERY = "(min-width: 1024px)";

function useDesktop(): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const media = window.matchMedia(DESKTOP_QUERY);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true,
  );
}

function markerFor(state: DisplayStateV1): "verified" | "verifying" | "todo" {
  if (state === "verified") return "verified";
  if (state === "checking") return "verifying";
  return "todo";
}

function toneFor(state: DisplayStateV1): "success" | "info" | "warning" | "neutral" {
  if (state === "verified") return "success";
  if (state === "checking") return "info";
  if (state === "action-needed") return "warning";
  return "neutral";
}

function Panel({ children, className, ...rest }: { children: ReactNode; className?: string } & Omit<ComponentProps<"section">, "children" | "className">) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-[10px] border border-[var(--consumer-surface-border,var(--consumer-border))] bg-card",
        className,
      )}
      {...rest}
    >
      {children}
    </section>
  );
}

function Eyebrow({ children, tone }: { children: ReactNode; tone: "ready" | "next" | "idle" | "ended" }) {
  return (
    <p className="flex items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-full",
          tone === "ready" && "bg-[var(--consumer-accent)] shadow-[0_0_0_3px_var(--consumer-accent-tint)]",
          tone === "next" && "bg-[var(--consumer-warning)]",
          tone === "idle" && "bg-[var(--consumer-border)]",
          tone === "ended" && "border border-dashed border-[var(--consumer-muted)]",
        )}
      />
      {children}
    </p>
  );
}

function ProgressBar({ checkingPct, label, pct }: { checkingPct: number; label: string; pct: number }) {
  return (
    <div
      aria-label={label}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={pct}
      className="relative h-1.5 overflow-hidden rounded-full bg-[var(--consumer-border)]"
      role="progressbar"
    >
      <span
        className={cn(
          "absolute inset-y-0 left-0 rounded-full transition-[width] duration-[var(--duration-medium)] ease-[var(--ease-smooth-out)] motion-reduce:transition-none",
          pct === 100 ? "bg-[var(--consumer-accent)]" : "bg-[var(--consumer-accent-ink)]",
        )}
        style={{ width: `${pct}%` }}
      />
      {checkingPct > 0 ? (
        <span
          className="absolute inset-y-0 rounded-full bg-[var(--consumer-accent-ink)] opacity-30"
          style={{ left: `${pct}%`, width: `${checkingPct}%` }}
        />
      ) : null}
    </div>
  );
}

function LiveRegion({ message }: { message: string }) {
  return (
    <p aria-live="polite" className="sr-only">
      {message}
    </p>
  );
}

export function DurableOptimizationView({
  canceled,
  navigate,
  northwestPartnerUrl = null,
  warnings,
}: {
  canceled: boolean;
  navigate: (view: NavTarget) => void;
  northwestPartnerUrl?: string | null;
  /** Alec's three verbatim cautions, owned by the surface that pins them. */
  warnings: readonly string[];
}) {
  const { refetch, report, state } = useConsumerOptimization(true);
  const [filter, setFilter] = useState<"open" | "done">("open");
  const [announcement, setAnnouncement] = useState("");
  const [instructions, setInstructions] = useState<keyof typeof INSTRUCTIONS | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [writeNotice, setWriteNotice] = useState<string | null>(null);

  const onReport = useCallback(
    async (factorKey: string, action: ReportActionV1) => {
      setPendingKey(factorKey);
      setWriteNotice(null);
      try {
        await report(factorKey, action);
        setAnnouncement(action === "report" ? "Reported to your funding team." : "Report withdrawn.");
      } catch (error) {
        const code = error instanceof OptimizationReportError ? error.code : "failed";
        setWriteNotice(
          code === "conflict"
            ? "This factor moved on the account before your report landed, so the list was refreshed. Check it and try again."
            : code === "closed"
              ? "Reporting is closed on this account."
              : "Your report did not save. Nothing on your account changed; try again or tell your funding team in Team Chat.",
        );
      } finally {
        setPendingKey(null);
      }
    },
    [report],
  );

  const preEnrollment = state.status === "ready" && state.data === null;
  const header = (
    <ConsumerPageHeader
      actions={
        preEnrollment ? null : (
          <Button className="min-h-11" onClick={() => navigate("plan")} variant="outline">
            <Flag aria-hidden /> View Your Funding
          </Button>
        )
      }
      title="Optimization"
    />
  );

  if (state.status === "loading") {
    return (
      <div>
        {header}
        <LoadingState />
      </div>
    );
  }

  if (state.status === "off") {
    return (
      <div>
        {header}
        <Panel aria-labelledby="opt-off-h" className="p-5 sm:p-7">
          <Eyebrow tone="idle">Analysis reads are off</Eyebrow>
          <h2 className="mt-3 text-xl font-semibold tracking-[-0.02em]" id="opt-off-h">Your checklist cannot be read in this workspace yet.</h2>
          <p className="mt-3 max-w-[60ch] text-sm leading-6 text-muted-foreground">
            The analysis read is switched off for this deployment, so no factor states, readiness score or utilization figures can be shown. Your funding team holds the current plan.
          </p>
          <div className="mt-5">
            <Button className="min-h-11" onClick={() => navigate("coach")}>Ask in Team Chat</Button>
          </div>
        </Panel>
        <WarningsSection ready={false} warnings={warnings} />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div>
        {header}
        <Panel className="p-5 sm:p-7" role="alert">
          <Eyebrow tone="idle">Could not load</Eyebrow>
          <h2 className="mt-3 text-xl font-semibold tracking-[-0.02em]">Your plan did not load.</h2>
          <p className="mt-3 max-w-[60ch] text-sm leading-6 text-muted-foreground">
            The request to read your checklist failed before anything reached this page. Nothing on your account changed. Try again; if it fails a second time, your funding team can read the same plan from their side.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button className="min-h-11" onClick={() => void refetch()}>Try again</Button>
            <Button className="min-h-11" onClick={() => navigate("coach")} variant="outline">Ask in Team Chat</Button>
            <SourceStamp className="basis-full sm:basis-auto sm:ml-auto">
              {state.correlationId ? `Request id ${state.correlationId}` : "No request id was returned"} · {new Date(state.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            </SourceStamp>
          </div>
        </Panel>
        <WarningsSection ready={false} warnings={warnings} />
      </div>
    );
  }

  const data = state.data;

  if (data === null) {
    return (
      <div>
        {header}
        <Panel aria-labelledby="opt-pre-h" className="grid xl:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.9fr)]">
          <div className="p-5 sm:p-7">
            <Eyebrow tone="idle">Enrollment not finished</Eyebrow>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em] text-balance" id="opt-pre-h">Finish enrollment to start your first analysis.</h2>
            <p className="mt-3 max-w-[60ch] text-sm leading-6 text-muted-foreground">
              The first source check runs automatically once enrollment completes: your two consents, e-signature, payment authorization and identity check. Until then there are no factors to show and nothing to act on.
            </p>
            <div className="mt-5">
              <Button className="min-h-11" onClick={() => navigate("documents")}>Finish enrollment</Button>
            </div>
          </div>
          <AsideShell verified={0} total={15}>
            <li className="flex justify-between gap-3 border-t border-[var(--consumer-border)] py-2 text-xs"><span>Assigned to you</span><b className="font-semibold">Nothing yet</b></li>
            <li className="flex justify-between gap-3 border-t border-[var(--consumer-border)] py-2 text-xs"><span>Estimated completion</span><b className="font-semibold">TBD</b></li>
          </AsideShell>
        </Panel>
        <WorkspaceSection className="mt-5" description="Starts after enrollment." title="Cinderella profile">
          <p className="text-sm leading-6 text-muted-foreground">
            Your first analysis reads eight personal credit factors from your authorized report and seven business factors from the documents you upload. Nothing is read before your consents are on file.
          </p>
        </WorkspaceSection>
        <FooterStamp />
      </div>
    );
  }

  const b = buckets(data, canceled);
  const ready = b.verified === b.total;
  const next = nextUp(data, canceled);
  const referenced = referencedTrack(data, canceled);
  const analysisAt = shortDate(data.analysis?.ranAt ?? null);
  const noAnalysis = data.provenance === "none";
  const reportingOpen = data.reporting.enabled && !canceled;

  return (
    <div>
      {header}
      <LiveRegion message={announcement} />

      {canceled ? (
        <div className="mb-5 flex gap-3 rounded-[10px] border border-[var(--consumer-border)] bg-card px-4 py-3.5" role="status">
          <StateMarker size="sm" state="paused" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">Verification ended when the subscription was canceled.</p>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">Your checklist stays readable and the instructions stay open. Nothing new is checked and nothing can be reported. Reactivate from Account &amp; Billing to resume.</p>
          </div>
        </div>
      ) : null}

      {/*
        Above the checklist and above the next-up panel, because it is the same analysis said
        first in words: a consumer reads the verdict, then the one thing to do, then the rows that
        back both. It renders nothing at all when no narrative was stored, so the view below it is
        untouched on every account that has none.
      */}
      <PlanNarrative view={data} />

      {noAnalysis ? (
        <Panel aria-labelledby="opt-next-h" className="grid xl:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.9fr)]">
          <div className="p-5 sm:p-7">
            <Eyebrow tone="idle">Waiting on your first analysis</Eyebrow>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em] text-balance" id="opt-next-h">Your checklist starts with your first source check.</h2>
            <p className="mt-3 max-w-[60ch] text-sm leading-6 text-muted-foreground">
              Enrollment is complete but no analysis has run on this account yet, so there are no factors to show and nothing for you to act on. The first check normally runs within a day of enrollment; if it has been longer, ask your funding team to look.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button className="min-h-11" onClick={() => navigate("coach")}>Ask in Team Chat</Button>
              <SourceStamp className="basis-full sm:basis-auto sm:ml-auto">We store only the conclusions of your analysis, never your report or your account numbers.</SourceStamp>
            </div>
          </div>
          <AsideShell total={b.total} verified={0}>
            <li className="flex justify-between gap-3 border-t border-[var(--consumer-border)] py-2 text-xs"><span>Assigned to you</span><b className="font-semibold">Nothing yet</b></li>
            <li className="flex justify-between gap-3 border-t border-[var(--consumer-border)] py-2 text-xs"><span>Estimated completion</span><b className="font-semibold">TBD</b></li>
          </AsideShell>
        </Panel>
      ) : (
        <Panel aria-labelledby="opt-next-h" className="grid xl:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.9fr)]">
          <div className="p-5 sm:p-7">
            {next.kind === "ready" ? (
              <>
                <Eyebrow tone="ready">Cinderella profile complete</Eyebrow>
                <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em] text-balance" id="opt-next-h">Nothing left on your side.</h2>
                <p className="mt-3 max-w-[60ch] text-sm leading-6 text-muted-foreground">Both checklists are verified at 100, so Your Funding is unlocked and application details are visible. Your funding team takes it from here.</p>
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <Button className="min-h-11" onClick={() => navigate("plan")}>View Your Funding</Button>
                  <AnalysisStamp analysisAt={analysisAt} canceled={canceled} />
                </div>
              </>
            ) : next.kind === "you" ? (
              <>
                <Eyebrow tone={canceled ? "ended" : "next"}>{canceled ? "Was next up · verification ended" : "Next up · start here"}</Eyebrow>
                <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em] text-balance" id="opt-next-h">
                  {next.hasAccountRows ? "Pay down the revolving accounts that report above 30%." : "Pay down your revolving balances."}
                </h2>
                <p className="mt-3 max-w-[60ch] text-sm leading-6 text-muted-foreground">
                  {next.overallUtilizationPct === null
                    ? "Revolving utilization is above target."
                    : `Overall revolving utilization is ${next.overallUtilizationPct}%; the target is under ${UTILIZATION_TARGET_PCT}%.`}
                  {" "}This is the fastest open factor to move{next.docsAlso ? "; your business documents are the other thing on you" : ""}. Pay accounts down and do not close them.
                  {canceled
                    ? " Nothing you pay down will be checked while the subscription is canceled; reactivate to resume."
                    : " Allow one statement cycle for the new balances to report before the next source check."}
                  {!next.hasAccountRows && !canceled
                    ? " Your last analysis reported the overall figure only; the per-account list arrives with the next check. Until then, your card issuers or Credit Monitoring show which account is closest to its limit."
                    : ""}
                </p>
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <Button className="min-h-11" onClick={() => setInstructions("utilization_under_30")}>Instructions</Button>
                  <ReportControl
                    canceled={canceled}
                    factor={next.factor}
                    factorKey={next.factor.key}
                    navigate={navigate}
                    onReport={onReport}
                    pending={pendingKey === next.factor.key}
                    reportingOpen={reportingOpen}
                  />
                  <AnalysisStamp analysisAt={analysisAt} canceled={canceled} />
                </div>
              </>
            ) : next.kind === "docs" ? (
              <>
                <Eyebrow tone="next">Next up · start here</Eyebrow>
                <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em] text-balance" id="opt-next-h">
                  {next.missing.length === data.tracks.business.total
                    ? "Send your business details so the business checklist can start."
                    : `Send the ${next.missing.length} business detail${next.missing.length === 1 ? "" : "s"} still missing.`}
                </h2>
                <p className="mt-3 max-w-[60ch] text-sm leading-6 text-muted-foreground">
                  {next.missing.length === data.tracks.business.total ? "Nothing is on file yet for the business track" : "Still missing"}: {next.missing.map(documentNoun).join(", ")}. Upload them in Onboarding &amp; Docs and your funding team checks each one.
                </p>
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <Button className="min-h-11" onClick={() => navigate("documents")}>Open Onboarding &amp; Docs</Button>
                  <Button className="min-h-11" onClick={() => setInstructions("business")} variant="outline">Instructions</Button>
                  <ReportControl
                    canceled={canceled}
                    factor={null}
                    factorKey={BUSINESS_ROLLUP_FACTOR_KEY}
                    label="Report profile sent"
                    navigate={navigate}
                    onReport={onReport}
                    pending={pendingKey === BUSINESS_ROLLUP_FACTOR_KEY}
                    reportingOpen={reportingOpen}
                    rollup={data.tracks.business.rollup}
                  />
                  <AnalysisStamp analysisAt={analysisAt} canceled={canceled} />
                </div>
              </>
            ) : next.kind === "rollup" ? (
              <>
                <Eyebrow tone="idle">Nothing on your side right now</Eyebrow>
                <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em] text-balance" id="opt-next-h">Your business profile is with your funding team.</h2>
                <p className="mt-3 max-w-[60ch] text-sm leading-6 text-muted-foreground">
                  You reported the business profile{next.reportedAt ? ` on ${shortDate(next.reportedAt)}` : ""}. The seven business factors are checked against it at the next review, and nothing else on your list is yours to move. If a document is still missing, upload it in Onboarding &amp; Docs; otherwise there is nothing more to send.
                </p>
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <Button className="min-h-11" onClick={() => navigate("coach")}>Ask in Team Chat</Button>
                  <Button className="min-h-11" onClick={() => navigate("documents")} variant="outline">Open Onboarding &amp; Docs</Button>
                  <ReportControl
                    canceled={canceled}
                    factor={null}
                    factorKey={BUSINESS_ROLLUP_FACTOR_KEY}
                    label="Report profile sent"
                    navigate={navigate}
                    onReport={onReport}
                    pending={pendingKey === BUSINESS_ROLLUP_FACTOR_KEY}
                    reportingOpen={reportingOpen}
                    rollup={data.tracks.business.rollup}
                  />
                  <AnalysisStamp analysisAt={analysisAt} canceled={canceled} />
                </div>
              </>
            ) : (
              <>
                <Eyebrow tone="idle">Nothing on your side right now</Eyebrow>
                <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em] text-balance" id="opt-next-h">Nothing for you to do until the next check.</h2>
                <p className="mt-3 max-w-[60ch] text-sm leading-6 text-muted-foreground">
                  Every open factor is either led by your funding team, moves with the calendar, or is a reporting state nobody actions. Keep the guidance below, keep accounts open, and the next source check will show what moved.
                </p>
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <Button className="min-h-11" onClick={() => navigate("coach")}>Ask in Team Chat</Button>
                  <AnalysisStamp analysisAt={analysisAt} canceled={canceled} />
                </div>
              </>
            )}
            {writeNotice ? (
              <p className="mt-4 rounded-[8px] bg-[var(--consumer-canvas)] px-3 py-2 text-xs leading-5 text-muted-foreground" role="status">{writeNotice}</p>
            ) : null}
          </div>
          <AsideShell total={b.total} verified={b.verified}>
            {canceled ? (
              <>
                <AsideRow label="Open factors" value={String(b.total - b.verified)} />
                <AsideRow label="Assigned to you" value="None while canceled" />
              </>
            ) : (
              (
                [
                  ["On you", b.you.length],
                  ["Needs your documents", b.docs.length],
                  ["With your funding team", b.team.length],
                  ["Moves with time", b.time.length],
                  ["Reported as-is", b.report.length],
                  ["Checking", b.checking],
                ] as const
              )
                .filter(([, n]) => n > 0)
                .map(([label, n]) => <AsideRow key={label} label={label} value={String(n)} />)
            )}
            {!canceled && b.verified === b.total ? <AsideRow label="Open factors" value="None" /> : null}
            <AsideRow label="Estimated completion" value={ready ? "Complete" : canceled ? "Not scheduled" : data.estimatedCompletion.label} />
            <li className="pt-3">
              <SourceStamp>
                {ready
                  ? `Verified at 100 on the ${analysisAt ?? "latest"} source check.`
                  : canceled
                    ? "No further checks will run, so no date is shown."
                    : "Durations per action are still being confirmed with your funding team, so no date is shown."}
              </SourceStamp>
            </li>
            {data.readiness !== null ? (
              <li className="mt-3 border-t border-[var(--consumer-border)] pt-3 text-xs leading-5">
                Verified readiness <b className="font-semibold tabular-nums">{data.readiness}</b> · scored from the measurable signals in your {analysisAt ?? "latest"} analysis, a different count from the {b.total} factors above; it stays below 100 until every factor is verified.
              </li>
            ) : null}
          </AsideShell>
        </Panel>
      )}

      <WarningsSection ready={ready} warnings={warnings} />

      <WorkspaceSection
        description={
          ready
            ? "Both checklists are complete and verified at 100."
            : canceled
              ? "Verification ended with the subscription."
              : "Funding can start when both checklists are complete and verified at 100."
        }
        title="Cinderella profile"
        trailing={
          noAnalysis ? null : (
            <FilterToggle disabledOpen={ready} onChange={(value) => { setFilter(value); setAnnouncement(value === "done" ? `Showing all ${b.total} factors` : `Showing ${b.total - b.verified} open factors`); }} value={filter} />
          )
        }
      >
        {filter === "done" ? (
          <p className="mb-5 rounded-[8px] bg-[var(--consumer-canvas)] px-3 py-2 text-xs leading-5 text-muted-foreground">Already done: the complete known checklist is shown alongside anything that still needs verification.</p>
        ) : ready ? (
          <p className="mb-5 rounded-[8px] bg-[var(--consumer-canvas)] px-3 py-2 text-xs leading-5 text-muted-foreground">Every factor is verified. The full list stays here as your record.</p>
        ) : null}
        <div className="grid gap-8 lg:grid-cols-2 lg:gap-x-10">
          <Track
            canceled={canceled}
            filter={filter}
            kind="personal"
            narrative={data.narrative}
            noAnalysis={noAnalysis}
            onInstructions={setInstructions}
            onReport={onReport}
            open={referenced === "personal" || (referenced === null && !ready)}
            pendingKey={pendingKey}
            reportingOpen={reportingOpen}
            track={data.tracks.personal}
          />
          <Track
            canceled={canceled}
            filter={filter}
            kind="business"
            narrative={data.narrative}
            noAnalysis={noAnalysis}
            onInstructions={setInstructions}
            onReport={onReport}
            open={referenced === "business"}
            pendingKey={pendingKey}
            reportingOpen={reportingOpen}
            track={data.tracks.business}
          />
        </div>
        <SourceStamp className="mt-5 border-t border-[var(--consumer-border)] pt-4">Based on your credit report, your docs, and what you report to us.</SourceStamp>
        {northwestPartnerUrl ? (
          <a className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-[var(--consumer-accent-ink)] underline" href={northwestPartnerUrl} rel="noreferrer" target="_blank">
            Open Northwest partner resource <ArrowRight aria-hidden className="ml-2 size-4" />
          </a>
        ) : null}
      </WorkspaceSection>

      {noAnalysis ? null : <UtilizationSection analysisAt={analysisAt} canceled={canceled} data={data} />}

      <FooterStamp />

      <Dialog onOpenChange={(open) => { if (!open) setInstructions(null); }} open={instructions !== null}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{instructions ? INSTRUCTIONS[instructions].title : ""}</DialogTitle>
            <DialogDescription>Review these educational steps with your funding team before acting.</DialogDescription>
          </DialogHeader>
          {instructions ? (
            <ol className="divide-y divide-[var(--consumer-border)] border-y border-[var(--consumer-border)]">
              {INSTRUCTIONS[instructions].steps.map((step, index) => (
                <li className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3 py-4 text-sm leading-6" key={step}>
                  <span className="grid size-7 place-items-center rounded-full bg-[var(--consumer-accent-tint)] text-xs font-semibold text-[var(--consumer-accent-ink)] tabular-nums">{index + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          ) : null}
          <SourceStamp>No partner links are included. Ask your funding team if any step is unclear.</SourceStamp>
          <DialogFooter>
            <Button className="min-h-11" onClick={() => setInstructions(null)} variant="outline">Close instructions</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AnalysisStamp({ analysisAt, canceled }: { analysisAt: string | null; canceled: boolean }) {
  return (
    <SourceStamp className="basis-full sm:basis-auto sm:ml-auto">
      {analysisAt ? `From your ${analysisAt} analysis.` : "From your latest analysis."} {canceled ? "No further checks will run." : "Next source check per your monitoring schedule."}
    </SourceStamp>
  );
}

function AsideShell({ children, total, verified }: { children: ReactNode; total: number; verified: number }) {
  // The figure counts to its value and ticks green when a factor is verified while the page is
  // open, so the checklist row that moved and the number it moved are read as one event.
  const shown = useCountUp(verified, 900) ?? verified;
  const previous = usePrevious(verified);
  const ticked = previous !== undefined && previous !== verified;
  return (
    <aside className="border-t border-[var(--consumer-border)] bg-[var(--consumer-panel,var(--consumer-canvas))] p-5 xl:border-l xl:border-t-0 xl:p-7">
      <h3 className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Where you stand</h3>
      <p className="mt-2 flex flex-wrap items-baseline gap-2">
        <b className="inline-block text-[2.2rem] font-semibold leading-none tracking-[-0.04em] tabular-nums" data-count-tick={ticked ? "" : undefined} key={ticked ? verified : "rest"}>{shown} of {total}</b>
        <span className="text-sm text-muted-foreground">verified · Ready at {total} of {total}</span>
      </p>
      <ul className="mt-4">{children}</ul>
    </aside>
  );
}

function AsideRow({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex justify-between gap-3 border-t border-[var(--consumer-border)] py-2 text-xs">
      <span>{label}</span>
      <b className="font-semibold tabular-nums">{value}</b>
    </li>
  );
}

function FooterStamp() {
  return <SourceStamp className="mt-5">Educational planning only. MostFundable is not a lender and does not guarantee funding.</SourceStamp>;
}

function WarningsSection({ ready, warnings }: { ready: boolean; warnings: readonly string[] }) {
  return (
    <WorkspaceSection
      className="my-5"
      description="Educational guidance for the current optimization plan."
      title={ready ? "While your applications are in progress" : "Before you complete an action"}
    >
      <ul className="grid text-sm leading-6 lg:grid-cols-2 lg:gap-x-8">
        {warnings.map((guidance, index) => (
          <li
            className={cn(
              "flex gap-3 py-3 first:pt-0 last:pb-0",
              index === 0
                ? "border-b border-[var(--consumer-border)] text-base font-semibold lg:col-span-2 lg:pb-3.5"
                : "border-t border-[var(--consumer-border)] lg:border-t-0 lg:pt-3.5",
            )}
            key={guidance}
          >
            <AlertTriangle aria-hidden className="mt-1 size-4 shrink-0 text-[var(--consumer-warning-ink)]" />
            <span className="min-w-0">{guidance}</span>
          </li>
        ))}
      </ul>
    </WorkspaceSection>
  );
}

function FilterToggle({ disabledOpen, onChange, value }: { disabledOpen: boolean; onChange: (value: "open" | "done") => void; value: "open" | "done" }) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const next = value === "open" ? "done" : "open";
    if (next === "open" && disabledOpen) return;
    onChange(next);
    const target = event.currentTarget.querySelector<HTMLButtonElement>(`[data-filter="${next}"]`);
    target?.focus();
  };
  return (
    <div aria-label="Checklist status filter" className="flex gap-1" onKeyDown={onKeyDown} role="radiogroup">
      <Button aria-checked={value === "open"} data-filter="open" disabled={disabledOpen} onClick={() => onChange("open")} role="radio" size="sm" tabIndex={value === "open" ? 0 : -1} variant={value === "open" ? "secondary" : "ghost"}>Open</Button>
      <Button aria-checked={value === "done"} data-filter="done" onClick={() => onChange("done")} role="radio" size="sm" tabIndex={value === "done" ? 0 : -1} variant={value === "done" ? "secondary" : "ghost"}>Completed</Button>
    </div>
  );
}

function ReportControl({
  canceled,
  factor,
  factorKey,
  label = "Report done",
  navigate,
  onReport,
  pending,
  reportingOpen,
  rollup = null,
  small = false,
}: {
  canceled: boolean;
  factor: FactorV1 | null;
  factorKey: string;
  label?: string;
  navigate: (view: NavTarget) => void;
  onReport: (factorKey: string, action: ReportActionV1) => Promise<void>;
  pending: boolean;
  reportingOpen: boolean;
  rollup?: TrackV1["rollup"];
  small?: boolean;
}) {
  const row = factor ? factor.reported : rollup;
  if (canceled) {
    return <Button className="min-h-11" disabled size={small ? "sm" : "default"} variant="outline">Reporting ended</Button>;
  }
  if (row !== null && (row.state === "verifying" || row.state === "verified")) return null;
  if (!reportingOpen) {
    return (
      <Button className="min-h-11" onClick={() => navigate("coach")} size={small ? "sm" : "default"} variant="outline">Tell your funding team</Button>
    );
  }
  const isReported = row !== null && row.state === "reported";
  return (
    <Button
      aria-busy={pending}
      className="min-h-11"
      disabled={pending}
      onClick={() => void onReport(factorKey, isReported ? "undo" : "report")}
      size={small ? "sm" : "default"}
      variant={isReported ? "ghost" : "outline"}
    >
      {pending ? "Saving" : isReported ? "Undo report" : label}
    </Button>
  );
}

function factorKey(factor: FactorV1): string {
  return factor.key;
}

function Track({
  canceled,
  filter,
  kind,
  narrative,
  noAnalysis,
  onInstructions,
  onReport,
  open,
  pendingKey,
  reportingOpen,
  track,
}: {
  canceled: boolean;
  filter: "open" | "done";
  kind: TrackKindV1;
  narrative: ConsumerOptimizationV1["narrative"];
  noAnalysis: boolean;
  onInstructions: (key: keyof typeof INSTRUCTIONS) => void;
  onReport: (factorKey: string, action: ReportActionV1) => Promise<void>;
  open: boolean;
  pendingKey: string | null;
  reportingOpen: boolean;
  track: TrackV1;
}) {
  const desktop = useDesktop();
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const [showVerified, setShowVerified] = useState(false);
  const captionId = useId();
  const summary = trackSummary(track, canceled);
  const label = kind === "personal" ? "Personal credit" : "Business setup";
  const openRows = track.factors.filter((factor) => displayState(factor, track, canceled) !== "verified");
  const showAll = filter === "done" || summary.complete || showVerified || (desktop && openRows.length <= 2 && !summary.complete);
  const visible = showAll ? track.factors : openRows;
  const hidden = track.factors.length - visible.length;
  // A factor that was just verified slides out of the open list rather than vanishing; the row is
  // kept for the length of the exit and then dropped. Under reduced motion it is simply gone.
  const rendered = useLingering(visible, factorKey, 400);
  const isOpen = desktop ? !summary.complete || expanded === true : expanded ?? open;
  /*
   * One row per track renders open on first paint, because the disclosure has no
   * other pre-interaction cue: on touch there is no hover to discover, so a row
   * that has already been opened is the only thing that demonstrates the pattern
   * rather than hinting at it. The row is the first in the rendered order that is
   * "action-needed"; failing that the first that is not verified, checking or
   * reported — the three states nobody actions; failing that none. A canceled
   * account and a track with no analysis get no default-open row: neither has an
   * action to demonstrate, and both already say why in their own copy.
   */
  const defaultOpenKey =
    canceled || noAnalysis
      ? null
      : (visible.find((factor) => displayState(factor, track, canceled) === "action-needed") ??
          visible.find((factor) => {
            const factorState = displayState(factor, track, canceled);
            return factorState !== "verified" && factorState !== "checking" && factorState !== "reported";
          }))?.key ?? null;
  const rollupNote =
    kind === "business" && track.rollup !== null && (track.rollup.state === "reported" || track.rollup.state === "verifying")
      ? `You reported the business profile${track.rollup.at ? ` on ${shortDate(track.rollup.at)}` : ""}. Each factor is checked against it at the next review.`
      : summary.sameDocsLead
        ? `All ${openRows.length === 7 ? "seven" : openRows.length} need your documents.`
        : null;

  return (
    <details
      className="group min-w-0"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
      open={isOpen}
    >
      <summary aria-describedby={captionId} className="cursor-pointer list-none rounded-[8px] [&::-webkit-details-marker]:hidden focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--consumer-accent-ink)]">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-base font-semibold tracking-[-0.015em]">
              {label}
              <span aria-hidden className="size-2 shrink-0 rotate-45 border-b-[1.5px] border-r-[1.5px] border-current opacity-60 transition-transform duration-[var(--duration-quick)] group-open:-rotate-[135deg] group-open:translate-y-0.5 motion-reduce:transition-none lg:hidden" />
            </h3>
            <p className="mt-1 text-[0.68rem] text-muted-foreground" id={captionId}>
              {noAnalysis ? `0 of ${track.total} verified` : summary.caption.map((part, index) => (
                <span key={part}>
                  {index > 0 ? " · " : ""}
                  {index === 0 && summary.attention > 0 ? <b className="font-semibold text-foreground">{part}</b> : part}
                </span>
              ))}
            </p>
            {rollupNote ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{rollupNote}</p> : null}
          </div>
          <TrackPercent pct={summary.pct} />
        </div>
        <div className="mt-3">
          <ProgressBar checkingPct={summary.pctChecking} label={`${label} checklist completion`} pct={summary.pct} />
          {summary.checking > 0 && summary.done === 0 ? (
            <p className="mt-1.5 text-[0.68rem] text-muted-foreground">{summary.pct}% verified · {summary.checking} in review</p>
          ) : null}
        </div>
      </summary>
      <div className="mt-5 divide-y divide-[var(--consumer-border)] border-t border-[var(--consumer-border)]">
        {noAnalysis ? (
          <div className="py-5">
            <p className="text-sm font-semibold">{kind === "personal" ? "Eight factors are read at your first analysis" : "Seven factors are read from your business documents"}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {kind === "personal"
                ? "Personal information, report state, utilization, open accounts, account age, negative items, card limit and inquiries."
                : "Name, industry, entity age, net asset value, identifier, email and website. Upload them in Onboarding & Docs at any time."}
            </p>
          </div>
        ) : rendered.length ? (
          rendered.map(({ item: factor, leaving }) => (
            <div aria-hidden={leaving || undefined} data-motion-leaving={leaving ? "" : undefined} key={factor.key}>
              <FactorRow
                canceled={canceled}
                defaultOpen={factor.key === defaultOpenKey}
                factor={factor}
                narrative={narrative}
                onInstructions={onInstructions}
                onReport={onReport}
                pending={pendingKey === factor.key}
                reportingOpen={reportingOpen}
                suppressLead={summary.sameDocsLead || rollupNote !== null}
                track={track}
              />
            </div>
          ))
        ) : (
          <p className="py-5 text-sm text-muted-foreground">Every known factor in this track is already done.</p>
        )}
        {!showAll && hidden > 0 ? (
          <div className="pt-4">
            <Button className="min-h-11 px-0" onClick={() => setShowVerified(true)} variant="link">Show {hidden} verified</Button>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function TrackPercent({ pct }: { pct: number }) {
  const shown = useCountUp(pct, 900) ?? pct;
  const previous = usePrevious(pct);
  const ticked = previous !== undefined && previous !== pct;
  return <span className="inline-block text-sm font-semibold tabular-nums" data-count-tick={ticked ? "" : undefined} key={ticked ? pct : "rest"}>{shown}%</span>;
}

function FactorRow({
  canceled,
  defaultOpen,
  factor,
  narrative,
  onInstructions,
  onReport,
  pending,
  reportingOpen,
  suppressLead,
  track,
}: {
  canceled: boolean;
  /** Seeds the row's own state once; a manual close then sticks for the session. */
  defaultOpen: boolean;
  factor: FactorV1;
  narrative: ConsumerOptimizationV1["narrative"];
  onInstructions: (key: keyof typeof INSTRUCTIONS) => void;
  onReport: (factorKey: string, action: ReportActionV1) => Promise<void>;
  pending: boolean;
  reportingOpen: boolean;
  suppressLead: boolean;
  track: TrackV1;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const state = displayState(factor, track, canceled);
  const tone = toneFor(state);
  const owner = ownerOf(factor.key);
  // The narrative's own note for this item wins over the template line, because it was written
  // about this person's numbers. The template stays the fallback rather than the loser: a
  // narrative writes notes only for the items it had something to say about.
  const signal = narrativeNoteFor(narrative, factor) ?? signalCopy(factor);
  const lead =
    state === "verified" || state === "checking" || state === "reported" || suppressLead || canceled
      ? null
      : OWNER_LABEL_V1[owner];
  const receipt =
    factor.reported !== null && factor.reported.state !== "todo"
      ? `${factor.reported.state === "verified" ? "Verified" : factor.reported.state === "verifying" ? "Being verified" : "Reported"}${factor.reported.at ? ` ${shortDate(factor.reported.at)}` : ""}${factor.reported.state === "reported" ? " · checked at the next source check" : ""}`
      : null;
  const isYou = owner === "you" && factor.key === "utilization_under_30";
  const showControls = isYou && state !== "verified";
  // The mark pops once when this row becomes verified while on screen; a row that mounts verified
  // is simply verified.
  const previousState = usePrevious(state);
  const justVerified = state === "verified" && previousState !== undefined && previousState !== "verified";

  return (
    /*
     * group/factor, not the bare group the enclosing TrackSection <details>
     * already uses: an unnamed group-open: matches any open ancestor, so with
     * the track expanded every closed row's chevron rendered pre-rotated —
     * pointing up, the "collapse" direction — which is the one thing the cue
     * must never say.
     */
    /*
     * The open row recesses into a well rather than rising into a card: it is
     * containment, not emphasis. The border is present and transparent at rest so
     * opening changes two colours and no geometry — a border that appeared on open
     * would shift every row below it by 2px. The closed row's hairline is stated
     * here rather than left to the list's `divide-y`, whose `:where()` selector
     * carries no specificity and so loses to the transparent border above it.
     */
    /*
     * The `id` is the link target a narrative step points at. It is on the row rather than on the
     * title so the whole disclosure, open or closed, is what the page scrolls to; `scroll-mt`
     * keeps the row clear of the sticky header it would otherwise land under.
     */
    <details
      className="group/factor scroll-mt-24 rounded-[8px] border border-transparent py-2 not-open:not-last:border-b-[var(--consumer-border)] open:border-[var(--consumer-surface-border)] open:bg-[color-mix(in_srgb,var(--consumer-muted),transparent_96%)]"
      id={factorAnchorId(factor.key)}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
      open={isOpen}
    >
      {/*
        The hover cue is scoped to the summary's own group, not the row's: the
        details element includes the open body, and hovering a subtask must not
        light the chevron as though the control were under the cursor.
      */}
      <summary className="group/summary grid min-h-12 cursor-pointer list-none grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-[8px] px-2 py-1.5 transition-colors duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)] [&::-webkit-details-marker]:hidden hover:bg-[var(--muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--consumer-accent-ink)] group-open/factor:hover:bg-[color-mix(in_srgb,var(--consumer-muted),transparent_90%)] motion-reduce:transition-none sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:gap-y-0">
        <span className="contents" data-mark-pop={justVerified ? "" : undefined}><StateMarker size="sm" state={markerFor(state)} /></span>
        <p className="min-w-0 text-sm font-medium">{factor.title}</p>
        {/*
          Only the neutral chip is restyled, and only because its canvas fill is
          the one that dissolves into the hover wash and the open well; the toned
          chips already carry their own fill. The icon goes wherever the marker
          beside it already shows the same glyph — at fifteen rows the duplicates
          were half the noise — except on warning, where the triangle is the
          state's second non-colour channel.
        */}
        <StatusTag
          className={cn(
            "col-start-2 row-start-2 justify-self-start sm:col-start-3 sm:row-start-1 sm:justify-self-end",
            tone === "neutral" && "border-[var(--consumer-surface-border)] bg-card",
          )}
          icon={tone === "warning" ? undefined : false}
          tone={tone}
        >
          {DISPLAY_STATE_LABEL_V1[state]}
        </StatusTag>
        <ChevronDown
          aria-hidden
          className="col-start-3 row-start-1 size-[18px] shrink-0 text-[var(--consumer-muted)] transition-[color,transform] duration-200 ease-[var(--ease-smooth-out)] group-hover/summary:text-foreground group-open/factor:rotate-180 group-open/factor:text-foreground motion-reduce:transition-none sm:col-start-4 sm:-ml-1.5 sm:size-4"
        />
      </summary>
      {/*
        The reveal is scoped in rather than turned off: `motion-reduce:animate-none`
        is a single class and loses on specificity to a `group-open/factor:` rule,
        so under reduced motion the animation would have run anyway. Gated behind
        `motion-safe:`, the rule does not exist there at all.
      */}
      <div className="px-2 pb-3 motion-safe:group-open/factor:animate-[mf-disclosure-reveal_180ms_var(--ease-smooth-out)] sm:pl-11">
        <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
          {lead ? <b className="font-semibold text-foreground">{lead}. </b> : null}
          {signal || "Open this factor with your funding team to confirm what is already on file and what the next source check must verify."}
        </p>
        {receipt ? <p className="mt-1 text-[0.68rem] text-muted-foreground">{receipt}</p> : null}
        {factor.children.length ? (
          <div className="mt-3 border-l border-[var(--consumer-border)] pl-4">
          <p className="mb-3 text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{factor.children.length === 1 ? "Subtask" : "Subtasks"}</p>
          <div className="divide-y divide-[var(--consumer-border)]">
            {factor.children.map((child) => (
              <div className="flex items-start gap-3 py-3 first:pt-0 last:pb-0" key={child.key}>
                <StateMarker size="sm" state="todo" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-xs font-medium">
                    {child.accountRef}
                    <StatusTag tone="warning">Action needed</StatusTag>
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Reports at {child.observedUtilizationPct}% of its limit; the target is under {UTILIZATION_TARGET_PCT}%.</p>
                  <p className="mt-1 text-[0.68rem] text-muted-foreground">TBD duration</p>
                </div>
              </div>
            ))}
          </div>
          </div>
        ) : null}
        {showControls ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button className="min-h-11" onClick={() => onInstructions("utilization_under_30")} size="sm" variant="outline">Instructions</Button>
          <ReportControl
            canceled={canceled}
            factor={factor}
            factorKey={factor.key}
            navigate={() => undefined}
            onReport={onReport}
            pending={pending}
            reportingOpen={reportingOpen}
            small
          />
        </div>
        ) : null}
      </div>
    </details>
  );
}

function UtilizationSection({ analysisAt, canceled, data }: { analysisAt: string | null; canceled: boolean; data: ConsumerOptimizationV1 }) {
  const utilization = data.utilization;
  const overall = utilization?.overallPct ?? null;
  const over = overall !== null && overall >= UTILIZATION_TARGET_PCT;
  const accounts = utilization ? sortedUtilizationAccounts(utilization.accounts) : [];
  const hasChildren = data.tracks.personal.factors.some((factor) => factor.key === "utilization_under_30" && factor.children.length > 0);

  return (
    <WorkspaceSection className="mt-5" description="Derived from your last authorized analysis. Balances and limits are not shown here." title="Revolving utilization">
      {overall === null ? (
        <div className="rounded-[8px] bg-[var(--consumer-canvas)] px-4 py-4">
          <p className="text-sm font-semibold">No utilization figure is recorded</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{canceled ? "Your analysis ended without a revolving figure and no further checks will run." : "Your last analysis did not record a revolving figure. The next source check adds it."}</p>
        </div>
      ) : (
        <div className="grid items-end gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] md:gap-x-10">
          <div>
            <p className="text-[0.68rem] text-muted-foreground">Overall revolving utilization</p>
            <p className="mt-1 flex flex-wrap items-baseline gap-2.5">
              <b className="text-[2.25rem] font-semibold leading-none tracking-[-0.035em] tabular-nums">{overall}%</b>
              <span className="text-sm text-muted-foreground">{over ? `above the ${UTILIZATION_TARGET_PCT}% target` : `under the ${UTILIZATION_TARGET_PCT}% target`}</span>
            </p>
          </div>
          <div>
            <div aria-label={`Overall revolving utilization, ${overall} percent, target under ${UTILIZATION_TARGET_PCT} percent`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={overall} className="relative h-1.5 rounded-full bg-[var(--consumer-border)]" role="progressbar">
              <span className={cn("absolute inset-y-0 left-0 rounded-full", over ? "bg-[var(--consumer-warning-border)]" : "bg-[var(--consumer-accent-ink)]")} style={{ width: `${Math.min(overall, 100)}%` }} />
              <span aria-hidden className="absolute -top-1 bottom-[-4px] w-px bg-foreground/60" style={{ left: `${UTILIZATION_TARGET_PCT}%` }} />
            </div>
            <div className="mt-1.5 flex justify-between text-[0.68rem] text-muted-foreground"><span>0%</span><span>{UTILIZATION_TARGET_PCT}% target</span><span>100%</span></div>
          </div>
        </div>
      )}
      {accounts.length ? (
        <div className="mt-5 divide-y divide-[var(--consumer-border)] border-t border-[var(--consumer-border)]">
          {accounts.map((account) => (
            <div className="grid grid-cols-[minmax(0,1fr)_3.5rem] items-center gap-x-4 gap-y-2 py-3 sm:grid-cols-[minmax(9rem,0.6fr)_minmax(0,1.4fr)_3.5rem]" key={account.accountRef}>
              <span className="text-sm font-medium">{account.accountRef}</span>
              <div className="relative col-span-2 h-1.5 rounded-full bg-[var(--consumer-border)] sm:col-span-1">
                <span className={cn("absolute inset-y-0 left-0 rounded-full", account.overTarget ? "bg-[var(--consumer-warning-border)]" : "bg-[var(--consumer-accent-ink)]")} style={{ width: `${Math.min(account.utilizationPct ?? 0, 100)}%` }} />
                <span aria-hidden className="absolute -top-1 bottom-[-4px] w-px bg-foreground/60" style={{ left: `${UTILIZATION_TARGET_PCT}%` }} />
              </div>
              <span className="row-start-1 text-right text-sm font-semibold tabular-nums sm:row-start-auto">{account.utilizationPct === null ? "—" : `${account.utilizationPct}%`}</span>
            </div>
          ))}
          {hasChildren ? <p className="pt-3 text-xs leading-5 text-muted-foreground">The controls for the accounts above {UTILIZATION_TARGET_PCT}% are under <b className="font-semibold">Utilization under 30%</b> in the checklist.</p> : null}
        </div>
      ) : overall !== null ? (
        <div className="mt-5 rounded-[8px] bg-[var(--consumer-canvas)] px-4 py-4">
          <p className="text-sm font-semibold">{canceled ? "Account-level detail is not available" : "Account-level detail arrives with your next check"}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {canceled
              ? `Your analysis ended${analysisAt ? ` on ${analysisAt}` : ""} with the overall figure only, and no further checks will run.`
              : `Your ${analysisAt ?? "latest"} analysis stored the overall figure only. The next source check adds a row per revolving account, utilization only.`}
          </p>
        </div>
      ) : null}
      <SourceStamp className="mt-4 border-t border-[var(--consumer-border)] pt-3.5">Account names and full monitoring values live in Credit Monitoring.</SourceStamp>
    </WorkspaceSection>
  );
}

function LoadingState() {
  return (
    <div aria-busy="true" aria-label="Loading your optimization plan">
      <Panel className="grid xl:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.9fr)]">
        <div className="p-5 sm:p-7">
          <Skeleton className="h-3 w-36" />
          <Skeleton className="mt-4 h-7 w-3/5" />
          <Skeleton className="mt-4 h-3 w-4/5" />
          <Skeleton className="mt-2 h-3 w-3/5" />
          <Skeleton className="mt-5 h-11 w-32 rounded-[8px]" />
        </div>
        <div className="border-t border-[var(--consumer-border)] bg-[var(--consumer-panel,var(--consumer-canvas))] p-5 xl:border-l xl:border-t-0 xl:p-7">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="mt-3 h-8 w-32" />
          {[0, 1, 2, 3, 4, 5, 6].map((row) => <Skeleton className="mt-3 h-3" key={row} />)}
        </div>
      </Panel>
      <WorkspaceSection className="my-5" description="Educational guidance for the current optimization plan." title="Before you complete an action">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="mt-3 h-4 w-4/5" />
        <Skeleton className="mt-3 h-4 w-3/5" />
      </WorkspaceSection>
      <WorkspaceSection description="Funding can start when both checklists are complete and verified at 100." title="Cinderella profile">
        <div className="grid gap-8 lg:grid-cols-2 lg:gap-x-10">
          {[8, 7].map((rows) => (
            <div key={rows}>
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-2 h-3 w-48" />
              <Skeleton className="mt-3 h-1.5" />
              {Array.from({ length: rows }, (_, index) => (
                <div className="flex items-center gap-3 border-b border-[var(--consumer-border)] py-3.5" key={index}>
                  <Skeleton className="size-6 rounded-full" />
                  <Skeleton className="h-3 flex-1" />
                  <Skeleton className="h-5 w-20" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </WorkspaceSection>
    </div>
  );
}
