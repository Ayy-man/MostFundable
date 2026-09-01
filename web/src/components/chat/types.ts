/**
 * The shapes the chat foundation consumes.
 *
 * Lane 1a owns the runtime behind most of these — `lib/support/types.ts`, `lib/realtime/support.client.ts`
 * and `lib/assistant/types.ts` — and the names are fixed by the lane contract (§3), not by this
 * file. They are declared here so lanes 2, 3 and 4 can build against the components before that
 * lane merges, and so the components themselves depend on a shape rather than on a module that
 * does not exist yet. When 1a lands, the durable types either match these or the contract was
 * wrong; either way it is one place to reconcile, not four.
 *
 * Two vocabulary rules run through everything below.
 *
 * **Opaque handles are never rendered.** A field documented `@opaque` exists so React can key a
 * row or the caller can reopen something; it must not reach the DOM as text, as a `title`, as an
 * `aria-label`, or as a `data-` attribute a screen reader can reach. That is rail 3, and
 * `no-raw-identifiers.test.ts` beside this file checks it by deriving the `@opaque` set from the
 * doc comments here rather than from a list somebody maintains.
 *
 * **A state is reported, never inferred.** `deliveryState`, `connection` and `ThinkingOrbState`
 * all come from something that actually happened — a row the database wrote, a channel callback,
 * a stage the server emitted. None of them may be advanced on a timer to make the interface look
 * busier than the work is.
 */

import type { TimelineEvent } from "@/lib/timeline/types";

// ---------------------------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------------------------

/** The three authors a message can have, all of them people. Mirrors `SupportAuthorKind`. */
export type ChatAuthorKind = "consumer" | "operator" | "admin";

export interface ChatAuthor {
  /** Display name. A person or a workspace, never an id. */
  readonly name: string;
  readonly kind: ChatAuthorKind;
  /** What they are to the reader: "Your team", "Client", "Platform team". */
  readonly roleLabel?: string;
  /** Two letters. Derived from `name` when absent. */
  readonly initials?: string;
}

// ---------------------------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------------------------

/** Whether a person wrote it unaided or wrote it from a suggestion. Mirrors `SupportMessageOrigin`. */
export type ChatMessageOrigin = "human" | "ai_assisted";

/** Contract §3.2. RLS, not a query filter, is what keeps `internal` away from a consumer. */
export type ChatMessageVisibility = "participants" | "internal";

/**
 * How far a message got.
 *
 * `read` is only ever set from a watermark that exists (contract §3.1). A tick that says "read"
 * and means "sent" is a lie about another person's attention, and it is the specific lie §4 names.
 * Callers with no watermark stop at `delivered`.
 */
export type ChatDeliveryState = "sending" | "sent" | "delivered" | "read" | "failed";

export interface ChatAttachment {
  /** @opaque React identity and the handle the caller removes by. Never rendered. */
  readonly ref: string;
  /** Display name. Rendered. */
  readonly filename: string;
  readonly mediaType?: string;
  /** A blob or object URL the browser made. Never a storage path. */
  readonly url?: string;
  readonly sizeBytes?: number;
}

export interface ChatMessage {
  /** @opaque React identity for this row. Never rendered. */
  readonly ref: string;
  readonly author: ChatAuthor;
  readonly body: string;
  /** ISO 8601. Rendered relative, with the absolute local and UTC values alongside. */
  readonly sentAt: string;
  readonly origin: ChatMessageOrigin;
  readonly visibility: ChatMessageVisibility;
  readonly delivery: ChatDeliveryState;
  readonly attachments?: readonly ChatAttachment[];
  /** Why it failed and how to try again. Present only when `delivery` is `failed`. */
  readonly failure?: ChatSendFailure;
}

export interface ChatSendFailure {
  /** Plain sentence, shown to the person. Never a code. */
  readonly reason: string;
  readonly onRetry: () => void;
  readonly onDiscard?: () => void;
}

// ---------------------------------------------------------------------------------------------
// In-thread events
// ---------------------------------------------------------------------------------------------

/**
 * The product states that show up inside a conversation.
 *
 * These are not messages and must never be styled as one: nobody said them. They come from
 * `stage_history`, `audit_log` and the notification rail, and an event card that looks like a
 * bubble tells the reader a person announced something the system did.
 */
export type ChatEventKind =
  | "analysis_completed"
  | "stage_changed"
  | "document_uploaded"
  | "thread_resolved"
  | "thread_reopened"
  | "assigned"
  | "refresh_completed";

export interface ChatEvent {
  /** @opaque React identity. Never rendered. */
  readonly ref: string;
  readonly kind: ChatEventKind;
  /** The whole line, already written by the caller in product voice. */
  readonly summary: string;
  readonly occurredAt: string;
  /** Who caused it, when a person did. Absent for anything the system did on its own. */
  readonly actorName?: string;
}

/** One row in a thread: something somebody said, or something that happened. */
export type ChatThreadItem =
  | { readonly type: "message"; readonly message: ChatMessage }
  | {
      readonly type: "event";
      /**
       * The one-line summary the shipped thread renders through `renderEvent`.
       *
       * Optional only so that a timeline row does not have to invent one. `ChatEvent.kind` is a
       * closed set of seven, the timeline's is fifteen, and there is no honest `ChatEventKind` for a
       * fee payment or an outcome — a producer forced to pick one would be writing a summary nothing
       * reads, in a vocabulary that does not fit, for a path that never renders it. Every producer
       * that existed before `FEATURE_TIMELINE` still sets it, so the flag-off thread is unchanged.
       */
      readonly event?: ChatEvent;
      /**
       * The typed timeline event behind this row, present only behind `FEATURE_TIMELINE`.
       *
       * Exactly one of the two is what a given thread reads: the shipped thread reads `event`, and
       * the timeline reads this. A row carrying neither renders nothing at all rather than a blank.
       */
      readonly timeline?: TimelineEvent;
    };

// ---------------------------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------------------------

export type ChatThreadStatus = "open" | "pending" | "resolved";

/** The six stages, one taxonomy everywhere (CLAUDE.md). */
export type ChatClientStage =
  | "Onboarding"
  | "Optimization"
  | "Ready"
  | "Applying"
  | "Funded"
  | "Graduate";

export interface ChatThreadSummary {
  /** @opaque React identity and the handle a caller selects by. Never rendered. */
  readonly ref: string;
  /** Who the conversation is with. A name, resolved through the directory. */
  readonly title: string;
  readonly subtitle?: string;
  readonly status: ChatThreadStatus;
  readonly stage?: ChatClientStage;
  /** The last line, trimmed by the caller. Contract §3.1's `lastMessagePreview`. */
  readonly preview: string | null;
  readonly lastActivityAt: string;
  /** Server-derived (contract §3.1). The browser never computes this. */
  readonly unreadCount: number;
  /** Whose thread it is, for the team filter. A display name. */
  readonly ownerName?: string;
}

// ---------------------------------------------------------------------------------------------
// Live-ness
// ---------------------------------------------------------------------------------------------

/**
 * Contract §3.3. The UI binds its indicator to this and to nothing else — in particular not to
 * "the subscribe call returned", which is true before the socket has said anything.
 */
export type ChatConnectionStatus = "connecting" | "live" | "reconnecting" | "offline";

// ---------------------------------------------------------------------------------------------
// Pane states
// ---------------------------------------------------------------------------------------------

/**
 * The five things a pane can be. Every pane in all four views is one of them; none of them is a
 * blank card, which is the failure §1.4 of the plan names.
 */
export type PaneStatus = "loading" | "empty" | "error" | "ready" | "disabled";
