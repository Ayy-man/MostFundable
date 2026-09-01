// web/src/lib/crs/session-reader.ts — the caller-session port, wired to the merged session layer.
//
// Phase 4 shipped `createUnauthenticatedSessionReader` (token.ts) because lane A's session helper
// was not on that branch, and its NEXT note said to replace it after the auth merge. Phase 5
// swapped the store, resolver and fan-out and left the reader behind, so `GET /api/monitoring/token`
// answered 401 to every caller in production wiring — including the Milestone-2 script's beat 3.
//
// This reader identifies the caller through the same session layer every other route uses (demo
// header/cookie with FEATURE_REAL_AUTH off, the Supabase cookie with it on) and maps a consumer to
// the client row that carries them (`clients.consumer_profile_id`, read through the tracker's own
// visibility rules — the same call `POST /api/refresh-now` makes). Anyone else — no session, an
// operator, an admin, an affiliate, a consumer with no client — gets `null`, which the token handler
// turns into 401 (threat T-04-22 still holds: no identifiable consumer, no token).
//
// The session and tracker modules are imported lazily inside the call, not at module scope, so
// `wiring.ts` keeps its Node-testable module graph and the webhook route (which never resolves a
// caller) does not pull `next/headers` into a path that has no request.

import type { SessionProfile } from '../auth/session.ts';
import type { CallerSessionReader } from './token.ts';

export interface SessionCallerReaderDeps {
  getSession(): Promise<SessionProfile | null>;
  listConsumerClientIds(session: SessionProfile): Promise<readonly string[]>;
}

async function productionDeps(): Promise<SessionCallerReaderDeps> {
  const [{ getSession }, { listTrackerClients }] = await Promise.all([
    import('../auth/session.ts'),
    import('../tracker/index.ts'),
  ]);
  return {
    getSession,
    async listConsumerClientIds(session) {
      const clients = await listTrackerClients(session, { scope: 'all' });
      return clients.map((client) => client.id);
    },
  };
}

export function createSessionCallerReader(
  loadDeps: () => Promise<SessionCallerReaderDeps> = productionDeps,
): CallerSessionReader {
  return {
    async resolveClientId(): Promise<string | null> {
      const deps = await loadDeps();
      const session = await deps.getSession();
      if (session === null || session.role !== 'consumer') return null;
      const [clientId] = await deps.listConsumerClientIds(session);
      return clientId ?? null;
    },
  };
}
