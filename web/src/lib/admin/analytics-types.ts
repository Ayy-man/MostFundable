export const KPI_METRIC_KEYS = [
  "activeUsers",
  "operators",
  "currentMonitoring",
  "trialConversionPct",
  "averageMonthlyPlanCents",
  "averageMembershipDays",
  "aiUsage",
  "fundedOutcomesCents",
] as const;

export type KpiMetricKey = (typeof KPI_METRIC_KEYS)[number];
export type KpiScope = "org" | "member" | "platform";
export type KpiMetrics = Readonly<Record<KpiMetricKey, number | null>>;

export type KpiRollupRow = Readonly<{
  scope: KpiScope;
  subjectId: string;
  day: string;
  metrics: KpiMetrics;
  updatedAt: string;
}>;

export type AdminLayoutRow = Readonly<{
  profileId: string;
  layout: readonly KpiMetricKey[];
  updatedAt: string;
}>;

export interface AnalyticsRepository {
  upsertRollup(scope: KpiScope, subjectId: string, day: string): Promise<unknown>;
  listRollups(subjectId: string, fromDay: string, throughDay: string): Promise<readonly unknown[]>;
  readLayout(profileId: string): Promise<unknown | null>;
  writeLayout(profileId: string, layout: readonly KpiMetricKey[]): Promise<unknown>;
}
