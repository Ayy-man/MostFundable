"use client";

// The browser half of the durable assistant: five reads and one write, each returning a state the
// workspace can render rather than a value that might be a lie.
//
// Two rules run through all of it.
//
// **A failed read is never an empty one.** `loadAdminResource` in `lib/admin/platform-client.ts`
// learned this the hard way (G-HOST-14) and the shape here is deliberately the same: an outage
// resolves to `"failed"`, a flag that is off resolves to its own state, and neither collapses into
// "there is nothing here". A history rail that renders "No conversations yet" because the network
// dropped teaches somebody that their history was deleted.
//
// **Nothing is parsed optimistically.** Every payload crossing this boundary is validated against
// the vocabularies `lib/assistant/types.ts` exports — `ASSISTANT_SOURCE_KINDS`,
// `ASSISTANT_ERROR_CODES`, `ASSISTANT_STAGES` — rather than cast. A turn missing its `headline`
// would otherwise render as an answer with no words in it, and a source kind we do not know would
// reach the chip renderer as an unstyled unknown.
//
// The NDJSON reader is the interesting one. Contract §0 R1 rules out token streaming, so what
// arrives is stage lines and then exactly one terminal object. A stream that ends without a
// terminal object ended because the connection died, and this module says so — `readStreamLines`
// hands back the incomplete carry precisely so that half a line at a chunk boundary is not
// mistaken for the end of the answer.

import { readStreamLines } from "@/lib/assistant/stream";
import { ASSISTANT_ERROR_CODES, ASSISTANT_SOURCE_KINDS } from "@/lib/assistant/types";

import { isAssistantStage } from "./stages";

import type {
  AssistantConversation,
  AssistantErrorCode,
  AssistantProgressEvent,
  AssistantScope,
  AssistantSource,
  AssistantTurn,
} from "@/lib/assistant/types";

const JSON_HEADERS = { "content-type": "application/json" };
const READ_INIT: RequestInit = { cache: "no-store", credentials: "same-origin" };

const CONVERSATIONS = "/api/assistant/conversations";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): value is string {
  return typeof value === "string";
}

function isErrorCode(value: unknown): value is AssistantErrorCode {
  return text(value) && (ASSISTANT_ERROR_CODES as readonly string[]).includes(value);
}

/** The one refusal shape both writing calls answer with. */
function failed(code: AssistantErrorCode): { readonly status: "failed"; readonly code: AssistantErrorCode } {
  return { code, status: "failed" };
}

function parseScope(value: unknown): AssistantScope | null {
  return value === "operator" || value === "admin" ? value : null;
}

export function parseConversation(value: unknown): AssistantConversation | null {
  const row = record(value);
  if (row === null) return null;
  const scope = parseScope(row.scope);
  if (
    scope === null
    || !text(row.id)
    || !text(row.title)
    || !text(row.createdAt)
    || !text(row.lastActivityAt)
    || typeof row.messageCount !== "number"
    || !Number.isFinite(row.messageCount)
  ) {
    return null;
  }
  return {
    createdAt: row.createdAt,
    id: row.id,
    lastActivityAt: row.lastActivityAt,
    messageCount: row.messageCount,
    scope,
    title: row.title,
  };
}

function parseSource(value: unknown): AssistantSource | null {
  const row = record(value);
  if (row === null) return null;
  // Derived from the exported vocabulary, so a sixth kind added to the contract and rendered
  // without a chip style is caught here rather than at the chip.
  if (!text(row.kind) || !(ASSISTANT_SOURCE_KINDS as readonly string[]).includes(row.kind)) {
    return null;
  }
  if (!text(row.label) || row.label.trim().length === 0) return null;
  return {
    kind: row.kind as AssistantSource["kind"],
    label: row.label,
    ref: text(row.ref) ? row.ref : null,
  };
}

