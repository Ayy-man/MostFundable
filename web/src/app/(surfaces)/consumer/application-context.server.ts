import "server-only";

import type { SessionProfile } from "@/lib/auth/session";
import type { ConsumerApplicationContext } from "@/lib/demo/types";
import type { TrackerClient } from "@/lib/tracker";

type ListConsumerClients = (
  session: SessionProfile,
  filters: { scope: "all" },
) => Promise<TrackerClient[]>;

export async function resolveConsumerApplicationContext(
  session: SessionProfile,
  listClients?: ListConsumerClients,
): Promise<ConsumerApplicationContext | null> {
  const list = listClients ?? (await import("@/lib/tracker")).listTrackerClients;
  const clients = await list(session, { scope: "all" });
  const client = clients[0];
  return client
    ? {
        // Normalized rather than passed through, so "the row has no business
        // name" and "the field was never resolved" cannot arrive as the same
        // `undefined` — the surface branches on that distinction to decide
        // whether it may name a business at all.
        businessName: client.businessName ?? null,
        clientId: client.id,
        displayName: client.displayName,
        readiness: client.readiness ?? 0,
        stage: client.stage,
      }
    : null;
}
