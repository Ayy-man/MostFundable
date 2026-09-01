// The history rail's arithmetic: group by day, newest first, and filter by what was typed.
//
// Kept out of the component because it is the part with edges. Days are local days, not UTC ones —
// a conversation at 23:40 belongs to the day the person was having it — and `dayLabel` from the
// chat foundation already owns that arithmetic, so this module borrows it rather than growing a
// second definition of "today" one directory away from the first.
//
// The one product decision in here: a search that matches nothing returns nothing, and the rail
// renders "no conversation matches that" rather than the unfiltered list. Silently ignoring a
// filter that matched nothing is how a person concludes the search is broken.

import { dayLabel, parseTimestamp } from "@/components/chat/time";

import type { AssistantConversation } from "@/lib/assistant/types";

export interface ConversationDay {
  /**
   * @internal React identity for the group — the local day as `YYYY-MM-DD`. Not an identifier in
   * the rail-3 sense (it names a date, not a record) and it is never rendered; `label` is.
   */
  readonly key: string;
  /** "Today", "Yesterday", "12 August". */
  readonly label: string;
  readonly conversations: readonly AssistantConversation[];
}

function localDayKey(at: Date): string {
  const year = at.getFullYear();
  const month = `${at.getMonth() + 1}`.padStart(2, "0");
  const day = `${at.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Newest day first, and newest conversation first inside each day.
 *
 * A conversation whose `lastActivityAt` will not parse is dropped rather than filed under a
 * fabricated day: the rail's whole claim is that these are grouped by when they happened.
 */
export function groupConversations(
  conversations: readonly AssistantConversation[],
  now: Date = new Date(),
): readonly ConversationDay[] {
  const groups = new Map<string, { at: number; rows: AssistantConversation[] }>();

  for (const conversation of conversations) {
    const at = parseTimestamp(conversation.lastActivityAt);
    if (at === null) continue;
    const key = localDayKey(at);
    const existing = groups.get(key);
    if (existing === undefined) groups.set(key, { at: at.getTime(), rows: [conversation] });
    else {
      existing.rows.push(conversation);
      existing.at = Math.max(existing.at, at.getTime());
    }
  }

  return [...groups.entries()]
    .sort((left, right) => right[1].at - left[1].at)
    .map(([key, group]) => ({
      conversations: [...group.rows].sort(
        (left, right) =>
          (parseTimestamp(right.lastActivityAt)?.getTime() ?? 0)
          - (parseTimestamp(left.lastActivityAt)?.getTime() ?? 0),
      ),
      key,
      label: dayLabel(group.rows[0].lastActivityAt, now),
    }));
}

/** Case-insensitive substring over the title, which is the only thing the rail shows. */
export function searchConversations(
  conversations: readonly AssistantConversation[],
  query: string,
): readonly AssistantConversation[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return conversations;
  return conversations.filter((conversation) =>
    conversation.title.toLowerCase().includes(needle),
  );
}
