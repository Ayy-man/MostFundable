import "server-only";

/**
 * Who may reach a client's applications.
 *
 * This phase does not define tenancy. Phase 1's `private.can_access_client`
 * decides it in the database, and Phase 6's `readTrackerClient` is the one
 * TypeScript expression of the same rule — org scoping, the `team_sees_all_clients`
 * switch, the manager's `manages` list and the consumer's own row, all in
 * `web/src/lib/tracker/read.server.ts:57-92`. Calling it is the whole
 * implementation here, because a second predicate written in this phase would
 * drift from that one the first time either changed.
 *
 * The guard matters with `FEATURE_REAL_AUTH` off. The frozen demo session has no
 * JWT, so the repository falls back to the admin client (G-11-09) and RLS is not
 * doing the scoping; without this check an id from another organization would
 * read straight through. With the flag on, this is a second opinion that agrees
 * with the policy rather than a substitute for it.
 */

import type { SessionProfile } from "@/lib/auth/session";

/**
 * True when this session may see this client's applications.
 *
 * A platform admin reaches every client: the correction path in D-09 is
 * admin-only and an admin who cannot read the entry cannot correct it. Every
 * other role goes through the tracker's own reachability answer, and anything
 * it throws is a no — an error deciding reachability is not a reason to grant
 * it.
 */
export async function clientReachable(
  session: SessionProfile,
  clientId: string,
): Promise<boolean> {
  if (session.role === "platform_admin") return true;
  if (session.role !== "operator_member" && session.role !== "consumer") {
    return false;
  }

  try {
    const { readTrackerClient } = await import("@/lib/tracker");
    return (await readTrackerClient(session, clientId)) !== null;
  } catch {
    return false;
  }
}
