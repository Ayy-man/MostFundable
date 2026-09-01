import "server-only";

import { featureFlag, type EnvSource } from "@/lib/env";

import {
  buildMonitoringReadingResult,
  unavailableMonitoringReading,
  type MonitoringAnalysisRunRow,
  type MonitoringReadingResult,
} from "./read-result.ts";
import { monitoringReadSource } from "./read-source.ts";

import type { SessionProfile } from "@/lib/auth/session";

export type { MonitoringReadingResult } from "./read-result.ts";

/**
 * What the credit panel is told, and the only thing it is told.
 *
 * The browser receives finished numbers and never a seed, so the derivation stays server-side and
 * a client cannot ask for a different file by editing a request.
 */
async function dataClient() {
  if (featureFlag("FEATURE_REAL_AUTH")) {
    const { createClient } = await import("@/lib/supabase/server");
    return createClient();
  }
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

/**
 * Derive the monitoring reading for the signed-in consumer's workspace.
 *
 * The client is resolved from the SESSION rather than accepted as an argument, exactly as
 * `/api/refresh-now` resolves it: a consumer whose session does not scope to precisely one
 * workspace gets no reading rather than a guess. The run rows are then read through the session's
 * own client, so `analysis_runs`' RLS predicate (`can_access_client`) is what authorizes the read
 * — this module adds no privilege of its own and never touches the admin client under real auth.
 */
export async function readMonitoringReading(
  session: SessionProfile,
  env: EnvSource = process.env,
): Promise<MonitoringReadingResult> {
  const source = monitoringReadSource(env);

  // Failures THROW; they are never folded into `available: false`. The route turns the throw into
  // a 503 the surface has to disclose, while a provider-owned `available: false` remains the
  // healthy, explicit "current scores unavailable" answer.
  const { listTrackerClients } = await import("@/lib/tracker");
  const clients = await listTrackerClients(session, { scope: "all" });
  if (clients.length !== 1) return unavailableMonitoringReading(source);
  const clientId = clients[0].id;

  const db = await dataClient();
  const { data, error } = await db
    .from("analysis_runs")
    .select("id, ran_at, trigger")
    .eq("client_id", clientId)
    .order("ran_at", { ascending: true });
  if (error) throw new Error("MONITORING_READING_READ_FAILED");
  // Provider results deliberately carry schedule/job metadata only. No CRS adapter is imported or
  // called here, so the server never fetches, proxies or stores consumer bureau values.
  return buildMonitoringReadingResult((data ?? []) as MonitoringAnalysisRunRow[], source);
}
