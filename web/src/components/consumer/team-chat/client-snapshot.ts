/**
 * The client's own tracker row, narrowed to what this view is allowed to show.
 *
 * The read itself is `useTrackerClients({ audience: "consumer" })`, which every other consumer
 * view that needs durable client state already uses — it fetches `/api/clients`, revalidates on a
 * realtime change, and reports `loading` / `error` / `enabled` separately, which is the three-way
 * answer the context rail needs. Writing a second fetch here would have produced a second opinion
 * about the same row that disagreed with the Today view's whenever one of them was stale.
 *
 * What this module adds is the narrowing, and the narrowing is the point. `TrackerClient` carries
 * twenty-five fields including `id`, `consumerProfileId`, `assignedToId` and `archivedById`, all
 * four of which are identifiers rail 3 forbids on screen. `ConsumerClientSnapshot` has eight
 * fields and not one of them is an id, so the rail cannot render one by accident: the value is
 * simply not in the object it was handed. That is the same argument `SupportDraftContext` makes
 * about what a draft driver may see, applied to what a pane may see.
 *
 * `stageLabel` is resolved through `TRACKER_STAGE_LABELS` rather than title-cased here, because
 * that table is the one taxonomy CLAUDE.md names and a second capitalisation of "optimization" is
 * how two surfaces end up disagreeing about what stage somebody is in.
 */

import { TRACKER_STAGE_LABELS, type TrackerClient } from "@/lib/tracker/types";

import type { ConsumerClientSnapshot } from "./types";

export function snapshotFrom(client: TrackerClient): ConsumerClientSnapshot {
  return {
    analysisAt: client.analysisAt,
    analysisPending: client.analysisPending,
    assignedToName: client.assignedToName,
    monitoring: client.monitoring,
    nextRefreshAt: client.nextRefreshAt,
    openActionCount: client.openActionCount,
    readiness: client.readiness,
    stageLabel: TRACKER_STAGE_LABELS[client.stage],
  };
}

/**
 * The fields a snapshot carries. Derived from a real value rather than written out, so the
 * no-identifier check beside it cannot go stale against a widened type.
 */
export function snapshotFields(client: TrackerClient): readonly string[] {
  return Object.keys(snapshotFrom(client));
}

/**
 * A date a metric was observed on, in the form the rest of the conversation uses.
 *
 * `en-GB` day-then-month, matching `components/chat/time.ts`'s long form, so a date in the rail and
 * a date on a message do not read as two different calendars. An unparseable value returns null and
 * the caller renders nothing — never the string "Invalid Date", which is what `new Date(x)` gives
 * you the first time a column comes back empty.
 */
export function observedOn(value: string | null): string | null {
  if (value === null) return null;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(at);
}
