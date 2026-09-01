/**
 * Which single band gets the one filled green action.
 *
 * The newest *visible* band that still needs something. Both qualifiers are load-bearing.
 *
 * *Newest*, because a thread ten days long has several bands that once wanted an action and only
 * the last one is still the thing to do; filling all of them turns Electric Green into a column of
 * fields, which is the treatment DESIGN.md refuses.
 *
 * *Visible*, because the operator's filter chips change what is in the thread. Picking the primary
 * from every row and then filtering would leave the one filled control inside a band the reader
 * cannot see — the thread would have no primary at all while claiming to have one. So this is
 * called with the filtered list, and a filter state is another state in which exactly one band is
 * filled.
 *
 * The composer's Send is the surface's own primary and sits outside the thread; it is not counted
 * here and it is not competing with this.
 */

import type { TimelineAudience } from "@/lib/timeline/types";

import { effectiveSpec, isPrimaryEligible, type TimelineRow } from "./catalog";

/** The row that gets the filled action, or `null` when nothing in view is asking for anything. */
export function primaryTarget(
  rows: readonly TimelineRow[],
  audience: TimelineAudience,
  /** Reviews recorded in this session. A band whose only fillable action is already done is not it. */
  reviewedUploadIds: readonly string[] = [],
): TimelineRow | null {
  const reviewed = new Set(reviewedUploadIds);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    const spec = effectiveSpec(row, audience);
    if (spec === null) continue;
    // A kind the consumer reads as a line has no action to fill, and neither has any line.
    if (spec.layout !== "band") continue;
    const actions = spec.actions?.(row, audience) ?? [];
    if (
      actions.some((action) =>
        action.intent === "review" && reviewed.has(action.uploadId)
          ? false
          : isPrimaryEligible(action),
      )
    ) {
      return row;
    }
  }
  return null;
}
