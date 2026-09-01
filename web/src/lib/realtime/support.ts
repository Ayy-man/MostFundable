// The parts of a support subscription that do not need a browser.
//
// Everything here is pure or takes its clock and its scheduler as arguments, so
// the interesting behaviour — what the live indicator is allowed to say, how
// often a typing signal may leave the tab, when a name stops being "typing" —
// is testable without a socket. `support.client.ts` is the thin half that knows
// about Supabase.
//
// The split earns its keep on one property in particular. The lane contract
// says a surface may not render "live" from a successful subscribe call alone,
// and the reason is that a channel can subscribe, drop, and keep retrying while
// the indicator still claims to be live. That rule lives in the status machine
// below, where a test can drive it through the drop.

import type { SupportMessageRow, SupportThreadRow } from '@/lib/support';

/**
 * The row shapes a subscriber receives, named as the lane contract names them.
 *
 * They are aliases rather than copies: a realtime payload is the same row a
 * page read returns, and a second declaration would be a second thing to keep
 * in step with `support_messages`. The import is type-only and erased at
 * compile time, so nothing from the support library reaches a browser bundle.
 */
export type SupportMessage = SupportMessageRow;
export type SupportThread = SupportThreadRow;

/** What a live indicator is allowed to say. */
export type RealtimeStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

/** The four outcomes `channel.subscribe()` reports. */
export type ChannelEvent = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED';

export interface ChannelStatusMachine {
  readonly status: RealtimeStatus;
  observe(event: ChannelEvent): RealtimeStatus;
}

/**
 * How many consecutive failures before a channel that never connected is called
 * offline rather than connecting.
 *
 * Something has to bound it. Supabase retries on its own, so a naive machine
 * sits on "connecting" for as long as the tab is open, and an indicator that
 * says "connecting" for ten minutes is telling the reader something false in a
 * way they cannot check.
 */
export const OFFLINE_AFTER_FAILURES = 3;

