// Integrator-owned registration (Phase 17 merge): wires the two ancillary
// handlers into Phase 14's shared registry per INTERFACES §7, plus the narrow
// notification-outbox bridge P17's RESEARCH names as merge glue — the cadence
// provider copies (job, subject, window) from the exact queued dispatch view
// into `background_jobs`, and the enqueue's
// `on conflict do nothing` absorbs re-reads, so the bridge is idempotent.
import { registerCadenceProvider, registerJobHandler } from "@/lib/jobs/registry";
import { createAdminClient } from "@/lib/supabase/admin";

import { runNotificationDispatch } from "../notifications.ts";
import { listUploadedReportPurgeTargets, runUploadedReportPurge } from "../purge.ts";

import type { JobTuple } from "@/lib/jobs/types";

function utcDate(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
}

// The generated Database type does not carry the Sprint-3 tables until the
// wrap regenerates types.ts, so this reads through a structural cast the same
// way the ancillary repositories do.
type OutboxRow = { dispatch_subject: string; dispatch_window: string };
export interface NotificationCadenceDb {
  from(table: "notification_delivery_dispatch_view"): {
    select(columns: string): {
      eq(column: string, value: string): PromiseLike<{ data: OutboxRow[] | null; error: unknown }>;
    };
  };
}

/** The outbox bridge: queued outbox rows already carry the exact §7 tuple. */
export async function listQueuedNotificationTuples(
  injected?: NotificationCadenceDb,
): Promise<JobTuple[]> {
  const client = injected ?? createAdminClient() as unknown as NotificationCadenceDb;
  const { data, error } = await client
    .from("notification_delivery_dispatch_view")
    .select("dispatch_subject,dispatch_window")
    .eq("status", "queued");
  if (error) throw new Error("NOTIFICATION_OUTBOX_READ_FAILED");
  return (data ?? []).map((row) => ({
    job: "notifications.dispatch" as const,
    subject: row.dispatch_subject,
    window: row.dispatch_window,
  }));
}

function coerce(result: { status: string; rows?: number }): { status: "ok" | "skipped" | "failed"; rows?: number } {
  return { status: result.status === "ok" || result.status === "skipped" ? result.status : "failed", rows: result.rows };
}

registerJobHandler("notifications.dispatch", async (subject, window) => coerce(await runNotificationDispatch(subject, window)), "FEATURE_ANCILLARY");
registerCadenceProvider("notifications.dispatch", async () => listQueuedNotificationTuples(), "FEATURE_ANCILLARY");

registerJobHandler("purge.uploaded_reports", async (subject, window) => coerce(await runUploadedReportPurge(subject, window)), "FEATURE_ANCILLARY");
registerCadenceProvider("purge.uploaded_reports", async (now) => {
  const targets = await listUploadedReportPurgeTargets(utcDate(now));
  return targets.map((target) => ({ job: "purge.uploaded_reports" as const, subject: target.subject, window: target.window }));
}, "FEATURE_ANCILLARY");
