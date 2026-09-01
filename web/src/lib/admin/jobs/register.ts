import { registerCadenceProvider, registerJobHandler } from "@/lib/jobs/registry";
import { validateJobTuple } from "@/lib/jobs/definitions";

import { runKpiRollup } from "../analytics.ts";

import type { CadenceProvider, JobHandler, JobTuple } from "@/lib/jobs/types";

// Postgres `uuid` shape (see ADMIN_UUID): the cadence reads real org/profile ids,
// and the seeded demo orgs (a0000000-…) are not RFC-4122.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface KpiCadenceTargetSource {
  listOrgIds(): Promise<readonly string[]>;
  listMemberIds(): Promise<readonly string[]>;
}

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function subjects(source: { orgIds: readonly string[]; memberIds: readonly string[] }): string[] {
  const values = [
    "platform",
    ...source.orgIds.map((id) => `org:${id}`),
    ...source.memberIds.map((id) => `member:${id}`),
  ];
  if (source.orgIds.some((id) => !UUID.test(id)) || source.memberIds.some((id) => !UUID.test(id))) {
    throw new Error("ADMIN_KPI_TARGET_INVALID");
  }
  return [...new Set(values)].sort();
}

export function createKpiCadenceProvider(source: KpiCadenceTargetSource): CadenceProvider {
  return async (now) => {
    const [orgIds, memberIds] = await Promise.all([source.listOrgIds(), source.listMemberIds()]);
    const window = utcDay(now);
    return subjects({ orgIds, memberIds }).map((subject) =>
      validateJobTuple({ job: "kpi.rollup", subject, window }));
  };
}

interface QueryPayload { data: Array<{ id: string }> | null; error: unknown }
interface TargetQuery extends PromiseLike<QueryPayload> {
  eq(column: string, value: string): TargetQuery;
  neq(column: string, value: string): TargetQuery;
}
interface TargetDb {
  from(table: "orgs" | "profiles"): { select(columns: "id"): TargetQuery };
}

async function productionSource(): Promise<KpiCadenceTargetSource> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const client = createAdminClient() as unknown as TargetDb;
  const read = async (query: TargetQuery, code: string) => {
    const { data, error } = await query;
    if (error) throw new Error(code);
    return (data ?? []).map((row) => row.id);
  };
  return {
    listOrgIds: () => read(client.from("orgs").select("id").neq("membership", "deactivated"), "ADMIN_KPI_TARGETS_READ_FAILED"),
    listMemberIds: () => read(client.from("profiles").select("id").eq("role", "operator_member"), "ADMIN_KPI_TARGETS_READ_FAILED"),
  };
}

export function registerAdminJobs(dependencies: {
  handler?: JobHandler;
  targetSource?: KpiCadenceTargetSource;
} = {}): void {
  registerJobHandler("kpi.rollup", dependencies.handler ?? runKpiRollup, "FEATURE_ADMIN");
  registerCadenceProvider("kpi.rollup", dependencies.targetSource
    ? createKpiCadenceProvider(dependencies.targetSource)
    : async (now): Promise<readonly JobTuple[]> => createKpiCadenceProvider(await productionSource())(now), "FEATURE_ADMIN");
}

registerAdminJobs();
