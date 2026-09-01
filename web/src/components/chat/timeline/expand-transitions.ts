/**
 * A state change is two facts, and this produces the second one.
 *
 * The origin band never moves and never rewrites its opening title: "New action: Utilization under
 * 30%" is what the thread said on Aug 15 and it is what it still says. What changed on Aug 22 gets
 * its own row at the real instant, written as a reference back to the origin — "Utilization under
 * 30% verified by the Aug 22 analysis".
 *
 * Both halves matter. Rewriting the origin in place puts a change under an earlier day divider, so
 * a thread scrolled from the top tells the reader something happened a week before it did. Dropping
 * the origin's status leaves the reader to work out the current state from a row further down. So
 * the band carries the final status and the transition carries the instant, and a message like "the
 * statement I sent this morning" has an antecedent in the same day's rows.
 *
 * Three fields carry the change — `fulfilledAt`, `verifiedAt`, `completedAt`, exactly the ones the
 * contract documents as status fields. Glyph, noun and filter are inherited from the origin kind so
 * a transition reads as belonging to it and answers to the same filter chip.
 */

import type { TimelineAudience } from "@/lib/timeline/types";

import type { TimelineRow, TimelineTransitionRow } from "./catalog";
import { timelineDate } from "./format";

/**
 * Every row, plus the transition rows the status fields imply.
 *
 * The input order is not relied on: `groupTimeline` sorts by instant, which is where a transition
 * ends up beside the message that refers to it.
 */
export function expandTransitions(
  rows: readonly TimelineRow[],
  audience: TimelineAudience,
): readonly TimelineRow[] {
  const extra: TimelineTransitionRow[] = [];

  for (const row of rows) {
    if (row.kind === "document_requested" && row.fulfilledAt) {
      extra.push({
        at: row.fulfilledAt,
        filterAs: "documents",
        glyph: "doc",
        kind: "transition",
        noun: "Document",
        ref: `${row.ref}::fulfilled`,
        title:
          audience === "consumer"
            ? `You sent the ${row.name.toLowerCase()} · closes the ${timelineDate(row.at)} request`
            : `${row.client} sent the ${row.name.toLowerCase()} · closes the ${timelineDate(row.at)} request`,
      });
    }

    if (row.kind === "action" && row.state === "verified" && row.verifiedAt) {
      extra.push({
        at: row.verifiedAt,
        filterAs: "analysis",
        glyph: "list",
        kind: "transition",
        noun: "Action",
        ref: `${row.ref}::verified`,
        title: `${row.title} verified by the ${timelineDate(row.verifiedAt)} analysis`,
      });
    }

    if (row.kind === "refresh" && row.completedAt) {
      extra.push({
        at: row.completedAt,
        filterAs: "analysis",
        glyph: "refresh",
        kind: "transition",
        noun: "Refresh",
        ref: `${row.ref}::completed`,
        title: `The ${timelineDate(row.at)} refresh finished · readiness recorded`,
      });
    }
  }

  return [...rows, ...extra];
}