export function createChannelStatusMachine(
  offlineAfterFailures: number = OFFLINE_AFTER_FAILURES,
): ChannelStatusMachine {
  let status: RealtimeStatus = 'connecting';
  let failures = 0;
  let everLive = false;

  return {
    get status() {
      return status;
    },
    observe(event) {
      if (event === 'SUBSCRIBED') {
        everLive = true;
        failures = 0;
        status = 'live';
        return status;
      }
      // A closed channel is not being retried, so there is nothing to wait for
      // and saying "reconnecting" would be an invitation to keep waiting.
      if (event === 'CLOSED') {
        status = 'offline';
        return status;
      }
      failures += 1;
      // Having been live once is what makes "reconnecting" true: the transport
      // is retrying a connection that worked. Before that it is still a first
      // attempt, until enough of them have failed to call it what it is.
      status = everLive
        ? 'reconnecting'
        : failures >= offlineAfterFailures
          ? 'offline'
          : 'connecting';
      return status;
    },
  };
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------
//
// A realtime payload arrives in the database's own column names, not the
// camel-case shape the routes answer with, so it has to be mapped here. Both
// mappers return null rather than a partial row: a message with no body or a
// thread with no status would render as an empty bubble or an unlabelled row,
// and dropping it is the honest failure — the next page read brings it back
// correctly.

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

const AUTHOR_KINDS = new Set(['consumer', 'operator', 'admin']);
const ORIGINS = new Set(['human', 'ai_assisted']);
const VISIBILITIES = new Set(['participants', 'internal']);
const THREAD_KINDS = new Set(['team_chat', 'platform_support']);
const THREAD_STATUSES = new Set(['open', 'pending', 'resolved']);

export function mapRealtimeMessage(value: unknown): SupportMessage | null {
  const row = record(value);
  if (row === null) return null;

  const id = text(row, 'id');
  const threadId = text(row, 'thread_id');
  const authorProfileId = text(row, 'author_profile_id');
  const authorKind = text(row, 'author_kind');
  const origin = text(row, 'origin');
  const visibility = text(row, 'visibility');
  const body = text(row, 'body');
  const sentAt = text(row, 'sent_at');

  if (
    id === null
    || threadId === null
    || authorProfileId === null
    || authorKind === null
    || !AUTHOR_KINDS.has(authorKind)
    || origin === null
    || !ORIGINS.has(origin)
    // An unrecognised visibility is dropped rather than defaulted. The default
    // that looks safe is the one that would put an internal note in front of the
    // person it was written about.
    || visibility === null
    || !VISIBILITIES.has(visibility)
    || body === null
    || sentAt === null
  ) {
    return null;
  }

  return {
    authorKind: authorKind as SupportMessage['authorKind'],
    authorProfileId,
    body,
    id,
    origin: origin as SupportMessage['origin'],
    originDraftId: text(row, 'origin_draft_id'),
    sentAt,
    threadId,
    visibility: visibility as SupportMessage['visibility'],
  };
}

export function mapRealtimeThread(value: unknown): SupportThread | null {
  const row = record(value);
  if (row === null) return null;

  const id = text(row, 'id');
  const kind = text(row, 'kind');
  const orgId = text(row, 'org_id');
  const status = text(row, 'status');
  const subject = text(row, 'subject');
  const createdBy = text(row, 'created_by');
  const createdAt = text(row, 'created_at');
  const lastActivityAt = text(row, 'last_activity_at');

  if (
    id === null
    || kind === null
    || !THREAD_KINDS.has(kind)
    || orgId === null
    || status === null
    || !THREAD_STATUSES.has(status)
    || subject === null
    || createdBy === null
    || createdAt === null
    || lastActivityAt === null
  ) {
    return null;
  }

  return {
    clientId: text(row, 'client_id'),
    createdAt,
    createdBy,
    id,
    kind: kind as SupportThread['kind'],
    lastActivityAt,
    orgId,
    status: status as SupportThread['status'],
    subject,
  };
}

// ---------------------------------------------------------------------------
// Typing
// ---------------------------------------------------------------------------

/** At most one presence publish per this many milliseconds. */
export const TYPING_PUBLISH_INTERVAL_MS = 2_000;

/** A name stops being "typing" this long after its last signal. */
export const TYPING_EXPIRY_MS = 6_000;

export interface TypingThrottle {
  /** Called on every keystroke. Publishes at most once per interval. */
  publish(): void;
  /** Stop publishing and cancel anything pending. */
  stop(): void;
}

export interface TypingThrottleOptions {
  readonly intervalMs?: number;
  cancel(handle: unknown): void;
  now(): number;
  publish(): void;
  schedule(callback: () => void, delayMs: number): unknown;
}

/**
 * Leading-edge throttle with a trailing publish.
 *
 * Leading, because the first keystroke should show up immediately — a typing
 * indicator that waits two seconds is worse than none. Trailing, because a
 * person typing continuously would otherwise publish once and then let their
 * own indicator expire under them at six seconds.
 */
export function createTypingThrottle(options: TypingThrottleOptions): TypingThrottle {
  const intervalMs = options.intervalMs ?? TYPING_PUBLISH_INTERVAL_MS;
  let lastPublishedAt: number | null = null;
  let pending: unknown | null = null;
  let stopped = false;

  function send() {
    lastPublishedAt = options.now();
    options.publish();
  }

  return {
    publish() {
      if (stopped) return;
      const now = options.now();
      if (lastPublishedAt === null || now - lastPublishedAt >= intervalMs) {
        send();
        return;
      }
      if (pending !== null) return;
      pending = options.schedule(() => {
        pending = null;
        if (!stopped) send();
      }, intervalMs - (now - lastPublishedAt));
    },
    stop() {
      stopped = true;
      if (pending !== null) {
        options.cancel(pending);
        pending = null;
      }
    },
  };
}

export interface TypingRoster {
  /** Record that `label` signalled at `at`. */
  observe(label: string, at: number): void;
  /** The labels still typing as of `at`, sorted, with duplicates collapsed. */
  labels(at: number): readonly string[];
}

/**
 * Who is typing, and for how long that stays true.
 *
 * Expiry is read at query time rather than swept by a timer. A timer would make
 * this module something that acts on its own, and there is nothing here for a
 * timer to do that reading a clock cannot: a label whose last signal is older
 * than the expiry is simply not returned.
 *
 * Labels are display names resolved by the caller. No id crosses the channel,
 * which is rail 3 of the lane contract applied to a place nobody looks — a
 * presence payload is not rendered, so an id in one would never be noticed.
 */
export function createTypingRoster(expiryMs: number = TYPING_EXPIRY_MS): TypingRoster {
  const seen = new Map<string, number>();

  return {
    observe(label, at) {
      const trimmed = label.trim();
      if (trimmed.length === 0) return;
      seen.set(trimmed, at);
    },
    labels(at) {
      const live: string[] = [];
      for (const [label, when] of seen) {
        if (at - when < expiryMs) live.push(label);
        else seen.delete(label);
      }
      return live.sort((left, right) => left.localeCompare(right));
    },
  };
}
