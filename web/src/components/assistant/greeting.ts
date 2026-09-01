// The greeting, built from a durable read or not built at all.
//
// The brief asks for "Morning, Avery. Two clients need attention today." — a sentence that is only
// worth having because it is true. So the second half of it is derived from the same tracker read
// the operator's own dashboard renders, and when that read has not landed or has failed there is
// no second half: `detail` is `null` and the workspace shows the salutation alone. A greeting that
// says "two clients need a look" because a fixture said so is the exact class of defect the chip
// rule in the brief names, one sentence higher up the page.
//
// The name is trimmed to its first word and refused outright if it looks like a stored key. That
// second check is not paranoia about our own session read: rail 3 says no identifier reaches the
// screen, `containsUuidShaped` is the one definition of "looks like a stored key" in this repo, and
// a greeting is the last place anybody would think to look for one.

import { containsUuidShaped } from "@/lib/kb/identifiers";

import type { TrackerClient } from "@/lib/tracker/types";

/**
 * What the greeting knows.
 *
 * Four states rather than three, because "the read failed" and "there is no durable book behind
 * this view" are opposite facts and collapsing them is how a fixture shell ends up telling somebody
 * their workspace could not be read. All of `loading`, `unavailable` and `absent` produce no
 * sentence; what differs is what the pane says around the space where it would have been.
 */
export type GreetingRead =
  | { readonly status: "loading" }
  | { readonly status: "unavailable" }
  | { readonly status: "absent" }
  | { readonly status: "operator"; readonly clients: number; readonly needAttention: number }
  | { readonly status: "admin"; readonly operators: number; readonly clients: number };

export interface AssistantGreeting {
  /** "Morning, Avery." — or "Morning." when there is no name to use. */
  readonly salutation: string;
  /** One true sentence about the book, or `null` when nothing durable has been read. */
  readonly detail: string | null;
}

/**
 * Clients that are not on track, off the same health flag the tracker book carries.
 *
 * `health` is the server's own judgement (`green` / `amber` / `red`) and archived clients are not
 * somebody's work today, so they are out. Typed against `TrackerClient` rather than against a local
 * shape so that a renamed field breaks this instead of quietly counting nothing.
 */
export function attentionCount(
  clients: readonly Pick<TrackerClient, "health" | "status">[],
): number {
  return clients.filter((client) => client.status === "active" && client.health !== "green").length;
}

export function activeCount(clients: readonly Pick<TrackerClient, "status">[]): number {
  return clients.filter((client) => client.status === "active").length;
}

/**
 * Local hours, because the person reading it is in their own day, not in UTC.
 *
 * "Morning" and not "Good morning": the clock knows which part of the viewer's day it is and
 * nothing else, so the word is a time marker rather than a wish about how the day is going. The
 * caller passes a `Date` built in the browser. That is the viewer's own clock and no other, and it
 * is safe to read during render only because this view is reached by a client-side navigation and
 * so is never in the server's HTML — if a deep link ever server-renders it, the salutation needs a
 * clock that is null until mount, or the first paint says one thing and the second says another.
 */
function partOfDay(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return "Morning";
  if (hour < 18) return "Afternoon";
  return "Evening";
}

/**
 * The first word of a display name, or nothing.
 *
 * "Avery Northbridge Demo" greets as "Avery". A name that will not survive that — empty, or
 * uuid-shaped — produces no name at all rather than a greeting addressed to a key.
 */
export function greetingName(viewerName: string | null | undefined): string | null {
  if (typeof viewerName !== "string") return null;
  const first = viewerName.trim().split(/\s+/)[0] ?? "";
  if (first.length === 0 || containsUuidShaped(first)) return null;
  return first;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function detailFor(read: GreetingRead): string | null {
  if (read.status === "operator") {
    if (read.clients === 0) return "No clients are in your book yet.";
    if (read.needAttention === 0) {
      return `All ${read.clients} ${plural(read.clients, "client", "clients")} in your book are on track today.`;
    }
    return `${read.needAttention} ${plural(read.needAttention, "client", "clients")} in your book ${plural(read.needAttention, "needs", "need")} a look today.`;
  }
  if (read.status === "admin") {
    if (read.operators === 0) return "No operator workspaces are recorded yet.";
    return `${read.operators} operator ${plural(read.operators, "workspace", "workspaces")} on the platform, ${read.clients} ${plural(read.clients, "client", "clients")} between them.`;
  }
  // Loading, unavailable and absent all say nothing. The difference between them is what the pane
  // renders around this sentence, not a different sentence.
  return null;
}

export function assistantGreeting(input: {
  readonly viewerName?: string | null;
  readonly now: Date;
  readonly read: GreetingRead;
}): AssistantGreeting {
  const name = greetingName(input.viewerName);
  const opening = partOfDay(input.now);
  return {
    detail: detailFor(input.read),
    salutation: name === null ? `${opening}.` : `${opening}, ${name}.`,
  };
}
