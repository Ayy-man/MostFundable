/**
 * Turning support rows into thread items, which is where "a reader always knows who is speaking"
 * is actually decided.
 *
 * A plain module rather than part of the view, for the reason the foundation's `grouping.ts` gives:
 * the runner collects `.test.ts` only and Node strips types without transforming JSX, so anything
 * a test needs to run has to live outside a `.tsx`. That constraint suits this file, because the
 * naming rule below is the one thing in the lane that a screenshot cannot prove.
 *
 * Three decisions, each of which had an obvious wrong alternative.
 *
 * **Who the reader is comes from the author kind, not from an id comparison.** A consumer's
 * `team_chat` thread has exactly one consumer participant — migration 103 resolves the client from
 * the signed-in profile, so the browser is never told which client row it belongs to and cannot
 * name another one. So `authorKind === 'consumer'` is the reader, and no profile id has to cross
 * into the view to work that out. `authorNameFor` is written as an exhaustive switch over
 * `SupportAuthorKind` with no `default`, so widening that union is a compile error here rather
 * than a message rendering under a name nobody chose.
 *
 * **A team message is attributed to the workspace, never to a person we guessed at.**
 * `SupportMessageRow` carries `authorProfileId` and no display name, and the tempting fix is to
 * label every operator message with whoever the client is assigned to. That is a lie roughly
 * whenever a colleague answers, and it is exactly the lie rail 6 is about. So the name is the
 * operator's brand and the role chip is `All Team`, which is Drop 7 #187's own wording and is true
 * of every message in the set regardless of which member wrote it. The assigned member is named in
 * the context rail, where naming them is a fact rather than an attribution.
 *
 * **Nothing here ever produces an assistant author.** There is no branch that could: `ChatAuthor`'s
 * kind mirrors `SupportAuthorKind`, which is closed at three people, and the assistant renders in
 * its own panel out of its own state. That is rail 6 held structurally rather than by review.
 */

import type { ChatAuthor, ChatMessage, ChatThreadItem } from "@/components/chat";
import { receiptFor } from "@/lib/support/read-receipt";
import type { SupportAuthorKind, SupportMessageRow, SupportThreadRead } from "@/lib/support";

/** What a team message's role chip says. Drop 7 #187: "Say All Team". */
export const TEAM_ROLE_LABEL = "All Team";

/** What the reader's own messages are labelled. Their own name adds nothing they do not know. */
export const READER_NAME = "You";

/**
 * What a platform-staff message is attributed to.
 *
 * Not the platform's brand. A white-label client is not told whose software this is, so the
 * attribution names the function rather than the company.
 */
export const PLATFORM_NAME = "Platform support";

export function isReader(authorKind: SupportAuthorKind): boolean {
  return authorKind === "consumer";
}

/**
 * The display name for each of the three authors a support message can have.
 *
 * Exhaustive on purpose: no `default`, so a fourth kind fails to compile rather than falling
 * through to whichever branch happened to be last.
 */
export function authorFor(authorKind: SupportAuthorKind, operatorName: string): ChatAuthor {
  switch (authorKind) {
    case "consumer":
      return { kind: "consumer", name: READER_NAME };
    case "operator":
      return { kind: "operator", name: operatorName, roleLabel: TEAM_ROLE_LABEL };
    case "admin":
      return { kind: "admin", name: PLATFORM_NAME };
  }
}

/**
 * A durable row, as the thread renders it.
 *
 * `delivery` reaches `read` only from `counterpartReadAt`, which migration 393 derives as the
 * greatest watermark held by the team side of this thread. It is not `SupportThreadRead`'s
 * `lastReadAt`: that one is *this* profile's own mark, where the client's attention stopped, and
 * a tick built from it would be a claim about somebody else's attention derived from nothing,
 * which contract §4 names as a review failure on its own. With no counterpart instant the state
 * stays `delivered`, which is the weaker claim and the true one.
 */
export function messageFrom(
  row: SupportMessageRow,
  operatorName: string,
  counterpartReadAt: string | null = null,
): ChatMessage {
  return {
    author: authorFor(row.authorKind, operatorName),
    body: row.body,
    delivery: receiptFor({
      counterpartReadAt,
      own: row.authorKind === "consumer",
      sentAt: row.sentAt,
    }),
    origin: row.origin,
    ref: row.id,
    sentAt: row.sentAt,
    visibility: row.visibility,
  };
}

/**
 * The whole thread, oldest first.
 *
 * `visibility` is passed through rather than filtered. An `internal` note cannot reach a consumer
 * — migration 385 puts the rule in `support_messages_select` and in the read RPC — and re-filtering
 * it here would create a second, weaker place for that guarantee to live, so that the day the
 * filter and the policy disagreed the filter would be believed.
 */
export function threadItemsFrom(
  rows: readonly SupportMessageRow[],
  operatorName: string,
  counterpartReadAt: string | null = null,
): ChatThreadItem[] {
  return rows.map((row) => ({
    message: messageFrom(row, operatorName, counterpartReadAt),
    type: "message",
  }));
}

/**
 * How many messages the client has not seen, for the "new messages" marker.
 *
 * Read straight off the server's count. `support_list_thread_digest` derives it from the messages
 * themselves; recomputing it here from `lastReadAt` would be a second answer that disagrees the
 * moment a message lands between the read and the render.
 */
export function unreadCount(read: SupportThreadRead): number {
  return read.unreadCount;
}
