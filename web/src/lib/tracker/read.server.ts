import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { SessionProfile } from "@/lib/auth/session";
import type { Database } from "@/lib/db/types";
import { featureFlag } from "@/lib/env";
import { buildConsumerOptimization, type ConsumerChecklistStateRow } from "@/lib/optimization/map";
import { openActionCount } from "@/lib/optimization/view-model";
import { latestAuthorizationByClient, monitoringState, type ConsentAuthorizationEvent } from "./consent-state";
import { validateTrackerHealthRows } from "./health";
import {
  isTrackerAssigneeOrgRole,
  isTrackerUuid,
  type TrackerAssignableMember,
  type TrackerClient,
  type TrackerClientCreateInput,
  type TrackerClientStatus,
  type TrackerCreateResult,
  type TrackerMetadataPatch,
  type TrackerReadFilters,
} from "./types";

type Db = SupabaseClient<Database>;
type OrgSession = SessionProfile & { orgId: string };
interface ClientRow {
  id: string;
  consumer_profile_id: string | null;
  display_name: string;
  business_name: string | null;
  assigned_to: string | null;
  stage: Database["public"]["Enums"]["client_stage"];
  stage_entered_at: string;
  started_at: string;
  goal_cents: number | null;
  matches_unlocked_override: boolean;
  funded_amount_cents: number;
  status: TrackerClientStatus;
  last_activity_at: string;
  archived_at: string | null;
  archived_by: string | null;
}
interface ClientQuery extends PromiseLike<{ data: ClientRow[] | null; error: unknown }> {
  eq(column: string, value: unknown): ClientQuery;
  in(column: string, values: readonly string[]): ClientQuery;
  is(column: string, value: null): ClientQuery;
  order(column: string, options: { ascending: boolean }): ClientQuery;
}

const CLIENT_COLUMNS = "id, consumer_profile_id, display_name, business_name, assigned_to, stage, stage_entered_at, started_at, goal_cents, matches_unlocked_override, funded_amount_cents, status, last_activity_at, archived_at, archived_by";

export class TrackerDataError extends Error {
  readonly name = "TrackerDataError";
  readonly code: "read_failed" | "write_failed" | "forbidden" | "invalid_assignee";

  // Not a constructor parameter property: Node's strip-only TypeScript mode
  // rejects those, and the tracker modules are reachable from `node --test`.
  constructor(code: "read_failed" | "write_failed" | "forbidden" | "invalid_assignee") {
    super("Tracker operation failed");
    this.code = code;
  }
}

