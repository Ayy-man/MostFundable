"use client";

/**
 * The thread's state machine.
 *
 * The shape it is in is the whole fix for F-01. The old view mounted in `loading`, chained three
 * requests, and rendered the sentence "Loading the conversation..." as unstyled text in a 600px
 * void for 3,536ms before resolving to a conversation it could have been rendered with. So the
 * first thing this hook does is ask what the server already handed over, and `ready` on the first
 * render — before any effect runs, before any fetch — is the ordinary case rather than the lucky
 * one.
 *
 * The five states are the five `PaneState` states and they are not interchangeable:
 *
 *   `fixture`   nobody read anything: the demo shell, behind the demo-environment bar. The only
 *               state that may show a written conversation, and unreachable under real auth.
 *   `disabled`  `FEATURE_SUPPORT` is off on a real-auth page. Says so; shows nothing invented.
 *   `loading`   the server answered `null` and the browser bootstrap is out. A skeleton shaped
 *               like the conversation, never a sentence.
 *   `error`     the bootstrap or a re-read failed. Says what failed, offers the retry, and
 *               **never** falls back to a written conversation (rail 5).
 *   `ready`     durable messages, from the server read or from the bootstrap.
 *
 * Two things this hook deliberately does not do.
 *
 * It does not poll, defer, or retry on its own. Every request below runs from an effect that a
 * state change caused or from a handler a person operated — `lib/support/surface-contract.test.ts`
 * holds every component that can reach `/api/support/` to `verify-no-auto-send.mjs`'s own deferral
 * vocabulary, and the rail that test guards is the reason this product can say a person sends
 * every message.
 *
 * And it does not re-derive `unreadCount`. That number comes from `support_list_thread_digest`;
 * counting the rows in hand would be a second answer that disagrees the moment a message lands
 * between the read and the render.
 */

import { useCallback, useEffect, useState } from "react";

import { subscribeToThread, type RealtimeStatus } from "@/lib/realtime/support.client";
import { postSupportThreadRead } from "@/lib/operator/support-inbox.client";
import type {
  ConsumerTeamChatSnapshot,
  SupportMessageRow,
  SupportThreadRead,
  SupportThreadRow,
} from "@/lib/support";

import { bootstrapTeamChat, readTeamChat, sendTeamChatMessage } from "./transport";

export type TeamChatState =
  | { readonly kind: "fixture" }
  | { readonly kind: "disabled" }
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | {
      readonly kind: "ready";
      readonly thread: SupportThreadRow;
      readonly messages: readonly SupportMessageRow[];
      readonly read: SupportThreadRead;
    };

export interface TeamChat {
  readonly state: TeamChatState;
  /** The channel's own report, never "the subscribe call returned" (contract §3.3). */
  readonly connection: RealtimeStatus | null;
  /** True while a send is out. The composer's own busy state, not the thread's. */
  readonly sending: boolean;
  /** Resolves false when the message did not go, which keeps the text in the composer. */
  readonly send: (body: string) => Promise<boolean>;
  /** The error state's way out, and the reconnect path. */
  readonly retry: () => void;
}

/**
 * What the server handed over, as a starting state.
 *
 * The three meanings of the prop are settled here and nowhere else, so a view branching on
 * `state.kind` cannot accidentally treat "the flag is off" as "the read failed".
 */
export function initialStateFrom(
  teamChat: ConsumerTeamChatSnapshot | null | undefined,
): TeamChatState {
  if (teamChat === undefined) return { kind: "fixture" };
  if (teamChat === null) return { kind: "loading" };
  if (teamChat.state === "disabled") return { kind: "disabled" };
  return {
    kind: "ready",
    messages: teamChat.messages,
    read: teamChat.read,
    thread: teamChat.thread,
  };
}

/** Append a row unless it is already held. Realtime re-delivers a send's own INSERT. */
export function withMessage(
  messages: readonly SupportMessageRow[],
  arrived: SupportMessageRow,
): readonly SupportMessageRow[] {
  if (messages.some((message) => message.id === arrived.id)) return messages;
  // Appended rather than re-sorted: `support_messages` comes back oldest first and a message that
  // arrives is by definition the newest one. Sorting on every arrival would reshuffle a thread on
  // a clock skew of a few milliseconds.
  return [...messages, arrived];
}

