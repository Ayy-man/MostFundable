"use client";

/**
 * The browser's half of the team chat: the bootstrap that runs when the server had nothing, the
 * re-read, and the send.
 *
 * **This is the fallback path, not the first-paint path.** `readConsumerTeamChat` does the same
 * work on the server during the render that was happening anyway, and the view paints from its
 * result. The chain below is what runs when that returned `null` — a session that could not be
 * resolved, a tenancy refusal, a transient read failure — and what runs after a reconnect. Keeping
 * it is deliberate: the server read answering `null` hands the work back here rather than freezing
 * a transient failure into an error state on somebody's first paint, and deleting this would turn
 * that design into a permanent "unavailable".
 *
 * It costs what it always cost. Measured signed-in against production: `GET /api/support/threads`
 * 1,144ms, `POST /api/support/threads` 930ms, `GET /api/support/threads/<id>` 1,041ms, each waiting
 * on the one before it. That is why it is the second choice.
 *
 * Three properties this file holds, and they are the same three the operator rail's docblock
 * claims for the same reasons:
 *
 *   **Nothing here fires by itself.** Every function is called from an event handler or an effect.
 *   There is no timer, no retry loop and no queue — and there cannot be one, because
 *   `lib/support/surface-contract.test.ts` applies `verify-no-auto-send.mjs`'s own deferral
 *   vocabulary to every component that can reach `/api/support/`, this file included.
 *
 *   **The send body carries `body` and nothing else.** The route refuses `authorKind`,
 *   `authorProfileId`, `origin` and `sentAt` outright, so the author is derived from the session
 *   and a client cannot post as somebody else.
 *
 *   **`disabled` is only ever a successful flag-off answer.** Every transport failure and every
 *   malformed payload resolves `unavailable`, so a caller cannot mistake a broken read for the
 *   flag being off and show a fixture conversation to somebody signed in.
 */

import type { SupportMessageRow, SupportThreadRead, SupportThreadRow } from "@/lib/support";

/** What the browser bootstrap can come back with. */
export type TeamChatBootstrap =
  | { readonly state: "disabled" | "unavailable" }
  | {
      readonly state: "ready";
      readonly thread: SupportThreadRow;
      readonly messages: readonly SupportMessageRow[];
      readonly read: SupportThreadRead;
    };

/** The subject an unopened consumer thread takes. Matches `team-chat.server.ts`'s. */
const TEAM_CHAT_SUBJECT = "Team Chat";

const READ_INIT: RequestInit = { cache: "no-store", credentials: "same-origin" };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * A payload is taken whole or not at all.
 *
 * The rows are re-shaped rather than cast, so a response missing `sentAt` produces `unavailable`
 * rather than a bubble with an invalid date in it. The alternative — trusting the shape because
 * our own route wrote it — is true right up until a proxy returns an error page with a 200.
 */
function parseThread(value: unknown): SupportThreadRow | null {
  const row = asRecord(value);
  if (row === null) return null;
  const { id, kind, orgId, clientId, status, subject, createdBy, createdAt, lastActivityAt } = row;
  if (typeof id !== "string" || typeof subject !== "string") return null;
  if (kind !== "team_chat" && kind !== "platform_support") return null;
  if (status !== "open" && status !== "pending" && status !== "resolved") return null;
  if (typeof orgId !== "string" || typeof createdBy !== "string") return null;
  if (typeof createdAt !== "string" || typeof lastActivityAt !== "string") return null;
  return {
    clientId: typeof clientId === "string" ? clientId : null,
    createdAt,
    createdBy,
    id,
    kind,
    lastActivityAt,
    orgId,
    status,
    subject,
  };
}

export function parseMessage(value: unknown): SupportMessageRow | null {
  const row = asRecord(value);
  if (row === null) return null;
  const { id, threadId, authorProfileId, authorKind, origin, originDraftId, body, sentAt, visibility } = row;
  if (typeof id !== "string" || typeof threadId !== "string" || typeof body !== "string") return null;
  if (typeof authorProfileId !== "string" || typeof sentAt !== "string") return null;
  if (authorKind !== "consumer" && authorKind !== "operator" && authorKind !== "admin") return null;
  if (origin !== "human" && origin !== "ai_assisted") return null;
  if (visibility !== "participants" && visibility !== "internal") return null;
  return {
    authorKind,
    authorProfileId,
    body,
    id,
    origin,
    originDraftId: typeof originDraftId === "string" ? originDraftId : null,
    sentAt,
    threadId,
    visibility,
  };
}