export function parseTurn(value: unknown): AssistantTurn | null {
  const row = record(value);
  if (row === null) return null;
  if (row.role !== "user" && row.role !== "assistant") return null;
  if (!text(row.id) || !text(row.body) || !text(row.headline) || !text(row.createdAt)) return null;
  if (!Array.isArray(row.bullets) || !row.bullets.every(text)) return null;
  const rawSources = Array.isArray(row.sources) ? row.sources : [];
  // A source we cannot name is dropped, never rendered as a placeholder chip. Same call
  // `lib/assistant/sources.ts` makes one layer up and for the same reason: an answer with one
  // fewer chip is still an answer.
  const sources = rawSources
    .map(parseSource)
    .filter((source): source is AssistantSource => source !== null);
  return {
    body: row.body,
    bullets: row.bullets,
    createdAt: row.createdAt,
    headline: row.headline,
    id: row.id,
    role: row.role,
    sources,
  };
}

// ---------------------------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------------------------

export type ConversationListRead =
  /** `FEATURE_KB` is off. A named absence, not an outage and not an empty history. */
  | { readonly status: "disabled" }
  | { readonly status: "ready"; readonly conversations: readonly AssistantConversation[] }
  | { readonly status: "failed" };

/**
 * Every conversation this profile holds **in this scope**.
 *
 * The route returns the profile's whole history because RLS scopes it to the person, not to the
 * pane. The scope filter is here rather than in the rail so that it is one testable fact: the
 * operator workspace never lists a platform conversation, and vice versa, even for an account that
 * somehow holds both.
 */
export async function readConversationList(
  scope: AssistantScope,
  fetcher: typeof fetch = fetch,
): Promise<ConversationListRead> {
  let response: Response;
  try {
    response = await fetcher(CONVERSATIONS, READ_INIT);
  } catch {
    return { status: "failed" };
  }
  if (!response.ok) return { status: "failed" };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: "failed" };
  }
  const payload = record(body);
  if (payload === null) return { status: "failed" };
  if (payload.enabled !== true) return { status: "disabled" };
  if (!Array.isArray(payload.conversations)) return { status: "failed" };
  const conversations = payload.conversations
    .map(parseConversation)
    .filter((conversation): conversation is AssistantConversation => conversation !== null)
    .filter((conversation) => conversation.scope === scope);
  return { conversations, status: "ready" };
}

// ---------------------------------------------------------------------------------------------
// One conversation
// ---------------------------------------------------------------------------------------------

export type ConversationRead =
  | {
      readonly status: "ready";
      readonly conversation: AssistantConversation;
      readonly turns: readonly AssistantTurn[];
    }
  /** Deleted, or never this profile's. The route answers those identically on purpose. */
  | { readonly status: "missing" }
  | { readonly status: "failed" };

export async function readConversation(
  conversationId: string,
  fetcher: typeof fetch = fetch,
): Promise<ConversationRead> {
  let response: Response;
  try {
    response = await fetcher(`${CONVERSATIONS}/${conversationId}`, READ_INIT);
  } catch {
    return { status: "failed" };
  }
  if (response.status === 404) return { status: "missing" };
  if (!response.ok) return { status: "failed" };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: "failed" };
  }
  const payload = record(body);
  const conversation = parseConversation(payload?.conversation);
  if (payload === null || conversation === null || !Array.isArray(payload.turns)) {
    return { status: "failed" };
  }
  const turns = payload.turns
    .map(parseTurn)
    .filter((turn): turn is AssistantTurn => turn !== null);
  return { conversation, status: "ready", turns };
}

export type StartOutcome =
  | { readonly status: "opened"; readonly conversation: AssistantConversation }
  | { readonly status: "failed"; readonly code: AssistantErrorCode };

/**
 * Open a conversation, carrying the server's own refusal when it refuses.
 *
 * The code matters here rather than being detail: a signed-out session, a deactivated tenant and an
 * unreachable server all fail this call, and "The assistant could not be reached just now" is the
 * wrong sentence for the first two. The workspace renders `assistantErrorMessage`, so the code has
 * to survive the trip.
 */
