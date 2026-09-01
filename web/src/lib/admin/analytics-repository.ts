import "server-only";

import type { AnalyticsRepository, KpiMetricKey, KpiScope } from "./analytics-types.ts";

type QueryPayload = { data: unknown[] | null; error: unknown };
interface QueryResult extends PromiseLike<QueryPayload> {
  eq(column: string, value: unknown): QueryResult;
  gte(column: string, value: string): QueryResult;
  lte(column: string, value: string): QueryResult;
  order(column: string, options: { ascending: boolean }): QueryResult;
  limit(value: number): QueryResult;
}
interface AnalyticsDb {
  from(table: "kpi_rollups" | "admin_layouts"): { select(columns: string): QueryResult };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<QueryPayload>;
}

async function defaultClient(): Promise<AnalyticsDb> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient() as unknown as AnalyticsDb;
}

export function createAnalyticsRepository(
  createClient: () => unknown | Promise<unknown> = defaultClient,
): AnalyticsRepository {
  let clientPromise: Promise<AnalyticsDb> | null = null;
  const client = () => (clientPromise ??= Promise.resolve(createClient()).then((value) => value as AnalyticsDb));
  return {
    async upsertRollup(scope: KpiScope, subjectId: string, day: string) {
      const { data, error } = await (await client()).rpc("admin_upsert_kpi_rollup", {
        p_scope: scope, p_subject_id: subjectId, p_day: day,
      });
      if (error) throw new Error("ADMIN_KPI_WRITE_FAILED");
      return data;
    },
    async listRollups(subjectId, fromDay, throughDay) {
      const { data, error } = await (await client()).from("kpi_rollups")
        .select("scope,subject_id,day,metrics,updated_at")
        .eq("subject_id", subjectId).gte("day", fromDay).lte("day", throughDay)
        .order("day", { ascending: true }).limit(90);
      if (error) throw new Error("ADMIN_KPI_READ_FAILED");
      return data ?? [];
    },
    async readLayout(profileId) {
      const { data, error } = await (await client()).from("admin_layouts")
        .select("profile_id,layout,updated_at").eq("profile_id", profileId).limit(2);
      if (error) throw new Error("ADMIN_LAYOUT_READ_FAILED");
      if (!data || data.length === 0) return null;
      if (data.length !== 1) throw new Error("ADMIN_LAYOUT_RESULT_INVALID");
      return data[0];
    },
    async writeLayout(profileId, layout: readonly KpiMetricKey[]) {
      const { data, error } = await (await client()).rpc("admin_set_layout", {
        p_actor: profileId, p_layout: layout,
      });
      if (error) throw new Error("ADMIN_LAYOUT_WRITE_FAILED");
      if (!data || data.length !== 1) throw new Error("ADMIN_LAYOUT_RESULT_INVALID");
      return data[0];
    },
  };
}
