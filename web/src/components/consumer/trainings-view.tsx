"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronRight, ExternalLink, Play, Text, TriangleAlert } from "lucide-react";

import {
  ConsumerPageHeader,
  SourceStamp,
  StatusTag,
  WorkspaceSection,
} from "@/components/consumer/consumer-kit";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toEmbedUrl } from "@/lib/ancillary/video-embed";
import { TRACKER_STAGES, TRACKER_STAGE_LABELS, type TrackerStage } from "@/lib/tracker/types";
import { cn } from "@/lib/utils";

/**
 * The consumer Trainings view.
 *
 * Everything on the page comes from two reads that exist: `GET /api/trainings`, which
 * returns the published client-audience rows the consumer's own operator wrote, and the
 * stage on the consumer's tracker row. A training row is one title, one body and one
 * video URL. It carries no duration, no category, no ordering and no per-consumer
 * progress, and no table anywhere records a completed lesson, so this view renders none
 * of those: the only facet drawn is VIDEO or READ, derived from whether the row has a
 * video URL. The stage list is a position marker read from the tracker, not a ladder of
 * lessons that unlock, because no training row carries a stage.
 *
 * Named `ConsumerTrainingsView` rather than `TrainingsView` because the platform admin
 * surface already declares a `TrainingsView`, and two guards in
 * `flag-latent-eviction.test.ts` locate that one by requiring exactly one module under
 * `web/src` to declare the name. A second declaration would defeat their locator, so the
 * consumer's copy carries the surface in its name the way `ConsumerPageHeader` and
 * `ConsumerTeamChat` do.
 */

/** One published lesson, exactly the fields the read path returns. */
export type TrainingLesson = {
  body: string;
  id: string;
  title: string;
  videoUrl: string | null;
};

export type TrainingsStatus = "error" | "idle" | "loading" | "ready";

/** Views this page can send someone to, so every link is real navigation. */
type NavTarget = "coach" | "credit" | "documents" | "optimization" | "plan" | "settings";

/**
 * What each stage is and where the work for it lives. Authored product copy, keyed on the
 * one stage taxonomy, and deliberately about the plan rather than about a lesson: nothing
 * is published or unlocked when a stage moves.
 */
const STAGE_GUIDE: Readonly<Record<TrackerStage, { blurb: string; label: string; target: NavTarget }>> = {
  applying: {
    blurb: "Applications are going out in sequence. Your Funding tracks each one and what to have in hand.",
    label: "Your Funding",
    target: "plan",
  },
  funded: {
    blurb: "New accounts are reporting. Credit Monitoring shows how they appear on each file.",
    label: "Credit Monitoring",
    target: "credit",
  },
  graduate: {
    blurb: "Your plan has reached its last stage. Account & Billing holds your records and invoices.",
    label: "Account & Billing",
    target: "settings",
  },
  onboarding: {
    blurb: "Your authorizations, e-signature and identity check are being completed. Onboarding & Docs shows what is still open.",
    label: "Onboarding & Docs",
    target: "documents",
  },
  optimization: {
    blurb: "Your checklist factors are being worked and verified. Optimization explains each factor and how utilization is reported.",
    label: "Optimization",
    target: "optimization",
  },
  ready: {
    blurb: "Your verified snapshot is being compared with published lender criteria. Your Funding shows each match and what it does and does not tell you.",
    label: "Your Funding",
    target: "plan",
  },
};

const VISIBLE_BEFORE_EXPAND = 6;

/** The first sentence of the body, which is the only excerpt a training row can honestly carry. */
export function lessonExcerpt(body: string): string {
  const trimmed = body.trim();
  const end = trimmed.search(/[.!?](\s|$)/);
  return end === -1 ? trimmed : trimmed.slice(0, end + 1);
}