function parseRead(value: unknown): SupportThreadRead {
  const row = asRecord(value);
  const lastReadAt = row?.lastReadAt;
  const unreadCount = row?.unreadCount;
  const counterpartReadAt = row?.counterpartReadAt;
  return {
    counterpartReadAt: typeof counterpartReadAt === "string" ? counterpartReadAt : null,
    lastReadAt: typeof lastReadAt === "string" ? lastReadAt : null,
    unreadCount: typeof unreadCount === "number" && unreadCount > 0 ? unreadCount : 0,
  };
}

function parsePayload(value: unknown): TeamChatBootstrap {
  const payload = asRecord(value);
  if (payload === null) return { state: "unavailable" };
  const thread = parseThread(payload.thread);
  if (thread === null) return { state: "unavailable" };
  const rows = Array.isArray(payload.messages) ? payload.messages : [];
  const messages: SupportMessageRow[] = [];
  for (const row of rows) {
    const message = parseMessage(row);
    // A row that does not map is dropped rather than half-rendered, the way the realtime mapper
    // drops one: the next read brings it back correctly, and an empty bubble would not go away.
    if (message !== null) messages.push(message);
  }
  return { messages, read: parseRead(payload.read), state: "ready", thread };
}

/**
 * Open (or re-open) the consumer's team chat and read it back.
 *
 * `support_open_thread` is idempotent for `team_chat` — one client, one thread — so this is a read
 * with a create the first time and a plain read every time after. Migration 103 resolves the client
 * from the session, which is why no id is sent from here: the browser is never told which client
 * row it belongs to, so it cannot name the wrong one.
 */
export async function bootstrapTeamChat(fetcher: typeof fetch = fetch): Promise<TeamChatBootstrap> {
  try {
    const bootstrap = await fetcher("/api/support/threads", READ_INIT);
    if (!bootstrap.ok) return { state: "unavailable" };
    const config = asRecord(await bootstrap.json());
    if (config?.enabled === false) return { state: "disabled" };
    if (config?.enabled !== true) return { state: "unavailable" };

    const opened = await fetcher("/api/support/threads", {
      body: JSON.stringify({ kind: "team_chat", subject: TEAM_CHAT_SUBJECT }),
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (!opened.ok) return { state: "unavailable" };
    const created = asRecord(await opened.json());
    const thread = parseThread(created?.thread);
    if (thread === null) return { state: "unavailable" };

    return await readTeamChat(thread.id, fetcher);
  } catch {
    return { state: "unavailable" };
  }
}

/** Re-read one thread. Used after a reconnect, and by the error state's retry. */
export async function readTeamChat(
  threadRef: string,
  fetcher: typeof fetch = fetch,
): Promise<TeamChatBootstrap> {
  try {
    const response = await fetcher(
      `/api/support/threads/${encodeURIComponent(threadRef)}`,
      READ_INIT,
    );
    if (!response.ok) return { state: "unavailable" };
    return parsePayload(await response.json());
  } catch {
    return { state: "unavailable" };
  }
}

/**
 * Send one message, and hand back the row the database wrote.
 *
 * The returned row rather than the text that was typed, because they are not the same thing: the
 * row carries the server's `sentAt` and the author kind it derived from the session, and rendering
 * the typed text with a guessed timestamp would put a message on screen that disagrees with the
 * one the operator sees. `null` means it did not go, and the caller keeps the text.
 */
export async function sendTeamChatMessage(
  threadRef: string,
  body: string,
  fetcher: typeof fetch = fetch,
): Promise<SupportMessageRow | null> {
  try {
    const response = await fetcher(
      `/api/support/threads/${encodeURIComponent(threadRef)}/messages`,
      {
        body: JSON.stringify({ body }),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    if (!response.ok) return null;
    return parseMessage(asRecord(await response.json())?.message);
  } catch {
    return null;
  }
}