export async function startConversation(
  scope: AssistantScope,
  fetcher: typeof fetch = fetch,
): Promise<StartOutcome> {
  let response: Response;
  try {
    response = await fetcher(CONVERSATIONS, {
      body: JSON.stringify({ scope }),
      credentials: "same-origin",
      headers: JSON_HEADERS,
      method: "POST",
    });
  } catch {
    return failed("ASSISTANT_UNAVAILABLE");
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const code = record(body)?.error;
    return failed(isErrorCode(code) ? code : "ASSISTANT_UNAVAILABLE");
  }
  const conversation = parseConversation(record(body)?.conversation);
  return conversation === null ? failed("ASSISTANT_UNAVAILABLE") : { conversation, status: "opened" };
}

/**
 * A hard delete, and `true` only when the server said so.
 *
 * The rail removes the row on `true` and says the delete failed otherwise. Removing it optimistically
 * and letting the next list read put it back is how a person watches their own history reappear
 * and stops trusting the control.
 */
export async function removeConversation(
  conversationId: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetcher(`${CONVERSATIONS}/${conversationId}`, {
      credentials: "same-origin",
      method: "DELETE",
    });
    return response.status === 204;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Asking
// ---------------------------------------------------------------------------------------------

export type AskOutcome =
  | {
      readonly status: "answered";
      readonly turn: AssistantTurn;
      readonly conversation: AssistantConversation;
    }
  | { readonly status: "failed"; readonly code: AssistantErrorCode };

/**
 * Ask one question and report each stage as the server reports it.
 *
 * `onStage` is called from the stream and from nowhere else. There is no timer in this module, no
 * synthetic first stage, and no stage inferred from elapsed time — the whole reason the response is
 * NDJSON rather than JSON is that the stages are real, and inventing one here would spend that for
 * nothing.
 */
export async function askQuestion(
  conversationId: string,
  question: string,
  onProgress: (event: AssistantProgressEvent) => void,
  fetcher: typeof fetch = fetch,
): Promise<AskOutcome> {
  let response: Response;
  try {
    response = await fetcher(`${CONVERSATIONS}/${conversationId}/turns`, {
      body: JSON.stringify({ question }),
      credentials: "same-origin",
      headers: JSON_HEADERS,
      method: "POST",
    });
  } catch {
    return failed("ASSISTANT_UNAVAILABLE");
  }

  // A refusal that happens before the stream opens is ordinary JSON with an ordinary status, and
  // the route says so in its own header comment. Reading the code out of it rather than mapping
  // the status keeps one vocabulary between the two shapes.
  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    const code = record(body)?.error;
    return failed(isErrorCode(code) ? code : "ASSISTANT_UNAVAILABLE");
  }

  if (response.body === null) return failed("ASSISTANT_UNAVAILABLE");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let carry = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const read = readStreamLines(chunk, carry);
      carry = read.carry;
      for (const event of read.events) {
        const line = record(event);
        if (line === null) continue;
        if ("stage" in line) {
          // An unknown stage is dropped rather than shown. The orb's own fallback already covers
          // "a stream is open and has not named its stage".
          if (isAssistantStage(line.stage)) {
            if (line.stage === "reading") {
              const titles = Array.isArray(line.titles) ? line.titles.filter(text) : [];
              onProgress({ stage: "reading", titles });
            } else {
              onProgress({ stage: line.stage });
            }
          }
          continue;
        }
        if ("error" in line) {
          return failed(isErrorCode(line.error) ? line.error : "ASSISTANT_UNAVAILABLE");
        }
        if ("answer" in line) {
          const answer = record(line.answer);
          const turn = parseTurn(answer?.turn);
          const conversation = parseConversation(answer?.conversation);
          if (turn === null || conversation === null) return failed("ASSISTANT_UNAVAILABLE");
          return { conversation, status: "answered", turn };
        }
      }
    }
  } catch {
    return failed("ASSISTANT_UNAVAILABLE");
  } finally {
    reader.releaseLock();
  }

  // The stream ended after a stage line. That is a dropped connection, not an answer, and the
  // difference is the whole reason the format has a terminal object.
  return failed("ASSISTANT_UNAVAILABLE");
}
