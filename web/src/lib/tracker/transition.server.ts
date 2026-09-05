import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/types";
import { featureFlag } from "@/lib/env";
import type {
  AnalysisCompletedInput,
  EnrollmentActivatedInput,
  TrackerManualTransitionInput,
  TrackerStage,
  TrackerTransitionResult,
} from "./types";

type RpcRow = {
  result: Exclude<TrackerTransitionResult["outcome"], "disabled">;
  current_stage: TrackerStage | null;
  stage_entered_at: string | null;
};

type TrackerRpcClient = SupabaseClient<Database> & {
  rpc(
    name: "tracker_transition_client_stage",
    args: {
      p_actor: string | null;
      p_client_id: string;
      p_event_key: string | null;
      p_expected_from: TrackerStage;
      p_source: "manual" | "enrollment" | "analysis";
      p_to_stage: TrackerStage;
    },
  ): PromiseLike<{ data: RpcRow[] | null; error: { code?: string } | null }>;
};

export class TrackerTransitionError extends Error {
  readonly name = "TrackerTransitionError";
  readonly code: "forbidden" | "failed";

  // Written out rather than as a constructor parameter property: Node's
  // strip-only TypeScript mode rejects parameter properties, and this module is
  // now reachable from `node --test` through the Phase 7 tracker adapters.
  constructor(code: "forbidden" | "failed") {
    super("Tracker transition failed");
    this.code = code;
  }
}

const disabled = (): TrackerTransitionResult => ({
  outcome: "disabled",
  currentStage: null,
  stageEnteredAt: null,
});

export async function transitionClientStage(
  input: TrackerManualTransitionInput,
): Promise<TrackerTransitionResult> {
  if (!featureFlag("FEATURE_TRACKER")) return disabled();
  const [{ requireOrgMember }, { createClient }, { assertTenantWriteAllowed }] = await Promise.all([
    import("@/lib/auth/session"),
    import("@/lib/supabase/server"),
    import("@/lib/tenancy/wall"),
  ]);
  const session = await requireOrgMember();
  await assertTenantWriteAllowed(session);
  const db = await createClient();
  return callTransition(db as TrackerRpcClient, {
    p_actor: session.id,
    p_client_id: input.clientId,
    p_event_key: null,
    p_expected_from: input.expectedStage,
    p_source: "manual",
    p_to_stage: input.stage,
  });
}

export async function onEnrollmentActivated(
  input: EnrollmentActivatedInput,
): Promise<TrackerTransitionResult> {
  return automaticTransition({
    clientId: input.clientId,
    eventKey: `enrollment:${input.enrollmentId}:active`,
    source: "enrollment",
  });
}

export async function onAnalysisCompleted(
  input: AnalysisCompletedInput,
): Promise<TrackerTransitionResult> {
  return automaticTransition({
    clientId: input.clientId,
    eventKey: `analysis:${input.analysisRunId}:complete`,
    source: "analysis",
  });
}

async function automaticTransition(input: {
  clientId: string;
  eventKey: string;
  source: "enrollment" | "analysis";
}): Promise<TrackerTransitionResult> {
  if (!featureFlag("FEATURE_TRACKER")) return disabled();
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return callTransition(createAdminClient() as TrackerRpcClient, {
    p_actor: null,
    p_client_id: input.clientId,
    p_event_key: input.eventKey,
    p_expected_from: "onboarding",
    p_source: input.source,
    p_to_stage: "optimization",
  });
}

async function callTransition(
  db: TrackerRpcClient,
  args: Parameters<TrackerRpcClient["rpc"]>[1],
): Promise<TrackerTransitionResult> {
  const { data, error } = await db.rpc("tracker_transition_client_stage", args);
  if (error) throw new TrackerTransitionError(error.code === "42501" ? "forbidden" : "failed");
  const row = data?.[0];
  if (!row) throw new TrackerTransitionError("failed");
  return {
    outcome: row.result,
    currentStage: row.current_stage,
    stageEnteredAt: row.stage_entered_at,
  };
}