async function dataClient(): Promise<Db> {
  if (featureFlag("FEATURE_REAL_AUTH")) {
    const { createClient } = await import("@/lib/supabase/server");
    return createClient();
  }
  // The frozen demo session is header-selected and has no auth JWT. Keep the
  // same tenant predicate in this adapter until lane A replaces that session.
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

async function visibleClientRows(
  db: Db,
  session: SessionProfile,
  filters: TrackerReadFilters,
  clientId?: string,
): Promise<ClientRow[]> {
  let query = (db.from("clients") as unknown as { select(columns: string): ClientQuery }).select(CLIENT_COLUMNS);
  if (filters.status !== "all") {
    query = query.eq("status", filters.status ?? "active");
  }

  if (session.role === "consumer") {
    query = query.eq("consumer_profile_id", session.id);
  } else if (session.role === "operator_member" && session.orgId) {
    query = query.eq("org_id", session.orgId);
    const { data: org, error: orgError } = await db
      .from("orgs")
      .select("team_sees_all_clients")
      .eq("id", session.orgId)
      .maybeSingle();
    if (orgError || !org) throw new TrackerDataError("read_failed");

    const broad = org.team_sees_all_clients || ["owner", "admin", "commando"].includes(session.orgRole ?? "");
    if (filters.scope === "mine") {
      query = query.eq("assigned_to", session.id);
    } else if (!broad && session.orgRole === "manager") {
      query = query.in("assigned_to", [session.id, ...session.manages]);
    } else if (!broad) {
      query = query.eq("assigned_to", session.id);
    }

    if (filters.stage) query = query.eq("stage", filters.stage);
    if (filters.member) query = query.eq("assigned_to", filters.member);
    if (filters.affiliate === "none") query = query.is("affiliate_id", null);
    else if (filters.affiliate) query = query.eq("affiliate_id", filters.affiliate);
  } else {
    throw new TrackerDataError("forbidden");
  }

  if (clientId) query = query.eq("id", clientId);
  const { data, error } = await query.order("created_at", { ascending: true });
  if (error) throw new TrackerDataError("read_failed");
  return data as unknown as ClientRow[];
}

export async function listTrackerClients(
  session: SessionProfile,
  filters: TrackerReadFilters = { scope: "all" },
): Promise<TrackerClient[]> {
  const db = await dataClient();
  return hydrate(db, await visibleClientRows(db, session, filters));
}

export async function listTrackerAssignableMembers(
  session: SessionProfile,
): Promise<TrackerAssignableMember[]> {
  if (session.role !== "operator_member" || !session.orgId) return [];
  const db = await dataClient();
  const { data, error } = await db
    .from("profiles")
    .select("id, full_name, org_role, disabled_at")
    .eq("org_id", session.orgId)
    .eq("role", "operator_member")
    .is("disabled_at", null)
    .order("full_name", { ascending: true });
  if (error) throw new TrackerDataError("read_failed");
  const members: TrackerAssignableMember[] = [];
  for (const row of data ?? []) {
    if (
      !isTrackerUuid(row.id)
      || typeof row.full_name !== "string"
      || row.full_name.trim().length === 0
      || row.disabled_at !== null
      || !isTrackerAssigneeOrgRole(row.org_role)
    ) throw new TrackerDataError("read_failed");
    members.push({
      active: true,
      fullName: row.full_name,
      id: row.id,
      isCurrentUser: row.id === session.id,
      orgRole: row.org_role,
    });
  }
  return members;
}

/**
 * Assistant reads must never reach the demo-mode admin fallback or the
 * service-scoped analysis queue decoration. The same signed-in Supabase client
 * and `visibleClientRows` predicate used by the tracker surface remain the
 * authorization boundary; only assistant-safe enrichments are hydrated.
 */
export async function listAssistantTrackerClients(
  session: SessionProfile,
  filters: TrackerReadFilters = { scope: "all" },
): Promise<TrackerClient[]> {
  if (!featureFlag("FEATURE_REAL_AUTH")) throw new TrackerDataError("forbidden");
  const { createClient } = await import("@/lib/supabase/server");
  const db = await createClient();
  return hydrate(db, await visibleClientRows(db, session, filters), {
    includeEnrollment: false,
    includePendingAnalysis: false,
  });
}

export async function readTrackerClient(
  session: SessionProfile,
  clientId: string,
): Promise<TrackerClient | null> {
  const db = await dataClient();
  const rows = await visibleClientRows(db, session, { scope: "all" }, clientId);
  const clients = await hydrate(db, rows);
  return clients[0] ?? null;
}

/**
 * `analysis_jobs` deliberately grants nothing to `authenticated` (migration
 * 030), so the session client cannot read it and this lookup runs on the admin
 * client instead. That does not widen visibility: the ids come from
 * `visibleClientRows`, which the session's own RLS predicate has already
 * filtered, and the only thing returned per authorized id is a coarse
 * queued/running hint. A failure here degrades to "no hint" rather than
 * failing the whole tracker read — waiting-state decoration must never take
 * down the verified data beside it.
 */
async function pendingAnalysisByClient(ids: readonly string[]): Promise<Map<string, "queued" | "running">> {
  const pending = new Map<string, "queued" | "running">();
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { data, error } = await createAdminClient()
      .from("analysis_jobs")
      .select("client_id, status")
      .in("client_id", ids as string[])
      .in("status", ["queued", "running", "persisted"]);
    if (error) return pending;
    for (const row of data ?? []) {
      if (row.client_id === null) continue;
      // "persisted" means the run's result is written and the job is
      // finishing, so the nearest honest hint is still "running".
      const hint = row.status === "queued" ? "queued" : "running";
      if (hint === "running" || !pending.has(row.client_id)) pending.set(row.client_id, hint);
    }
  } catch {
    // Admin client unavailable (misconfiguration) — the hint is optional.
  }
  return pending;
}

