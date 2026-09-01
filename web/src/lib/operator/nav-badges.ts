"use client";

// What the sidebar counters are allowed to say.
//
// The Clients badge was a literal `4` in the `navSections` module constant
// while the Dashboard, the Clients list and the pipeline all counted the
// durable book through `useTrackerClients`, so a signed-in operator read 6
// clients one inch below a badge that said 4.
//
// The rule this module encodes is the one the surface already learned the hard
// way: which source a counter reads is decided by the server-provided
// `trackerEnabled` on the first paint, never by whether a fetch has landed.
// Deriving it from the read renders the fixture number and then swaps it, and a
// badge that flickers 4 -> 6 is worse than either number on its own. So on the
// durable path the badge is either a count that came out of a completed read of
// the whole book, or no badge at all.

export interface TrackerBookRead {
  readonly clients: readonly unknown[];
  readonly enabled: boolean | null;
  readonly error: boolean;
  readonly loading: boolean;
}

/**
 * The durable book's size, or null when there is no answer to show yet.
 *
 * `enabled === true` is the load-bearing condition. The hook resets to its
 * inactive state whenever the tracker is not the active view, and that state
 * carries an empty client list — reading it as a count would put a confident
 * `0` on the badge from the Tasks page.
 */
export function durableClientCount(read: TrackerBookRead): number | null {
  if (read.enabled !== true || read.loading || read.error) return null;
  return read.clients.length;
}

/**
 * `undefined` means render no badge, which is what `NavItem.badge` treats as
 * absent. It is the honest answer before the first durable read lands: the
 * fixture count is not this workspace's count, and a placeholder number would
 * be read as one.
 */
export function clientsNavBadge({
  fixtureCount,
  lastDurableCount,
  trackerEnabled,
}: {
  fixtureCount: number;
  lastDurableCount: number | null;
  trackerEnabled: boolean;
}): number | undefined {
  if (!trackerEnabled) return fixtureCount;
  return lastDurableCount ?? undefined;
}
