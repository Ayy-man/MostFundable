/**
 * Splitting a run of thread items into day dividers, author groups and events.
 *
 * A plain module rather than part of `message-thread.tsx`, for one practical reason: the test
 * runner collects `.test.ts` files only, and Node strips types without transforming JSX, so anything
 * a test needs to *run* has to live outside a `.tsx` file. That constraint is worth working with
 * here rather than around — this is the only genuinely algorithmic part of the thread, it is where
 * an off-by-one shows up as two avatars for one person, and a lane rendering its own thread body
 * should reuse the rules instead of forming a second opinion about them.
 */

import { crossesDay, withinGroupingWindow } from "./time";
import type { ChatEvent, ChatMessage, ChatThreadItem } from "./types";

/**
 * Split a run of items into groups, dividers and events.
 *
 * Groups are broken by author, by visibility and by the time window, and never by author alone:
 * two messages four hours apart from one person are two moments, and the gap between them is
 * usually the most informative thing in a support thread.
 */
export type ThreadBlock =
  | { readonly type: "divider"; readonly at: string }
  | { readonly type: "group"; readonly messages: ChatMessage[]; readonly own: boolean }
  | { readonly type: "event"; readonly event: ChatEvent };

export function groupThreadItems(
  items: readonly ChatThreadItem[],
  isOwn: (message: ChatMessage) => boolean,
): ThreadBlock[] {
  const blocks: ThreadBlock[] = [];
  let previousAt: string | null = null;

  for (const item of items) {
    // A row with no `event` is a timeline-only row, which this grouping never sees: the surfaces
    // build those only behind `FEATURE_TIMELINE`, and that path goes through `timeline/group.ts`.
    // Skipped rather than rendered as an empty block, so the failure is nothing rather than a gap.
    if (item.type === "event" && item.event === undefined) continue;
    const at = item.type === "message" ? item.message.sentAt : item.event!.occurredAt;
    if (previousAt !== null && crossesDay(previousAt, at)) {
      blocks.push({ at, type: "divider" });
    } else if (previousAt === null) {
      blocks.push({ at, type: "divider" });
    }
    previousAt = at;

    if (item.type === "event") {
      blocks.push({ event: item.event!, type: "event" });
      continue;
    }

    const own = isOwn(item.message);
    const last = blocks.at(-1);
    const continues =
      last?.type === "group" &&
      last.own === own &&
      last.messages.at(-1)?.author.name === item.message.author.name &&
      last.messages.at(-1)?.visibility === item.message.visibility &&
      withinGroupingWindow(last.messages.at(-1)!.sentAt, item.message.sentAt);

    if (continues) last.messages.push(item.message);
    else blocks.push({ messages: [item.message], own, type: "group" });
  }

  return blocks;
}