async function hydrate(
  db: Db,
  rows: ClientRow[],
  options: { includeEnrollment?: boolean; includePendingAnalysis?: boolean } = {},
): Promise<TrackerClient[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const assigneeIds = rows.flatMap((row) => (row.assigned_to ? [row.assigned_to] : []));
  const healthPromise = (db as unknown as {
    rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
  }).rpc("tracker_client_health_batch", { p_client_ids: ids });
  const [historyResult, analysisResult, planResult, checklistResult, checklistItemsResult, checklistTemplatesResult, enrollmentResult, consentResult, revocationResult, assigneeResult, healthResult, pendingByClient] = await Promise.all([
    db.from("stage_history").select("client_id, from_stage, to_stage, changed_at, changed_by").in("client_id", ids).order("changed_at", { ascending: true }),
    db.from("analysis_runs").select("id, client_id, ran_at, trigger, readiness_score, derived").in("client_id", ids).order("ran_at", { ascending: false }),
    db.from("plans").select("client_id, version, body, readiness_score").in("client_id", ids).order("version", { ascending: false }),
    db.from("checklist_item_state").select("client_id, checklist_item_id, state, reported_at, verifying_at, verified_at").in("client_id", ids),
    db.from("checklist_items").select("id, client_id, template_id").in("client_id", ids),
    db.from("checklist_templates").select("id, key"),
    options.includeEnrollment === false
      ? Promise.resolve({ data: [], error: null })
      : db.from("enrollments").select("client_id, status, monitoring_consent_at").in("client_id", ids),
    options.includeEnrollment === false
      ? Promise.resolve({ data: [], error: null })
      : db.from("consents").select("id, client_id, signed_at").in("client_id", ids).eq("kind", "monitoring").eq("action", "granted"),
    options.includeEnrollment === false
      ? Promise.resolve({ data: [], error: null })
      : db.from("consent_revocations").select("id, client_id, revoked_at").in("client_id", ids).eq("kind", "monitoring"),
    assigneeIds.length
      ? db.from("profiles").select("id, full_name, org_role, disabled_at").in("id", assigneeIds)
      : Promise.resolve({ data: [], error: null }),
    healthPromise,
    options.includePendingAnalysis === false
      ? Promise.resolve(new Map<string, "queued" | "running">())
      : pendingAnalysisByClient(ids),
  ]);

  if (historyResult.error || analysisResult.error || planResult.error || checklistResult.error || checklistItemsResult.error || checklistTemplatesResult.error || enrollmentResult.error || consentResult.error || revocationResult.error || assigneeResult.error || healthResult.error || !Array.isArray(healthResult.data)) {
    throw new TrackerDataError("read_failed");
  }
  let healthByClient: ReadonlyMap<string, "green" | "amber" | "red">;
  try {
    healthByClient = validateTrackerHealthRows(ids, healthResult.data as Array<{ client_id: string; health: unknown; health_rank: unknown }>);
  } catch {
    throw new TrackerDataError("read_failed");
  }

  const assignees = new Map((assigneeResult.data ?? []).map((row) => [row.id, row]));
  const latestAnalysis = new Map<string, {
    derived: unknown;
    ran_at: string;
    readiness_score: number;
    trigger: string;
  }>();
  for (const row of analysisResult.data ?? []) if (!latestAnalysis.has(row.client_id)) latestAnalysis.set(row.client_id, row);
  const latestPlan = new Map<string, { body: unknown; readiness_score: number }>();
  for (const row of planResult.data ?? []) if (!latestPlan.has(row.client_id)) latestPlan.set(row.client_id, row);
  const histories = new Map<string, TrackerClient["history"]>();
  for (const row of historyResult.data ?? []) {
    const entries = histories.get(row.client_id) ?? [];
    entries.push({ at: row.changed_at, changedBy: row.changed_by, from: row.from_stage, to: row.to_stage });
    histories.set(row.client_id, entries);
  }
  const checklistItem = new Map((checklistItemsResult.data ?? []).map((item) => [item.id, item]));
  const checklistTemplateKey = new Map((checklistTemplatesResult.data ?? []).map((template) => [template.id, template.key]));
  const checklistByClient = new Map<string, ConsumerChecklistStateRow[]>();
  for (const state of checklistResult.data ?? []) {
    const item = checklistItem.get(state.checklist_item_id);
    const templateKey = item === undefined ? undefined : checklistTemplateKey.get(item.template_id);
    if (item === undefined || item.client_id !== state.client_id || templateKey === undefined) continue;
    const entries = checklistByClient.get(state.client_id) ?? [];
    entries.push({
      reportedAt: state.reported_at,
      state: state.state,
      templateKey,
      verifiedAt: state.verified_at,
      verifyingAt: state.verifying_at,
    });
    checklistByClient.set(state.client_id, entries);
  }
  const enrollments = new Map((enrollmentResult.data ?? []).map((row) => [row.client_id, row]));
  const consentEvents: ConsentAuthorizationEvent[] = [
    ...(consentResult.data ?? []).map((row) => ({ authorized: true, clientId: row.client_id, id: row.id, occurredAt: row.signed_at })),
    ...(revocationResult.data ?? []).map((row) => ({ authorized: false, clientId: row.client_id, id: row.id, occurredAt: row.revoked_at })),
  ];
  const monitoringAuthorized = latestAuthorizationByClient(consentEvents);

  return rows.map((row) => {
    const analysis = latestAnalysis.get(row.id);
    const plan = latestPlan.get(row.id);
    const enrollment = enrollments.get(row.id);
    const assignee = row.assigned_to === null ? undefined : assignees.get(row.assigned_to);
    const nextRefreshAt = analysis
      ? new Date(Date.parse(analysis.ran_at) + 30 * 86_400_000).toISOString()
      : null;
    return {
      id: row.id,
      consumerProfileId: row.consumer_profile_id,
      displayName: row.display_name,
      businessName: row.business_name,
      assignedToId: row.assigned_to,
      assignedToName: assignee?.full_name ?? null,
      assignedToOrgRole: assignee?.org_role ?? null,
      assignedToActive: assignee === undefined ? null : assignee.disabled_at === null,
      stage: row.stage,
      stageEnteredAt: row.stage_entered_at,
      startedAt: row.started_at,
      history: histories.get(row.id) ?? [],
      analysisAt: analysis?.ran_at ?? null,
      analysisPending: pendingByClient.get(row.id) ?? null,
      readiness: analysis?.readiness_score ?? null,
      openActionCount: analysis === undefined && plan === undefined
        ? null
        : openActionCount(buildConsumerOptimization({
            checklistStates: checklistByClient.get(row.id) ?? [],
            clientId: row.id,
            plan: plan === undefined ? null : { body: plan.body, readinessScore: plan.readiness_score },
            run: analysis === undefined
              ? null
              : {
                  derived: analysis.derived,
                  ranAt: analysis.ran_at,
                  readinessScore: analysis.readiness_score,
                  trigger: analysis.trigger,
                },
          })),
      estimatedCompletionAt: null,
      monitoring: monitoringState(enrollment?.status, monitoringAuthorized.get(row.id) === true),
      nextRefreshAt,
      goalCents: row.goal_cents,
      matchesUnlockedOverride: row.matches_unlocked_override,
      // funded_amount_cents defaults to 0 and only a recorded funding sets it;
      // 0 therefore means "no recorded outcome", which the surfaces spell null.
      fundingApprovedCents: row.funded_amount_cents > 0 ? row.funded_amount_cents : null,
      health: healthByClient.get(row.id)!,
      status: row.status,
      lastActivityAt: row.last_activity_at,
      archivedAt: row.archived_at,
      archivedById: row.archived_by,
    } satisfies TrackerClient;
  });
}

