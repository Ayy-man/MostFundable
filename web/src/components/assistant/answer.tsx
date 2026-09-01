"use client";

// One exchange: the question as a heading, the answer as a headline, bullets and a sources row.
//
// The composition is deliberate and it is not a chat bubble. There is no second person in this
// pane — nobody to attribute a bubble to, no avatar that would be honest — and a thread of bubbles
// with the machine on one side is how an assistant starts reading as a teammate, which rail 6
// forbids. So a question is a section heading and its answer is the body under it, separated from
// the next exchange by a hairline. That is also the shape the reference this is judged against uses,
// and it survives a long answer far better than a bubble does.
//
// The assistant's identity is the navy mark above each answer: Deep Navy is the assistant's colour
// on every surface (DESIGN.md) and appears nowhere else in this view, so "a machine wrote this" is
// carried by the same token everywhere in the product rather than by a word somebody remembered to
// type.
//
// `<AssistantAnswerBlock>` prints an `AssistantAnswerView` and computes nothing. That is what keeps
// the not-advice footer from being a call somebody forgets: it is a field on the view, and
// `answer-view.test.ts` asserts that every field of a built view is read in this file.

import { Building2, ChartNoAxesColumn, FileText, Landmark, Sparkles, UserRound } from "lucide-react";

import { ThinkingOrb, orbActivity } from "@/components/chat/thinking-orb";
import { cn } from "@/lib/utils";

import { elapsedSeconds, ELAPSED_VISIBLE_AFTER_MS, stageLabel } from "./stages";

import type { AssistantAnswerView } from "./answer-view";
import type { AssistantScope, AssistantSource, AssistantSourceKind, AssistantStage } from "@/lib/assistant/types";
import type { LucideIcon } from "lucide-react";

/**
 * A glyph per source kind, so the row has a second channel besides the label's own prefix.
 *
 * `Record<AssistantSourceKind, …>` rather than a lookup with a fallback: a sixth kind added to the
 * contract should stop the build here, not render as a chip with no mark on it.
 */
const SOURCE_ICONS: Readonly<Record<AssistantSourceKind, LucideIcon>> = {
  article: FileText,
  bank: Landmark,
  client: UserRound,
  metric: ChartNoAxesColumn,
  operator: Building2,
};

const CHIP =
  "inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-1 text-xs font-medium text-[var(--secondary-foreground)]";

/**
 * A source chip: a human label and a glyph, and no destination.
 *
 * F-06. `KbCitation` has no `url` field any more — the server has no help page to point at, and a
 * citation that carries no destination is one no render site can turn into a live anchor by
 * reaching for the nearest field. So this is a `<span>` unless the surface passed a handler, in
 * which case it is a real button that opens the peek the caller already holds. `source.ref` is the
 * opaque handle: it goes back to the caller and never into the DOM.
 */
function SourceChip({
  source,
  onOpen,
}: {
  readonly source: AssistantSource;
  readonly onOpen?: (source: AssistantSource) => void;
}) {
  const Icon = SOURCE_ICONS[source.kind];
  const inner = (
    <>
      <Icon aria-hidden className="size-3.5 shrink-0 text-[var(--success)]" />
      <span className="truncate">{source.label}</span>
    </>
  );
  if (onOpen === undefined) {
    return <span className={CHIP}>{inner}</span>;
  }
  return (
    <button
      className={cn(
        CHIP,
        "min-h-11 cursor-pointer transition-colors duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)] hover:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-1 sm:min-h-9",
      )}
      onClick={() => onOpen(source)}
      type="button"
    >
      {inner}
    </button>
  );
}

/** The navy mark that says a machine wrote what follows. */
function AssistantMark() {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="grid size-6 shrink-0 place-items-center rounded-md bg-[var(--assistant-ground)]">
        <Sparkles aria-hidden className="size-3.5 text-[var(--accent-on-dark)]" />
      </span>
      <span className="text-xs font-medium text-muted-foreground">Assistant</span>
    </span>
  );
}

