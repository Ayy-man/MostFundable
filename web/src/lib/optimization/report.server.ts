import "server-only";

import { featureFlag } from "@/lib/env";

import { OptimizationReportError, reportErrorFor, templateKeyForFactor } from "./report.ts";

export { OptimizationReportError, parseReportRequest, reportErrorFor } from "./report.ts";
export type {
  ConsumerReportActionV1,
  OptimizationReportErrorCode,
  OptimizationReportRequest,
} from "./report.ts";

/**
 * The RPC seam.
 *
 * `lib/db/types.ts` is generated from the ledger and does not yet name migration 391's function, so
 * the call goes through the same narrow structural interface `lib/analysis/repository.ts` and
 * `lib/kb/repository.ts` use. That is a typing accommodation and nothing more: it widens no
 * privilege, and the call it makes is the one call this module can make.
 */
interface RpcClient {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

/**
 * The signed-in consumer's own Supabase client, and deliberately never the admin one — for exactly
 * the reason `read.server.ts` gives, only more so. `report_checklist_item` resolves the client it
 * writes to from `auth.uid()`; a service-role caller carries no `auth.uid()`, so routing this
 * through the admin client would not merely widen the check, it would leave the function with
 * nothing to resolve and turn a scoped write into a refusal or, worse, a write against whatever
 * the next author decided to pass instead.
 */
async function sessionClient(): Promise<RpcClient> {
  if (!featureFlag("FEATURE_REAL_AUTH")) throw new OptimizationReportError("forbidden");
  const { createClient } = await import("@/lib/supabase/server");
  return (await createClient()) as unknown as RpcClient;
}

/**
 * Record that this consumer reported, or un-reported, one of their own checklist factors.
 *
 * Takes no client id and returns no row. The row it wrote is not the answer a caller wants anyway:
 * the surface re-reads the whole Optimization view afterwards, so it re-renders from what the
 * database says rather than from what this function claims it did.
 */
export async function reportChecklistItem(input: {
  readonly factorKey: string;
  readonly action: "report" | "undo";
}): Promise<void> {
  const templateKey = templateKeyForFactor(input.factorKey);
  const db = await sessionClient();
  const { error } = await db.rpc("report_checklist_item", {
    p_action: input.action,
    p_template_key: templateKey,
  });
  if (error !== null && error !== undefined) throw reportErrorFor(error);
}