export async function setTrackerClientStatus(
  session: SessionProfile,
  clientId: string,
  status: TrackerClientStatus,
): Promise<TrackerClient | null> {
  if (session.role !== "operator_member" || !session.orgId) throw new TrackerDataError("forbidden");
  const db = await dataClient();
  const result = await (db as unknown as {
    rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
  }).rpc("set_client_status", { p_client_id: clientId, p_status: status, p_actor: session.id });
  if (result.error) throw new TrackerDataError("write_failed");
  return mutationReadbackClient({ ...session, orgId: session.orgId }, clientId);
}

export async function createTrackerClient(
  session: OrgSession,
  input: TrackerClientCreateInput,
): Promise<TrackerCreateResult> {
  const db = await dataClient();

  if (input.consumerProfileId) {
    const { data: profile, error } = await db.from("profiles")
      .select("id")
      .eq("id", input.consumerProfileId)
      .eq("org_id", session.orgId)
      .eq("role", "consumer")
      .maybeSingle();
    if (error) throw new TrackerDataError("read_failed");
    if (!profile) return { outcome: "invalid_profile" };

    const existing = await findOrgConsumer(db, session.orgId, input.consumerProfileId);
    if (existing) {
      const client = await readTrackerClient(session, existing.id);
      if (!client) throw new TrackerDataError("read_failed");
      return { outcome: "existing", client, assignmentRequired: existing.assigned_to === null };
    }
  }

  if (input.affiliateId) {
    const { data: affiliate, error } = await db.from("affiliates").select("id").eq("id", input.affiliateId).eq("org_id", session.orgId).maybeSingle();
    if (error) throw new TrackerDataError("read_failed");
    if (!affiliate) return { outcome: "conflict" };
  }

  // No RETURNING, on purpose. Under FEATURE_REAL_AUTH this insert runs on the
  // session client, and Postgres applies the SELECT policy to any row an
  // INSERT ... RETURNING hands back. `clients_select_authenticated` decides
  // through `private.can_access_client(id)`, which re-queries this table by
  // id — and a query inside the same command cannot see the row that command
  // is inserting, so the policy answers false and the whole insert dies with
  // 42501 for every real operator session (found live on the deployment,
  // 2026-08-19; reproduced locally byte-for-byte). The id is minted here
  // instead, and `readTrackerClient` below fetches the row in its own
  // statement, where the policy can see it.
  const createdId = crypto.randomUUID();
  const { error } = await db.from("clients").insert({
    id: createdId,
    org_id: session.orgId,
    consumer_profile_id: input.consumerProfileId ?? null,
    display_name: input.displayName,
    business_name: input.businessName ?? null,
    affiliate_id: input.affiliateId ?? null,
    goal_cents: input.goalCents ?? null,
    assigned_to: null,
    stage: "onboarding",
  });

  if (error) {
    if (error.code === "23505" && input.consumerProfileId) {
      const existing = await findOrgConsumer(db, session.orgId, input.consumerProfileId);
      if (existing) {
        const client = await readTrackerClient(session, existing.id);
        if (!client) throw new TrackerDataError("read_failed");
        return { outcome: "existing", client, assignmentRequired: existing.assigned_to === null };
      }
      return { outcome: "conflict" };
    }
    throw new TrackerDataError("write_failed");
  }

  const client = await readTrackerClient(session, createdId);
  if (!client) throw new TrackerDataError("read_failed");
  return { outcome: "created", client, assignmentRequired: true };
}

