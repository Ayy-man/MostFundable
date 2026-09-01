import type { TrackerClient } from "./types";

export interface ConsentAuthorizationEvent {
  authorized: boolean;
  clientId: string;
  id: string;
  occurredAt: string;
}

function isLaterEvent(
  candidate: ConsentAuthorizationEvent,
  current: ConsentAuthorizationEvent,
): boolean {
  const candidateAt = Date.parse(candidate.occurredAt);
  const currentAt = Date.parse(current.occurredAt);
  if (!Number.isFinite(candidateAt)) return false;
  if (!Number.isFinite(currentAt) || candidateAt > currentAt) return true;
  if (candidateAt < currentAt) return false;

  // Match private.monitoring_authorized: a withdrawal wins an exact timestamp
  // tie, then the lexically greatest append-only id breaks the remaining tie.
  if (candidate.authorized !== current.authorized) return !candidate.authorized;
  return candidate.id > current.id;
}

export function latestAuthorizationByClient(
  events: readonly ConsentAuthorizationEvent[],
): ReadonlyMap<string, boolean> {
  const latest = new Map<string, ConsentAuthorizationEvent>();
  for (const event of events) {
    const current = latest.get(event.clientId);
    if (!current || isLaterEvent(event, current)) latest.set(event.clientId, event);
  }
  return new Map(Array.from(latest, ([clientId, event]) => [clientId, event.authorized]));
}

export function monitoringState(
  enrollmentStatus: string | null | undefined,
  authorized: boolean,
): TrackerClient["monitoring"] {
  if (enrollmentStatus === "cancelled") return "paused";
  if (enrollmentStatus === "active") return authorized ? "active" : "paused";
  return "pending";
}