export function useTeamChat(teamChat: ConsumerTeamChatSnapshot | null | undefined): TeamChat {
  // Not re-synced from the prop. `teamChat` is a server value handed to a client tree once, and
  // resyncing would discard a bootstrap or a realtime arrival on the next parent render.
  const [state, setState] = useState<TeamChatState>(() => initialStateFrom(teamChat));
  const [connection, setConnection] = useState<RealtimeStatus | null>(null);
  const [sending, setSending] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const threadRef = state.kind === "ready" ? state.thread.id : null;

  // The bootstrap. Runs only from `loading`, which is only ever entered by the server answering
  // `null` or by the retry, so this cannot become a poll.
  const bootstrapping = state.kind === "loading";
  useEffect(() => {
    if (!bootstrapping) return;
    let live = true;
    void bootstrapTeamChat().then((result) => {
      if (!live) return;
      setState(
        result.state === "ready"
          ? { kind: "ready", messages: result.messages, read: result.read, thread: result.thread }
          : result.state === "disabled"
            ? { kind: "disabled" }
            : { kind: "error" },
      );
    });
    return () => {
      live = false;
    };
  }, [bootstrapping, attempt]);

  // Live arrivals. `onStatus` is what the indicator binds to — the contract forbids rendering
  // "live" from a successful subscribe alone, and the machine behind this reports the channel's
  // own events.
  useEffect(() => {
    if (threadRef === null) return;
    const stop = subscribeToThread(threadRef, {
      onMessage: (message) => {
        setState((current) =>
          current.kind === "ready"
            ? { ...current, messages: withMessage(current.messages, message) }
            : current,
        );
      },
      onStatus: setConnection,
      onThreadChange: (thread) => {
        setState((current) => (current.kind === "ready" ? { ...current, thread } : current));
      },
    });
    return stop;
  }, [threadRef]);

  // The watermark. Written when this component is mounted and the thread has resolved with at least
  // one message in it — not on a timer, and not from the rail.
  //
  // "Mounted", precisely, and not "on screen": there is no IntersectionObserver here and the hook
  // cannot tell whether the pane is scrolled into view. It is mounted only while the Team Chat view
  // is the selected one, which is close enough to "the client is looking at this" for a badge, and
  // the distinction is written down because the earlier wording claimed a precision the code does
  // not have. Keyed on the newest message's `sentAt` rather than firing per render, so one visit
  // writes once and a new message arriving writes again.
  const lastSeenAt = state.kind === "ready" ? (state.messages.at(-1)?.sentAt ?? null) : null;
  useEffect(() => {
    if (threadRef === null || lastSeenAt === null) return;
    let live = true;
    void postSupportThreadRead(threadRef, lastSeenAt).then((result) => {
      if (!live || !result.ok) return;
      setState((current) =>
        current.kind === "ready"
          ? {
              ...current,
              read: {
                // All three come from the same server answer, including the counterpart's
                // watermark: the write path re-reads the digest, so the receipt under the
                // client's own messages moves at the same moment their badge clears.
                counterpartReadAt: result.read.counterpartReadAt,
                lastReadAt: result.read.lastReadAt,
                unreadCount: result.read.unreadCount,
              },
            }
          : current,
      );
    });
    return () => {
      live = false;
    };
  }, [threadRef, lastSeenAt]);

  const retry = useCallback(() => {
    setState((current) => {
      if (current.kind === "ready") return current;
      return { kind: "loading" };
    });
    setAttempt((current) => current + 1);
  }, []);

  const send = useCallback(async (body: string): Promise<boolean> => {
    if (threadRef === null) return false;
    setSending(true);
    const written = await sendTeamChatMessage(threadRef, body);
    setSending(false);
    if (written === null) return false;
    // The row the database wrote, not the text that was typed. Realtime will deliver the same
    // INSERT a moment later and `withMessage` drops the duplicate.
    setState((current) =>
      current.kind === "ready"
        ? { ...current, messages: withMessage(current.messages, written) }
        : current,
    );
    return true;
  }, [threadRef]);

  // A reconnect re-reads rather than trusting the gap to have been empty. `subscribeToThread`
  // reports `reconnecting` from the channel's own events, so this fires on a real reconnection and
  // not on a render.
  const reconnected = connection === "live";
  useEffect(() => {
    if (!reconnected || threadRef === null) return;
    let live = true;
    void readTeamChat(threadRef).then((result) => {
      if (!live || result.state !== "ready") return;
      setState((current) =>
        current.kind === "ready"
          ? { ...current, messages: result.messages, read: result.read, thread: result.thread }
          : current,
      );
    });
    return () => {
      live = false;
    };
  }, [reconnected, threadRef]);

  return { connection, retry, send, sending, state };
}