async function findOrgConsumer(db: Db, orgId: string, consumerProfileId: string) {
  const { data, error } = await db.from("clients")
    .select("id, assigned_to")
    .eq("org_id", orgId)
    .eq("consumer_profile_id", consumerProfileId)
    .maybeSingle();
  if (error) throw new TrackerDataError("read_failed");
  return data;
}

export async function updateTrackerClientMetadata(
  session: OrgSession,
  clientId: string,
  patch: TrackerMetadataPatch,
): Promise<TrackerClient | null> {
  const before = await readTrackerClient(session, clientId);
  if (!before) return null;
  const db = await dataClient();
  const update: Database["public"]["Tables"]["clients"]["Update"] = {};
  if (patch.assignedToId !== undefined) {
    if (patch.assignedToId !== null) {
      const { data: assignee, error: assigneeError } = await db
        .from("profiles")
        .select("id")
        .eq("id", patch.assignedToId)
        .eq("org_id", session.orgId)
        .eq("role", "operator_member")
        .is("disabled_at", null)
        .maybeSingle();
      if (assigneeError) throw new TrackerDataError("read_failed");
      if (!assignee) throw new TrackerDataError("invalid_assignee");
    }
    update.assigned_to = patch.assignedToId;
  }
  if (patch.businessName !== undefined) update.business_name = patch.businessName;
  if (patch.displayName !== undefined) update.display_name = patch.displayName;
  if (patch.goalCents !== undefined) update.goal_cents = patch.goalCents;
  if (patch.matchesUnlockedOverride !== undefined) update.matches_unlocked_override = patch.matchesUnlockedOverride;
  const { count, error } = await db
    .from("clients")
    .update(update, { count: "exact" })
    .eq("id", clientId)
    .eq("org_id", session.orgId)
    .eq("status", "active");
  if (error) throw new TrackerDataError("write_failed");
  if (count !== 1) return null;
  return mutationReadbackClient(session, clientId);
}

/**
 * A successful reassignment can intentionally move the row outside the
 * caller's subsequent team-scoped SELECT policy. The mutation was authorized
 * against the pre-write row; this read-back is service scoped but remains
 * pinned to that caller's organization and exact client id.
 */
async function mutationReadbackClient(
  session: OrgSession,
  clientId: string,
): Promise<TrackerClient | null> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();
  const query = (db.from("clients") as unknown as { select(columns: string): ClientQuery })
    .select(CLIENT_COLUMNS)
    .eq("org_id", session.orgId)
    .eq("id", clientId);
  const { data, error } = await query.order("created_at", { ascending: true });
  if (error) throw new TrackerDataError("read_failed");
  const clients = await hydrate(db, data as unknown as ClientRow[]);
  return clients[0] ?? null;
}
