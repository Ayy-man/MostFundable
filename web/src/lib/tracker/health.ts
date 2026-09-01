import type { TrackerClient, TrackerHealth } from "./types.ts";

export interface TrackerHealthRow {
  client_id: string;
  health: unknown;
  health_rank: unknown;
}

const RANK: Readonly<Record<TrackerHealth, number>> = Object.freeze({
  red: 0,
  amber: 1,
  green: 2,
});

function isHealth(value: unknown): value is TrackerHealth {
  return value === "green" || value === "amber" || value === "red";
}

export function validateTrackerHealthRows(
  clientIds: readonly string[],
  rows: readonly TrackerHealthRow[],
): ReadonlyMap<string, TrackerHealth> {
  const expected = new Set(clientIds);
  const healthByClient = new Map<string, TrackerHealth>();
  if (expected.size !== clientIds.length || rows.length !== clientIds.length) {
    throw new Error("TRACKER_HEALTH_INVALID");
  }
  for (const row of rows) {
    if (!expected.has(row.client_id) || healthByClient.has(row.client_id) || !isHealth(row.health) || row.health_rank !== RANK[row.health]) {
      throw new Error("TRACKER_HEALTH_INVALID");
    }
    healthByClient.set(row.client_id, row.health);
  }
  if (healthByClient.size !== expected.size) throw new Error("TRACKER_HEALTH_INVALID");
  return healthByClient;
}

export function orderTrackerClientsByHealth(clients: readonly TrackerClient[]): TrackerClient[] {
  return clients
    .map((client, index) => ({ client, index }))
    .sort((left, right) => RANK[left.client.health] - RANK[right.client.health]
      || left.index - right.index
      || left.client.id.localeCompare(right.client.id))
    .map(({ client }) => client);
}
