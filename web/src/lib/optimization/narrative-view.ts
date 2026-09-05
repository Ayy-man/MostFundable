import { shortDate } from "./view-model.ts";

import type { NarrativeV1 } from "../llm/narrative/contract.ts";
import type { ConsumerOptimizationV1, FactorV1 } from "./types.ts";

/**
 * Everything the "Your plan" card renders, resolved from the read model before any JSX exists.
 *
 * The runner behind `npm test` has no DOM, so the card's decisions live here where they can be
 * asserted directly: whether there is a card at all, which step links to which factor row, and
 * what the provenance line says when the analysis carries no timestamp. The component is then a
 * literal transcription of this object and holds no branch of its own worth testing.
 */
export interface PlanNarrativeStepPropsV1 {
  readonly title: string;
  readonly detail: string;
  /**
   * The `#factor-<itemKey>` target on the matching checklist row, or null when the step names no
   * item. Null is a real case rather than a defect: a step can be about the file as a whole.
   */
  readonly href: string | null;
}

export interface PlanNarrativePropsV1 {
  readonly verdict: string;
  readonly whereYouStand: string;
  readonly steps: readonly PlanNarrativeStepPropsV1[];
  readonly timelineBand: string;
  readonly timelineReason: string;
  readonly businessSide: string;
  /** The provenance line, already worded. Null when the run carries no date to name. */
  readonly writtenFrom: string | null;
}

/** The anchor a checklist row carries so a narrative step can link to it. */
export function factorAnchorId(itemKey: string): string {
  return `factor-${itemKey}`;
}

/**
 * The card's props, or null when there is nothing to draw.
 *
 * Null means the card renders NOTHING — no empty shell, no placeholder copy. A consumer whose
 * narrative failed to generate, or whose deployment has no narrative column yet, sees the view
 * exactly as it was before this card existed rather than a box explaining an absence they have no
 * way to act on.
 */
export function planNarrativeProps(view: ConsumerOptimizationV1): PlanNarrativePropsV1 | null {
  const narrative = view.narrative;
  if (narrative === null) return null;

  const ranAt = shortDate(view.analysis?.ranAt ?? null);
  return {
    businessSide: narrative.businessSide,
    steps: narrative.nextSteps.map((step) => ({
      detail: step.detail,
      href: step.itemKey === null ? null : `#${factorAnchorId(step.itemKey)}`,
      title: step.title,
    })),
    timelineBand: narrative.timeline.band,
    timelineReason: narrative.timeline.reason,
    verdict: narrative.verdict,
    whereYouStand: narrative.whereYouStand,
    writtenFrom: ranAt === null ? null : `Written from your latest analysis on ${ranAt}.`,
  };
}

/**
 * The per-item note this narrative wrote for a factor, or null to leave the template copy alone.
 *
 * The template signal stays the fallback rather than the loser: a narrative writes notes only for
 * the items it had something to say about, and a factor it skipped must still explain itself.
 */
export function narrativeNoteFor(narrative: NarrativeV1 | null, factor: FactorV1): string | null {
  if (narrative === null) return null;
  const note = (narrative.itemNotes as Record<string, string | undefined>)[factor.key];
  return note ?? null;
}
