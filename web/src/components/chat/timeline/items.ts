/**
 * Timeline events, as thread rows.
 *
 * Three lines of code and its own module because it is the seam every surface crosses: the read path
 * returns `TimelineRead`, the thread takes `ChatThreadItem[]`, and a surface writing that conversion
 * itself is a surface that can get it wrong in private. `event` is deliberately absent — see
 * `ChatThreadItem` for why a timeline row does not invent a `ChatEventKind` it has no honest value
 * for — which also means these rows render nothing at all if a caller hands them to the flag-off
 * thread, rather than rendering a blank line.
 */

import type { TimelineEvent } from "@/lib/timeline/types";

import type { ChatThreadItem } from "../types";

export function timelineThreadItems(
  events: readonly TimelineEvent[],
): ChatThreadItem[] {
  return events.map((event) => ({ timeline: event, type: "event" }));
}
