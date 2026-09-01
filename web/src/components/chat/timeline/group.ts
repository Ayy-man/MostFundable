/**
 * The render plan: one sorted array of messages and events turned into the blocks a thread draws.
 *
 * A plain module rather than part of the components, for the reason `grouping.ts` gives beside it —
 * the runner collects `.test.ts` only and Node strips types without transforming JSX, so anything a
 * test needs to *run* lives outside a `.tsx` file. That constraint is worth working with here, not
 * around: folding, day boundaries and the new-since marker are the only genuinely algorithmic part
 * of this work, they are where an off-by-one shows up as a stage move buried inside a disclosure,
 * and the components have nothing left to get wrong once this is right.
 *
 * The volume rules, ported from the approved mockup:
 *
 * - **Runs.** Two or more *adjacent* low-weight lines collapse into one disclosure labelled with
 *   what it holds and the times it spans. Adjacent only, so expanding a run can never reorder it
 *   against a band, and labelled with its nouns so a folded run still says what is inside it.
 * - **Folds.** Adjacent same-kind foldable bands (`document_filed`) become one band with a count.
 *   If the group holds the thread's primary band, that band is hoisted out and rendered under the
 *   summary rather than the fold refusing to form — the one filled action must never be inside a
 *   collapsed disclosure.
 * - **Sticky never folds.** A stage move, a resolution, an enrollment milestone, a consent change, a
 *   subscription change and anything operator-only stay their own rows. Those are what an operator
 *   scans a thread for, and a row you have to expand a disclosure to find is a row you do not find.
 * - **Messages group as they always have.** `withinGroupingWindow` and the author rules come from
 *   `../time`, unchanged; any event between two messages breaks the group, because two messages
 *   either side of a stage move are not one moment.
 */

import type { TimelineAudience } from "@/lib/timeline/types";

import { crossesDay, withinGroupingWindow } from "../time";
import type { ChatMessage, ChatThreadItem } from "../types";
import { specFor, type TimelineFilterId, type TimelineGlyph, type TimelineRow } from "./catalog";
import { expandTransitions } from "./expand-transitions";
import { timelineTime } from "./format";
import { primaryTarget } from "./primary-target";
import { resolveRow, type ResolvedBand, type ResolvedLine } from "./resolve";

/** What the operator's chips and the consumer's toggle can ask for. */
export type TimelineFilter = "all" | "messages" | TimelineFilterId;

export interface TimelineGroupOptions {
  readonly filter?: TimelineFilter;
  /** The consumer's one volume control. Hides every event; messages are untouched. */
  readonly hideEvents?: boolean;
  /** Runs and folds. Off in the states gallery, where each row is the subject. */
  readonly collapse?: boolean;
  /** The counterpart read watermark. The green divider goes before the first row after it. */
  readonly newSince?: string | null;
  /** The event read failed. The messages are current and say nothing about it. */
  readonly readFailed?: boolean;
  /** @opaque Uploads a review was recorded for in this session. Never rendered. */
  readonly reviewedUploadIds?: readonly string[];
}

/** One resolved line inside a run, kept with its row so React can key it. */
export interface TimelineLineEntry {
  readonly row: TimelineRow;
  readonly view: ResolvedLine;
}

export interface TimelineBandEntry {
  readonly row: TimelineRow;
  readonly view: ResolvedBand;
}

export type TimelineBlock =
  | { readonly type: "divider"; readonly at: string; readonly newSince: boolean }
  | { readonly type: "group"; readonly messages: readonly ChatMessage[]; readonly own: boolean }
  | { readonly type: "line" } & TimelineLineEntry
  | { readonly type: "band" } & TimelineBandEntry
  | {
      readonly type: "run";
      readonly label: string;
      readonly lines: readonly TimelineLineEntry[];
    }
  | {
      readonly type: "fold";
      readonly glyph: TimelineGlyph;
      readonly noun: string;
      readonly at: string;
      readonly title: string;
      readonly body: string;
      readonly bands: readonly TimelineBandEntry[];
    }
  | { readonly type: "read-failed" };

export interface TimelineThreadPlan {
  readonly blocks: readonly TimelineBlock[];
  /** What the operator's filter count line reports. Counts what actually renders. */
  readonly messageCount: number;
  readonly eventCount: number;
}

/** Whether a row answers to the current filter. */
function inFilter(
  filter: TimelineFilter,
  rowFilter: TimelineFilterId | null,
  hideEvents: boolean,
): boolean {
  if (hideEvents) return false;
  if (filter === "all") return true;
  if (filter === "messages") return false;
  return rowFilter === filter;
}