export function ConsumerTrainingsView({
  canceled,
  durableWorkspace,
  fixtureLessons,
  navigate,
  onReload,
  platformTrainingsUrl,
  stage,
  status,
  trainings,
}: {
  canceled: boolean;
  durableWorkspace: boolean;
  fixtureLessons: readonly TrainingLesson[];
  navigate: (view: NavTarget) => void;
  onReload: () => void;
  platformTrainingsUrl: string | null;
  stage: TrackerStage;
  status: TrainingsStatus;
  trainings: readonly TrainingLesson[] | null;
}) {
  const scope = useId();
  const [openId, setOpenId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const pendingFocus = useRef<string | null>(null);

  // Focus follows the control that moved: into the lesson body when a row opens,
  // back onto the row when it closes, and onto the seventh row when the list grows.
  useEffect(() => {
    const target = pendingFocus.current;
    pendingFocus.current = null;
    if (!target) return;
    const node = document.getElementById(target);
    if (!node) return;
    node.focus();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "nearest" });
  });

  const rowId = (id: string) => `${scope}-row-${id}`;
  const bodyId = (id: string) => `${scope}-body-${id}`;
  const titleId = (id: string) => `${scope}-title-${id}`;
  const kindId = (id: string) => `${scope}-kind-${id}`;

  const lessons: readonly TrainingLesson[] = durableWorkspace ? trainings ?? [] : fixtureLessons;
  const showRows = durableWorkspace ? status === "ready" && lessons.length > 0 : lessons.length > 0;
  const visible = expanded ? lessons : lessons.slice(0, VISIBLE_BEFORE_EXPAND);
  const remaining = lessons.length - visible.length;

  function toggle(id: string) {
    const next = openId === id ? null : id;
    setOpenId(next);
    pendingFocus.current = next === null ? rowId(id) : bodyId(id);
  }

  function lessonRow(lesson: TrainingLesson) {
    const open = openId === lesson.id;
    const video = Boolean(lesson.videoUrl);
    const embedUrl = toEmbedUrl(lesson.videoUrl);
    return (
      <li className="border-t border-[var(--consumer-border)] first:border-t-0" key={lesson.id}>
        <button
          aria-controls={bodyId(lesson.id)}
          aria-expanded={open}
          aria-labelledby={`${titleId(lesson.id)} ${kindId(lesson.id)}`}
          className="grid min-h-[4.25rem] w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-start gap-3 rounded-[8px] py-3 text-left transition-colors duration-150 hover:bg-[var(--consumer-canvas)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--consumer-accent-ink)] motion-reduce:transition-none"
          id={rowId(lesson.id)}
          onClick={() => toggle(lesson.id)}
          type="button"
        >
          <span
            aria-hidden
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-[8px]",
              open
                ? "bg-[var(--consumer-accent-tint)] text-[var(--consumer-accent-ink)]"
                : "bg-[var(--consumer-canvas)] text-muted-foreground",
            )}
          >
            {video ? <Play className="size-3.5" /> : <Text className="size-3.5" />}
          </span>
          <span className="min-w-0">
            <span
              className="block text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
              id={kindId(lesson.id)}
            >
              {video ? "VIDEO" : "READ"}
            </span>
            <span
              className={cn("mt-0.5 block text-[0.86rem] leading-snug", open ? "font-semibold" : "font-medium")}
              id={titleId(lesson.id)}
            >
              {lesson.title}
            </span>
            {open ? null : (
              <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">
                {lessonExcerpt(lesson.body)}
              </span>
            )}
          </span>
          <span className="inline-flex items-center gap-1 pt-0.5 text-xs font-semibold text-[var(--consumer-accent-ink)]">
            {open ? "Close" : "Open"}
            <ChevronRight
              aria-hidden
              className={cn(
                "size-3.5 transition-transform duration-150 motion-reduce:transition-none",
                open && "rotate-90",
              )}
            />
          </span>
        </button>
        <div
          aria-labelledby={titleId(lesson.id)}
          className="pb-4 pl-11 pr-1"
          hidden={!open}
          id={bodyId(lesson.id)}
          role="region"
          tabIndex={-1}
        >
          {open ? (
            <>
              {embedUrl ? (
                <div className="relative mb-3 aspect-video w-full max-w-[20rem] overflow-hidden rounded-[8px] bg-[var(--consumer-rail)] sm:max-w-[34rem]">
                  <iframe
                    allow="fullscreen"
                    className="absolute inset-0 size-full border-0"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    sandbox="allow-scripts allow-same-origin allow-presentation"
                    src={embedUrl}
                    title={lesson.title}
                  />
                </div>
              ) : null}
              {lesson.videoUrl ? (
                <a
                  className="inline-flex min-h-11 items-center gap-1.5 text-[0.8rem] font-semibold text-[var(--consumer-accent-ink)] underline underline-offset-[3px]"
                  href={lesson.videoUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open the video in a new tab
                  <ExternalLink aria-hidden className="size-3.5" />
                </a>
              ) : null}
              <p className="max-w-[62ch] text-[0.86rem] leading-relaxed">{lesson.body}</p>
            </>
          ) : null}
        </div>
      </li>
    );
  }

  function lessonsBody() {
    if (status === "loading" && durableWorkspace) {
      // The same row geometry in flat neutrals, and no shimmer: a moving placeholder
      // implies the page knows something is coming, which a read in flight does not.
      return (
        <div aria-hidden>
          {[0, 1, 2].map((row) => (
            <div
              className="grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-3 border-t border-[var(--consumer-border)] py-3.5 first:border-t-0"
              key={row}
            >
              <Skeleton className="size-8 rounded-[8px]" />
              <div>
                <Skeleton className="h-2 w-1/3" />
                <Skeleton className="mt-2 h-2 w-4/5" />
                <Skeleton className="mt-2 h-2 w-3/5" />
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (status === "error" && durableWorkspace) {
      return (
        <div
          className="rounded-[8px] border border-[var(--consumer-warning-border)] bg-[color-mix(in_srgb,var(--consumer-warning),transparent_88%)] px-4 py-3.5 text-[var(--consumer-warning-ink)]"
          role="alert"
        >
          <h3 className="flex items-center gap-1.5 text-[0.86rem] font-semibold">
            <TriangleAlert aria-hidden className="size-4 shrink-0" />
            The lesson list did not load
          </h3>
          <p className="mt-1.5 max-w-[58ch] text-[0.8rem] leading-5">
            Your plan stages are unaffected. Reload, and if it still fails, ask in Team Chat.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 gap-x-5">
            <Button className="min-h-11" onClick={onReload} type="button" variant="outline">
              Reload
            </Button>
            <button
              className="inline-flex min-h-11 items-center gap-1 text-[0.8rem] font-semibold text-[var(--consumer-warning-ink)] underline underline-offset-[3px]"
              onClick={() => navigate("coach")}
              type="button"
            >
              Ask in Team Chat
              <ChevronRight aria-hidden className="size-3.5" />
            </button>
          </div>
        </div>
      );
    }

    if (!showRows) {
      return (
        <div>
          <p className="max-w-[56ch] text-[0.86rem] leading-relaxed text-muted-foreground">
            Your funding team has not published a lesson to your workspace so far. Team Chat answers questions about
            your plan in the meantime.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2 gap-x-5">
            <Button className="min-h-11" onClick={() => navigate("coach")} type="button">
              Ask in Team Chat
            </Button>
            {platformTrainingsUrl ? (
              <a
                className="inline-flex min-h-11 items-center gap-1.5 text-[0.8rem] font-semibold text-[var(--consumer-accent-ink)] underline underline-offset-[3px]"
                href={platformTrainingsUrl}
                rel="noreferrer"
                target="_blank"
              >
                Platform trainings library (opens in a new tab)
                <ExternalLink aria-hidden className="size-3.5" />
              </a>
            ) : null}
          </div>
        </div>
      );
    }

    return (
      <>
        <ul>{visible.map((lesson) => lessonRow(lesson))}</ul>
        {remaining > 0 ? (
          <button
            className="mt-3 inline-flex min-h-11 items-center text-xs font-semibold text-[var(--consumer-accent-ink)] underline underline-offset-[3px]"
            onClick={() => {
              setExpanded(true);
              const next = lessons[VISIBLE_BEFORE_EXPAND];
              if (next) pendingFocus.current = rowId(next.id);
            }}
            type="button"
          >
            Show {remaining} more
          </button>
        ) : null}
      </>
    );
  }

  const currentIndex = TRACKER_STAGES.indexOf(stage);

  return (
    <div>
      <ConsumerPageHeader title="Trainings" />
      <p className="mb-5 max-w-[65ch] text-[0.86rem] leading-relaxed text-muted-foreground">
        Short lessons on the mechanics behind your plan: how accounts report, what lender criteria compare, and what
        to have ready before you apply.
      </p>
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_20rem] md:items-start">
        <WorkspaceSection
          description={
            canceled
              ? "Published by your funding team. Still readable after cancellation."
              : "Published to your workspace by your funding team."
          }
          title="From your funding team"
          trailing={
            showRows ? (
              <StatusTag icon={false} tone="neutral">
                {lessons.length} {lessons.length === 1 ? "lesson" : "lessons"}
              </StatusTag>
            ) : null
          }
        >
          {lessonsBody()}
        </WorkspaceSection>

        {canceled ? (
          <WorkspaceSection title="Plan closed">
            <p className="text-[0.8rem] leading-relaxed text-muted-foreground">
              Lessons your funding team published stay readable; plan data was deleted at cancellation.
            </p>
          </WorkspaceSection>
        ) : (
          <WorkspaceSection description="Set by your funding team from your tracker." title="Your plan stages">
            <ol>
              {TRACKER_STAGES.map((entry, index) => {
                const now = index === currentIndex;
                const past = index < currentIndex;
                const guide = STAGE_GUIDE[entry];
                return (
                  <li
                    aria-current={now ? "step" : undefined}
                    className="relative grid grid-cols-[1.5rem_minmax(0,1fr)] gap-3 pb-3.5 last:pb-0"
                    key={entry}
                  >
                    {index < TRACKER_STAGES.length - 1 ? (
                      <span
                        aria-hidden
                        className="absolute bottom-0 left-[11px] top-6 w-px bg-[var(--consumer-border)]"
                      />
                    ) : null}
                    <span
                      aria-hidden
                      className={cn(
                        "relative z-[1] grid size-6 place-items-center rounded-full",
                        now
                          ? "border-2 border-[var(--consumer-accent-ink)] bg-[var(--consumer-accent-tint)]"
                          : past
                            ? "border border-[var(--consumer-muted)] bg-[var(--consumer-muted)]"
                            : "border border-[var(--consumer-border)] bg-card",
                      )}
                    >
                      <span
                        className={cn(
                          "size-[7px] rounded-full",
                          now
                            ? "bg-[var(--consumer-accent-ink)]"
                            : past
                              ? "bg-card"
                              : "bg-[var(--consumer-border)]",
                        )}
                      />
                    </span>
                    <div className="min-w-0 pt-px">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "text-[0.86rem]",
                            now ? "font-semibold" : "font-medium text-muted-foreground",
                          )}
                        >
                          {TRACKER_STAGE_LABELS[entry]}
                        </span>
                        {now ? (
                          <StatusTag icon={false} tone="info">
                            Now
                          </StatusTag>
                        ) : null}
                      </div>
                      {now ? (
                        <>
                          <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{guide.blurb}</p>
                          <button
                            className="mt-1 inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-[var(--consumer-accent-ink)] underline underline-offset-[3px]"
                            onClick={() => navigate(guide.target)}
                            type="button"
                          >
                            Open {guide.label}
                            <ChevronRight aria-hidden className="size-3.5" />
                          </button>
                        </>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          </WorkspaceSection>
        )}
      </div>
      <SourceStamp className="mt-5">Educational content · not a credit decision</SourceStamp>
    </div>
  );
}