export function AssistantQuestion({ text }: { readonly text: string }) {
  return (
    <h3 className="text-[1.0625rem] font-semibold leading-7 text-foreground">{text}</h3>
  );
}

export function AssistantAnswerBlock({
  answer,
  onOpenSource,
}: {
  readonly answer: AssistantAnswerView;
  readonly onOpenSource?: (source: AssistantSource) => void;
}) {
  return (
    <div className="space-y-3">
      <AssistantMark />
      <p className="max-w-[44rem] text-[0.9375rem] leading-6 text-foreground">{answer.headline}</p>
      {answer.bullets.length > 0 ? (
        <ul className="max-w-[44rem] space-y-2">
          {answer.bullets.map((bullet, index) => (
            <li className="flex gap-2.5 text-[0.9375rem] leading-6 text-foreground" key={index}>
              <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-[var(--success)]" />
              <span className="min-w-0">{bullet}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {answer.sources.length > 0 ? (
        <div className="space-y-1.5 pt-1">
          <p className="text-[0.6875rem] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Sources
          </p>
          <div className="flex flex-wrap gap-1.5">
            {answer.sources.map((source) => (
              <SourceChip key={`${source.kind}:${source.label}`} onOpen={onOpenSource} source={source} />
            ))}
          </div>
        </div>
      ) : null}
      {answer.footer === null ? null : (
        <p className="max-w-[44rem] pt-1 text-xs leading-5 text-muted-foreground">{answer.footer}</p>
      )}
    </div>
  );
}

/**
 * The wait, held honestly for as long as it takes.
 *
 * F-10 measured a supervised answer at 14 to 16.5 seconds and the pipeline cannot stream (contract
 * §0 R1), so this block is the entire interface for that time. Three decisions carry it:
 *
 * The label is `stage` off the server's stream and nothing else. `orbActivity` refuses to build an
 * activity without a live source, and its own fallback — "Working on your answer" — covers the
 * moment before the first stage line arrives. Nothing here advances a stage on a timer.
 *
 * The elapsed seconds appear only after {@link ELAPSED_VISIBLE_AFTER_MS}, and they are a
 * measurement rather than a prediction. `drafting` sits still for ten seconds or more, and a
 * counter that is visibly moving is the difference between a long wait and a hang. It is
 * `aria-hidden` because a live region announcing a new number every second is not an improvement
 * for anybody.
 *
 * The sentence under it says why the wait exists. It is constant copy, true of every answer this
 * product gives, and it is the honest thing to put in the space rather than a progress bar for work
 * whose length nobody knows.
 */
export function AssistantThinking({
  open,
  scope,
  stage,
  startedAtMs,
  nowMs,
}: {
  /** Whether the stage stream is genuinely open. Bound to state; never a literal. */
  readonly open: boolean;
  readonly scope: AssistantScope;
  readonly stage: AssistantStage | null;
  readonly startedAtMs: number;
  readonly nowMs: number;
}) {
  const activity = orbActivity({
    kind: "assistant",
    stage: stage === null ? null : stageLabel(scope, stage),
    streamOpen: open,
  });
  // `orbActivity` returns null the moment the stream is not open, so this component removes itself
  // rather than needing a caller to remember to stop rendering it.
  if (activity === null) return null;
  // Clamped, because the clock reads zero until its first tick and a wait cannot be negative.
  const waited = Math.max(0, nowMs - startedAtMs);
  return (
    <div className="space-y-2">
      <AssistantMark />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <ThinkingOrb activity={activity} ground="light" size="md" />
        {waited >= ELAPSED_VISIBLE_AFTER_MS ? (
          <span aria-hidden className="text-xs tabular-nums text-muted-foreground">
            {elapsedSeconds(startedAtMs, nowMs)}s
          </span>
        ) : null}
      </div>
      <p className="max-w-[36rem] text-xs leading-5 text-muted-foreground">
        Every answer is checked against policy before it appears, so nothing is shown until the
        check has finished.
      </p>
    </div>
  );
}