export function groupTimeline(
  items: readonly ChatThreadItem[],
  audience: TimelineAudience,
  isOwn: (message: ChatMessage) => boolean,
  options: TimelineGroupOptions = {},
): TimelineThreadPlan {
  const { collapse = true, filter = "all", hideEvents = false, newSince = null } = options;

  const messages = items.flatMap((item) => (item.type === "message" ? [item.message] : []));
  const rows = expandTransitions(
    items.flatMap((item) =>
      item.type === "event" && item.timeline !== undefined ? [item.timeline] : [],
    ),
    audience,
  );

  type Entry =
    | { readonly at: string; readonly message: ChatMessage }
    | { readonly at: string; readonly row: TimelineRow };

  const sorted: Entry[] = [
    ...messages.map((message) => ({ at: message.sentAt, message })),
    ...rows.map((row) => ({ at: row.at, row })),
  ].sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime());

  // The filtered view first, so the primary is chosen from what the reader can actually see.
  const visible: Entry[] = [];
  for (const entry of sorted) {
    if ("message" in entry) {
      if (filter === "all" || filter === "messages") visible.push(entry);
      continue;
    }
    const view = resolveRow(entry.row, audience);
    if (view === null) continue;
    if (!inFilter(filter, view.filter, hideEvents)) continue;
    visible.push(entry);
  }

  const primary = primaryTarget(
    visible.flatMap((entry) => ("row" in entry ? [entry.row] : [])),
    audience,
    options.reviewedUploadIds,
  );

  const blocks: TimelineBlock[] = [];
  let messageCount = 0;
  let eventCount = 0;
  let previousAt: string | null = null;
  let markerPlaced = newSince === null;

  let run: TimelineLineEntry[] = [];
  let fold: TimelineBandEntry[] = [];
  let foldKind: TimelineRow["kind"] | null = null;

  const flushRun = () => {
    if (run.length === 0) return;
    if (collapse && run.length >= 2) {
      const nouns = [...new Set(run.map((entry) => entry.view.noun))].join(" · ");
      const first = timelineTime(run[0].view.at);
      const last = timelineTime(run[run.length - 1].view.at);
      blocks.push({
        label: `${run.length} updates · ${nouns} · ${first} to ${last}`,
        lines: run,
        type: "run",
      });
    } else {
      for (const entry of run) blocks.push({ ...entry, type: "line" });
    }
    run = [];
  };

  const flushFold = () => {
    if (fold.length === 0) return;
    const hoisted = fold.find((entry) => entry.row === primary) ?? null;
    let held = hoisted === null ? fold : fold.filter((entry) => entry !== hoisted);
    if (collapse && held.length >= 2 && foldKind !== null) {
      const spec = specFor(foldKind);
      const summary = spec.foldCopy?.(held.map((entry) => entry.row));
      if (summary) {
        blocks.push({
          at: held[held.length - 1].view.at,
          bands: held,
          body: summary.body,
          glyph: held[0].view.glyph,
          noun: held[0].view.noun,
          title: summary.title,
          type: "fold",
        });
        held = [];
      }
    }
    for (const entry of held) blocks.push({ ...entry, type: "band" });
    if (hoisted !== null) blocks.push({ ...hoisted, type: "band" });
    fold = [];
    foldKind = null;
  };

  const flushAll = () => {
    flushRun();
    flushFold();
  };

  for (const entry of visible) {
    const crossesToNewDay = previousAt === null || crossesDay(previousAt, entry.at);
    const marksNew =
      !markerPlaced && newSince !== null && new Date(entry.at) > new Date(newSince);

    if (crossesToNewDay || marksNew) {
      flushAll();
      if (marksNew) markerPlaced = true;
      blocks.push({ at: entry.at, newSince: marksNew, type: "divider" });
    }
    previousAt = entry.at;

    if ("message" in entry) {
      flushAll();
      messageCount += 1;
      const own = isOwn(entry.message);
      const last = blocks.at(-1);
      const continues =
        last?.type === "group" &&
        last.own === own &&
        last.messages.at(-1)?.author.name === entry.message.author.name &&
        last.messages.at(-1)?.visibility === entry.message.visibility &&
        withinGroupingWindow(last.messages.at(-1)!.sentAt, entry.message.sentAt);
      if (continues) {
        blocks[blocks.length - 1] = {
          ...last,
          messages: [...last.messages, entry.message],
        };
      } else {
        blocks.push({ messages: [entry.message], own, type: "group" });
      }
      continue;
    }

    const view = resolveRow(entry.row, audience, {
      primary: entry.row === primary,
      ...(options.reviewedUploadIds ? { reviewedUploadIds: options.reviewedUploadIds } : {}),
    });
    if (view === null) continue;
    eventCount += 1;

    if (view.layout === "line" && !view.sticky) {
      flushFold();
      run.push({ row: entry.row, view });
      continue;
    }
    if (view.layout === "band" && view.foldable) {
      flushRun();
      if (foldKind !== null && foldKind !== entry.row.kind) flushFold();
      foldKind = entry.row.kind;
      fold.push({ row: entry.row, view });
      continue;
    }
    flushAll();
    blocks.push(
      view.layout === "line"
        ? { row: entry.row, type: "line", view }
        : { row: entry.row, type: "band", view },
    );
  }

  flushAll();
  if (options.readFailed) blocks.push({ type: "read-failed" });

  return { blocks, eventCount, messageCount };
}
