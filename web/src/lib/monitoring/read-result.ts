import { deriveMonitoringReading, nextIncludedRefreshAt } from "./reading.ts";

import type { CompletedRefresh, MonitoringReading } from "./reading.ts";

export interface MonitoringAnalysisRunRow {
  readonly id: string;
  readonly ran_at: string;
  readonly trigger: string;
}

export interface MonitoringReadingResult {
  readonly available: boolean;
  readonly source: "mock" | "provider";
  readonly completedRefreshCount: number;
  readonly latestAnalysisAt: string | null;
  readonly nextRefreshAt: string | null;
  readonly reading: MonitoringReading | null;
}

export function unavailableMonitoringReading(
  source: "mock" | "provider",
): MonitoringReadingResult {
  return {
    available: false,
    completedRefreshCount: 0,
    latestAnalysisAt: null,
    nextRefreshAt: null,
    reading: null,
    source,
  };
}

export function buildMonitoringReadingResult(
  rows: readonly MonitoringAnalysisRunRow[],
  source: "mock" | "provider",
): MonitoringReadingResult {
  if (rows.length === 0) return unavailableMonitoringReading(source);
  const refreshes: CompletedRefresh[] = rows
    .filter((row) => row.trigger === "force_pull")
    .map((row) => ({ ranAt: row.ran_at, runId: row.id }));
  const latestAnalysisAt = rows[rows.length - 1].ran_at;
  const nextRefreshAt = nextIncludedRefreshAt(latestAnalysisAt);

  if (source === "provider") {
    return {
      available: false,
      completedRefreshCount: refreshes.length,
      latestAnalysisAt,
      nextRefreshAt,
      reading: null,
      source,
    };
  }

  return {
    available: true,
    completedRefreshCount: refreshes.length,
    latestAnalysisAt,
    nextRefreshAt,
    reading: deriveMonitoringReading(refreshes, { latestRunAt: latestAnalysisAt }),
    source,
  };
}
