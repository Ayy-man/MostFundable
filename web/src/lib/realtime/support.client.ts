"use client";

// The two subscriptions a support surface opens, and nothing else.
//
// Every decision worth testing lives in `./support.ts`; this file is the wiring
// that knows about Supabase channels. It is deliberately thin, because the
// parts it owns — a channel name, a filter string, a cleanup — are the parts a
// test of a mocked client would only re-state.
//
// Two properties this file has to hold:
//
//   1. `onStatus` is driven by the channel's own reports, not by the fact that
//      `subscribe()` was called. The lane contract forbids rendering "live" from
//      a successful subscribe alone, and the status machine in `./support.ts` is
//      where that is decided.
//   2. Nothing here writes. A subscription is a read, `authenticated` holds no
//      insert grant on either published table, and Realtime re-checks every row
//      against the same select policy a page read meets — so a subscriber
//      receives exactly the rows they could have fetched.

import {
  createChannelStatusMachine,
  createTypingRoster,
  createTypingThrottle,
  mapRealtimeMessage,
  mapRealtimeThread,
  TYPING_EXPIRY_MS,
  type ChannelEvent,
  type RealtimeStatus,
  type SupportMessage,
  type SupportThread,
} from "@/lib/realtime/support";

export type {
  RealtimeStatus,
  SupportMessage,
  SupportThread,
} from "@/lib/realtime/support";

export interface ThreadSubscriptionHandlers {
  onMessage: (message: SupportMessage) => void;
  onThreadChange: (thread: SupportThread) => void;
  onStatus: (status: RealtimeStatus) => void;
}

/**
 * Watch one thread: its messages as they arrive, and its own row as it changes.
 *
 * Returns the unsubscribe. It is synchronous even though the Supabase client is
 * imported dynamically, because a caller unmounting before the import resolves
 * still has to be able to cancel — the flag below is what makes that safe.
 */
export function subscribeToThread(
  threadId: string,
  handlers: ThreadSubscriptionHandlers,
): () => void {
  const status = createChannelStatusMachine();
  let disposed = false;
  let teardown: (() => void) | null = null;

  handlers.onStatus(status.status);

  void (async () => {
    const { createClient } = await import("@/lib/supabase/client");
    if (disposed) return;

    const supabase = createClient();
    const channel = supabase
      .channel(`support:thread:${threadId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          filter: `thread_id=eq.${threadId}`,
          schema: "public",
          table: "support_messages",
        },
        (payload: { new: unknown }) => {
          // A row that does not map is dropped rather than half-rendered. The
          // pane's next read brings it back correctly; an empty bubble would
          // not go away.
          const message = mapRealtimeMessage(payload.new);
          if (message !== null) handlers.onMessage(message);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          filter: `id=eq.${threadId}`,
          schema: "public",
          table: "support_threads",
        },
        (payload: { new: unknown }) => {
          const thread = mapRealtimeThread(payload.new);
          if (thread !== null) handlers.onThreadChange(thread);
        },
      );

    channel.subscribe((event: string) => {
      handlers.onStatus(status.observe(event as ChannelEvent));
    });

    teardown = () => {
      void supabase.removeChannel(channel);
    };
    if (disposed) teardown();
  })();

  return () => {
    disposed = true;
    teardown?.();
    teardown = null;
  };
}

export interface TypingHandlers {
  onTyping: (labels: readonly string[]) => void;
}

export interface TypingSubscription {
  /** Call on each keystroke. Throttled to at most one publish per 2s. */
  publish: () => void;
  stop: () => void;
}

/**
 * Who else is typing in this thread.
 *
 * A presence channel rather than a table, because "typing" is not a fact worth
 * storing: it is true for six seconds and then it is not, and a row recording it
 * would outlive its own truth.
 *
 * `self.label` is a display name the caller has already resolved. No id crosses
 * this channel — an id in a presence payload is never rendered, so it would
 * never be caught, which is exactly why it must not be sent.
 */
export function subscribeToTyping(
  threadId: string,
  self: { label: string },
  handlers: TypingHandlers,
): TypingSubscription {
  const roster = createTypingRoster();
  let disposed = false;
  let teardown: (() => void) | null = null;
  let send: (() => void) | null = null;
  let expiry: ReturnType<typeof setTimeout> | null = null;

  function announce() {
    handlers.onTyping(roster.labels(Date.now()));
    // One re-read after the expiry window, so a roster that empties out with no
    // further traffic still stops claiming somebody is typing. It is a re-read
    // of a clock, not a state change: nothing is published from in here.
    if (expiry !== null) clearTimeout(expiry);
    expiry = setTimeout(() => {
      if (!disposed) handlers.onTyping(roster.labels(Date.now()));
    }, TYPING_EXPIRY_MS);
  }

  const throttle = createTypingThrottle({
    cancel: (handle) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
    now: () => Date.now(),
    publish: () => {
      send?.();
    },
    schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  });

  void (async () => {
    const { createClient } = await import("@/lib/supabase/client");
    if (disposed) return;

    const supabase = createClient();
    const channel = supabase.channel(`support:typing:${threadId}`, {
      config: { broadcast: { self: false } },
    });

    channel.on(
      "broadcast",
      { event: "typing" },
      (payload: { payload?: { label?: unknown } }) => {
        const label = payload.payload?.label;
        if (typeof label !== "string" || label === self.label) return;
        roster.observe(label, Date.now());
        announce();
      },
    );

    channel.subscribe();

    send = () => {
      void channel.send({ event: "typing", payload: { label: self.label }, type: "broadcast" });
    };

    teardown = () => {
      void supabase.removeChannel(channel);
    };
    if (disposed) teardown();
  })();

  return {
    publish: () => {
      if (!disposed) throttle.publish();
    },
    stop: () => {
      disposed = true;
      throttle.stop();
      if (expiry !== null) clearTimeout(expiry);
      expiry = null;
      teardown?.();
      teardown = null;
      send = null;
    },
  };
}
