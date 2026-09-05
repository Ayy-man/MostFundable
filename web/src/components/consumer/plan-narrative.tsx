"use client";

import { SourceStamp } from "@/components/consumer/consumer-kit";
import { planNarrativeProps } from "@/lib/optimization/narrative-view";

import type { ConsumerOptimizationV1 } from "@/lib/optimization/types";

/**
 * "Your plan" — the latest analysis said in words rather than in states.
 *
 * Everything on it is `plans.narrative`, written by a model about the same facts the checklist
 * below shows and admitted only after a grounding check and the read's own strict guard. Nothing
 * here is computed: the card cannot disagree with the factor rows because it never derives
 * anything from them, it only points at them.
 *
 * When there is no narrative the card renders NOTHING. Not an empty shell, not a "your plan is
 * being written" placeholder — a consumer whose generation failed has no action to take about it,
 * and a box that says so is a box that only ever reports our own trouble to them.
 */
export function PlanNarrative({ view }: { view: ConsumerOptimizationV1 }) {
  const plan = planNarrativeProps(view);
  if (plan === null) return null;

  return (
    <section
      aria-labelledby="plan-narrative-h"
      className="mb-5 overflow-hidden rounded-[10px] border border-[var(--consumer-surface-border,var(--consumer-border))] bg-card"
    >
      <div className="p-5 sm:p-7">
        <p className="flex items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          <span
            aria-hidden
            className="size-2 rounded-full bg-[var(--consumer-accent)] shadow-[0_0_0_3px_var(--consumer-accent-tint)]"
          />
          Your plan
        </p>
        <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em] text-balance" id="plan-narrative-h">
          {plan.verdict}
        </h2>
        <p className="mt-3 max-w-[60ch] text-sm leading-6 text-muted-foreground">{plan.whereYouStand}</p>

        {plan.steps.length ? (
          <ol className="mt-5 divide-y divide-[var(--consumer-border)] border-y border-[var(--consumer-border)]">
            {plan.steps.map((step, index) => (
              <li className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3 py-4" key={step.title}>
                <span className="grid size-7 place-items-center rounded-full bg-[var(--consumer-accent-tint)] text-xs font-semibold text-[var(--consumer-accent-ink)] tabular-nums">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  {/*
                    The title is the link when the step names an item, so the thing a consumer
                    reads and the thing they click are one target rather than a "see also" beside
                    it. A step that names no item is plain text: a link to nowhere is worse than
                    no link, and there is no row to scroll to.
                  */}
                  {step.href ? (
                    <a
                      className="text-sm font-semibold text-[var(--consumer-accent-ink)] underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--consumer-accent-ink)]"
                      href={step.href}
                    >
                      {step.title}
                    </a>
                  ) : (
                    <p className="text-sm font-semibold">{step.title}</p>
                  )}
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        ) : null}

        <div className="mt-5 rounded-[8px] bg-[var(--consumer-canvas)] px-4 py-3.5">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Timeline</p>
          <p className="mt-1.5 flex flex-wrap items-baseline gap-2.5">
            <b className="text-lg font-semibold tracking-[-0.02em] tabular-nums">{plan.timelineBand}</b>
          </p>
          <p className="mt-1 max-w-[60ch] text-xs leading-5 text-muted-foreground">{plan.timelineReason}</p>
        </div>

        <p className="mt-4 max-w-[60ch] text-sm leading-6 text-muted-foreground">{plan.businessSide}</p>

        {plan.writtenFrom ? <SourceStamp className="mt-4">{plan.writtenFrom}</SourceStamp> : null}
      </div>
    </section>
  );
}
