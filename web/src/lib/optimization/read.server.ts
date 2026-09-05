import "server-only";

import { featureFlag } from "@/lib/env";

import { isMissingColumnError, OptimizationDataError, readConsumerOptimizationWith } from "./read.ts";

import type { SessionProfile } from "@/lib/auth/session";
import type { ConsumerChecklistStateRow, ConsumerOptimizationSourceV1 } from "./map.ts";
import type { OptimizationGateway } from "./read.ts";
import type { ConsumerOptimizationV1 } from "./types.ts";

export { OptimizationDataError } from "./read.ts";
export type { OptimizationErrorCode, OptimizationGateway } from "./read.ts";
export type { ConsumerOptimizationV1 } from "./types.ts";

/**
 * The signed-in consumer's own Supabase client, and deliberately never the admin one.
 *
 * `read.server.ts` modules elsewhere in this repo fall back to `createAdminClient()` when
 * `FEATURE_REAL_AUTH` is off, because the frozen demo session carries no JWT. This read does not
 * take that fallback, for the same reason `listAssistantTrackerClients` refuses it: the admin
 * client runs as `service_role`, which bypasses RLS entirely, and the whole guarantee here is that
 * a consumer sees their own client record and nothing else. With the flag off there is no session
 * to scope by, so the honest answer is a refusal rather than a service-role read that happens to
 * have a WHERE clause we wrote correctly today.
 *
 * Every predicate below therefore runs twice: once as the explicit `.eq("client_id", …)` and once
 * as the table's own `can_access_client` RLS policy. Neither is load-bearing alone.
 */
async function sessionClient() {
  if (!featureFlag("FEATURE_REAL_AUTH")) throw new OptimizationDataError("forbidden");
  const { createClient } = await import("@/lib/supabase/server");
  return createClient();
}

type SupabaseLike = Awaited<ReturnType<typeof sessionClient>>;

function readFailed(error: unknown): never {
  if (error instanceof OptimizationDataError) throw error;
  throw new OptimizationDataError("read_failed");
}

async function resolveConsumerClientIds(db: SupabaseLike, session: SessionProfile): Promise<string[]> {
  const { data, error } = await db
    .from("clients")
    .select("id")
    .eq("consumer_profile_id", session.id)
    .eq("status", "active");
  if (error) readFailed(error);
  return (data ?? []).map((row) => row.id);
}

async function readLatestPlan(
  db: SupabaseLike,
  clientId: string,
): Promise<ConsumerOptimizationSourceV1["plan"]> {
  // Highest version wins. `plans` is append-only per analysis run, so ordering by version rather
  // than created_at keeps two rows written in the same second from resolving arbitrarily.
  //
  // The narrative rides the SAME row as the plan body on purpose: it is prose written about that
  // one plan, so reading it from a second query could pair a narrative with a body from a
  // different analysis run the moment a worker writes between the two.
  //
  // The column list is a `string` rather than a literal, and that is load-bearing rather than
  // style: the generated database types are regenerated from the migration ledger, so until 435 is
  // applied `plans.narrative` is not in them and a literal select resolves to a compile error for
  // a column this code is deliberately prepared to find missing. A widened column list asks the
  // client for rows instead of asking the type checker about the schema, which is the right
  // question when the answer is a runtime fallback either way.
  const columns: string = "body, readiness_score, narrative";
  const { data, error } = await db
    .from("plans")
    .select(columns)
    .eq("client_id", clientId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (!isMissingColumnError(error, "narrative")) readFailed(error);
    // Pre-435 database: same row, same predicates, without the column that does not exist. The
    // property is left OFF the result rather than set to null, so the shape says "not read" and
    // the guard reaches the same answer either way.
    const fallback = await db
      .from("plans")
      .select("body, readiness_score")
      .eq("client_id", clientId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (fallback.error) readFailed(fallback.error);
    if (!fallback.data) return null;
    return { body: fallback.data.body as unknown, readinessScore: fallback.data.readiness_score };
  }
  if (!data) return null;
  // A widened column list gives up the generated row type with it, so the three columns this
  // query names are re-stated here. `body` and `narrative` stay `unknown` — both are jsonb and
  // both are guarded downstream — and nothing else on the row is reachable through this shape.
  const row = data as unknown as { body: unknown; narrative?: unknown; readiness_score: number };
  return { body: row.body, narrative: row.narrative, readinessScore: row.readiness_score };
}

async function readLatestRun(
  db: SupabaseLike,
  clientId: string,
): Promise<ConsumerOptimizationSourceV1["run"]> {
  const { data, error } = await db
    .from("analysis_runs")
    .select("ran_at, trigger, readiness_score, derived")
    .eq("client_id", clientId)
    .order("ran_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) readFailed(error);
  if (!data) return null;
  return {
    derived: data.derived as unknown,
    ranAt: data.ran_at,
    readinessScore: data.readiness_score,
    trigger: data.trigger,
  };
}

/**
 * The durable checklist rows, keyed by template.
 *
 * Read as three flat queries joined here rather than as one PostREST embed: `checklist_item_state`
 * reaches `checklist_items` through a COMPOSITE foreign key, and the embed syntax for those is the
 * part of PostgREST most likely to resolve to a different relationship after a schema change. Flat
 * reads with an explicit client_id predicate cannot silently start returning another client's rows.
 */
async function readChecklistStates(
  db: SupabaseLike,
  clientId: string,
): Promise<ConsumerChecklistStateRow[]> {
  const [itemsResult, statesResult, templatesResult] = await Promise.all([
    db.from("checklist_items").select("id, template_id").eq("client_id", clientId),
    db
      .from("checklist_item_state")
      .select("checklist_item_id, state, reported_at, verifying_at, verified_at")
      .eq("client_id", clientId),
    db.from("checklist_templates").select("id, key"),
  ]);
  if (itemsResult.error || statesResult.error || templatesResult.error) {
    readFailed(itemsResult.error ?? statesResult.error ?? templatesResult.error);
  }

  const templateKeyById = new Map((templatesResult.data ?? []).map((row) => [row.id, row.key]));
  const templateIdByItemId = new Map((itemsResult.data ?? []).map((row) => [row.id, row.template_id]));

  const rows: ConsumerChecklistStateRow[] = [];
  for (const state of statesResult.data ?? []) {
    const templateId = templateIdByItemId.get(state.checklist_item_id);
    if (templateId === undefined) continue;
    const templateKey = templateKeyById.get(templateId);
    if (templateKey === undefined) continue;
    rows.push({
      reportedAt: state.reported_at,
      state: state.state,
      templateKey,
      verifiedAt: state.verified_at,
      verifyingAt: state.verifying_at,
    });
  }
  return rows;
}

export async function createOptimizationGateway(): Promise<OptimizationGateway> {
  const db = await sessionClient();
  return {
    readChecklistStates: (clientId) => readChecklistStates(db, clientId),
    readLatestPlan: (clientId) => readLatestPlan(db, clientId),
    readLatestRun: (clientId) => readLatestRun(db, clientId),
    resolveConsumerClientIds: (session) => resolveConsumerClientIds(db, session),
  };
}

/**
 * Read the signed-in consumer's Optimization view, or null when they have no workspace yet.
 *
 * Throws `OptimizationDataError` — `forbidden` for a role or a flag state that must not read this,
 * `read_failed` for anything the database refused. The route turns those into 403 and 503; neither
 * is ever rendered as an empty view.
 */
export async function readConsumerOptimization(
  session: SessionProfile,
): Promise<ConsumerOptimizationV1 | null> {
  return readConsumerOptimizationWith(session, await createOptimizationGateway());
}
