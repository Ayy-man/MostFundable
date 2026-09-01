import { validateJobTuple } from "@/lib/jobs/definitions";

import { KPI_METRIC_KEYS } from "./analytics-types.ts";

import type {
  AdminLayoutRow,
  AnalyticsRepository,
  KpiMetricKey,
  KpiMetrics,
  KpiRollupRow,
  KpiScope,
} from "./analytics-types.ts";
import type { JobHandlerResult } from "@/lib/jobs/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const KEY_SET = new Set<string>(KPI_METRIC_KEYS);

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function validDay(day: string): boolean {
  if (!DAY.test(day)) return false;
  const date = new Date(`${day}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === day;
}

function scopeFor(subject: string): KpiScope {
  if (subject === "platform") return "platform";
  return subject.startsWith("org:") ? "org" : "member";
}

function parseMetrics(value: unknown): KpiMetrics {
  if (!record(value) || Object.keys(value).length !== KPI_METRIC_KEYS.length) {
    throw new Error("ADMIN_KPI_RESULT_INVALID");
  }
  const output = {} as Record<KpiMetricKey, number | null>;
  for (const key of KPI_METRIC_KEYS) {
    const metric = value[key];
    if (!(metric === null || (typeof metric === "number" && Number.isFinite(metric)))) {
      throw new Error("ADMIN_KPI_RESULT_INVALID");
    }
    output[key] = metric;
  }
  return Object.freeze(output);
}

export function parseKpiRollup(value: unknown): KpiRollupRow {
  if (!record(value)) throw new Error("ADMIN_KPI_RESULT_INVALID");
  const subjectId = "subject_id" in value ? value.subject_id : value.subjectId;
  const updatedAt = "updated_at" in value ? value.updated_at : value.updatedAt;
  if (
    (value.scope !== "org" && value.scope !== "member" && value.scope !== "platform") ||
    typeof subjectId !== "string" || typeof value.day !== "string" || !validDay(value.day) ||
    typeof updatedAt !== "string" || !Number.isFinite(Date.parse(updatedAt))
  ) throw new Error("ADMIN_KPI_RESULT_INVALID");
  validateJobTuple({ job: "kpi.rollup", subject: subjectId, window: value.day });
  if (scopeFor(subjectId) !== value.scope) throw new Error("ADMIN_KPI_RESULT_INVALID");
  return Object.freeze({
    scope: value.scope,
    subjectId,
    day: value.day,
    metrics: parseMetrics(value.metrics),
    updatedAt,
  });
}

export function parseAdminLayout(value: unknown): AdminLayoutRow {
  if (!record(value)) throw new Error("ADMIN_LAYOUT_RESULT_INVALID");
  const profileId = "profile_id" in value ? value.profile_id : value.profileId;
  const updatedAt = "updated_at" in value ? value.updated_at : value.updatedAt;
  if (
    typeof profileId !== "string" || !UUID.test(profileId) ||
    !Array.isArray(value.layout) || value.layout.length < 1 || value.layout.length > 8 ||
    new Set(value.layout).size !== value.layout.length ||
    !value.layout.every((key) => typeof key === "string" && KEY_SET.has(key)) ||
    typeof updatedAt !== "string" || !Number.isFinite(Date.parse(updatedAt))
  ) throw new Error("ADMIN_LAYOUT_RESULT_INVALID");
  return Object.freeze({
    profileId,
    layout: Object.freeze([...(value.layout as KpiMetricKey[])]),
    updatedAt,
  });
}

async function productionRepository(): Promise<AnalyticsRepository> {
  const { createAnalyticsRepository } = await import("./analytics-repository.ts");
  return createAnalyticsRepository();
}

export async function runKpiRollup(
  subject: string,
  day: string,
  repository?: AnalyticsRepository,
): Promise<JobHandlerResult> {
  validateJobTuple({ job: "kpi.rollup", subject, window: day });
  if (!validDay(day)) throw new Error("ADMIN_KPI_DAY_INVALID");
  const result = await (repository ?? await productionRepository()).upsertRollup(scopeFor(subject), subject, day);
  const rows = Array.isArray(result) ? result : [result];
  if (rows.length !== 1) throw new Error("ADMIN_KPI_RESULT_INVALID");
  const parsed = parseKpiRollup(rows[0]);
  if (parsed.subjectId !== subject || parsed.day !== day) throw new Error("ADMIN_KPI_RESULT_INVALID");
  return { status: "ok", rows: 1 };
}

export async function listKpiRollups(
  subject: string,
  throughDay: string,
  repository?: AnalyticsRepository,
): Promise<readonly KpiRollupRow[]> {
  validateJobTuple({ job: "kpi.rollup", subject, window: throughDay });
  if (!validDay(throughDay)) throw new Error("ADMIN_KPI_DAY_INVALID");
  const through = new Date(`${throughDay}T00:00:00.000Z`);
  const fromDay = new Date(through.valueOf() - 89 * 86_400_000).toISOString().slice(0, 10);
  const rows = await (repository ?? await productionRepository()).listRollups(subject, fromDay, throughDay);
  return Object.freeze(rows.map(parseKpiRollup));
}

export async function readAdminLayout(
  profileId: string,
  repository?: AnalyticsRepository,
): Promise<AdminLayoutRow | null> {
  if (!UUID.test(profileId)) throw new Error("ADMIN_LAYOUT_PROFILE_INVALID");
  const row = await (repository ?? await productionRepository()).readLayout(profileId);
  if (row === null) return null;
  const parsed = parseAdminLayout(row);
  if (parsed.profileId !== profileId) throw new Error("ADMIN_LAYOUT_RESULT_INVALID");
  return parsed;
}

export async function setAdminLayout(
  profileId: string,
  layout: readonly KpiMetricKey[],
  repository?: AnalyticsRepository,
): Promise<AdminLayoutRow> {
  if (!UUID.test(profileId)) throw new Error("ADMIN_LAYOUT_PROFILE_INVALID");
  const validated = parseAdminLayout({
    profileId, layout, updatedAt: "2000-01-01T00:00:00.000Z",
  }).layout;
  const row = await (repository ?? await productionRepository()).writeLayout(profileId, validated);
  const parsed = parseAdminLayout(row);
  if (parsed.profileId !== profileId) throw new Error("ADMIN_LAYOUT_RESULT_INVALID");
  return parsed;
}

export type { AdminLayoutRow, AnalyticsRepository, KpiMetricKey, KpiMetrics, KpiRollupRow } from "./analytics-types.ts";
