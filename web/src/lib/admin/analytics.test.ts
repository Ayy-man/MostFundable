import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  listKpiRollups,
  readAdminLayout,
  runKpiRollup,
  setAdminLayout,
} from "./analytics.ts";

import type { AnalyticsRepository, KpiMetricKey, KpiScope } from "./analytics-types.ts";

const PROFILE = "23000000-0000-4000-8000-000000000001";
const ORG = "23000000-0000-4000-8000-000000000010";
const DAY = "2026-08-17";
const metrics = {
  activeUsers: null,
  operators: 2,
  currentMonitoring: 3,
  trialConversionPct: null,
  averageMonthlyPlanCents: 12900,
  averageMembershipDays: null,
  aiUsage: 4,
  fundedOutcomesCents: 0,
};

function rollup(scope: KpiScope, subjectId: string, day = DAY) {
  return { scope, subject_id: subjectId, day, metrics, updated_at: "2026-08-17T01:00:00.000Z" };
}

function repository(overrides: Partial<AnalyticsRepository> = {}): AnalyticsRepository {
  return {
    async upsertRollup(scope, subjectId, day) { return [rollup(scope, subjectId, day)]; },
    async listRollups() { return []; },
    async readLayout() { return null; },
    async writeLayout(profileId, layout) {
      return { profile_id: profileId, layout, updated_at: "2026-08-17T01:00:00.000Z" };
    },
    ...overrides,
  };
}

describe("admin analytics and KPI rollup", () => {
  it("writes exactly one platform, org, and member rollup", async () => {
    for (const subject of ["platform", `org:${ORG}`, `member:${PROFILE}`]) {
      assert.deepEqual(await runKpiRollup(subject, DAY, repository()), { status: "ok", rows: 1 });
    }
  });

  it("refuses invalid subjects, impossible dates, and dishonest write results", async () => {
    await assert.rejects(runKpiRollup("global", DAY, repository()), /JOB_TUPLE_INVALID/);
    await assert.rejects(runKpiRollup("platform", "2026-02-31", repository()), /ADMIN_KPI_DAY_INVALID/);
    await assert.rejects(runKpiRollup("platform", DAY, repository({ async upsertRollup() { return []; } })), /ADMIN_KPI_RESULT_INVALID/);
  });

  it("uses one inclusive 90-day rollup-only window and preserves null metrics", async () => {
    const calls: unknown[][] = [];
    const rows = await listKpiRollups("platform", DAY, repository({
      async listRollups(...args) {
        calls.push(args);
        return [rollup("platform", "platform")];
      },
    }));
    assert.deepEqual(calls, [["platform", "2026-05-20", DAY]]);
    assert.equal(rows[0].metrics.activeUsers, null);
    assert.equal(rows[0].metrics.averageMembershipDays, null);
  });

  it("treats missing layout as no data and preserves ordered distinct keys", async () => {
    assert.equal(await readAdminLayout(PROFILE, repository()), null);
    const layout: KpiMetricKey[] = ["aiUsage", "operators", "activeUsers"];
    assert.deepEqual((await setAdminLayout(PROFILE, layout, repository())).layout, layout);
    await assert.rejects(setAdminLayout(PROFILE, ["operators", "operators"], repository()), /ADMIN_LAYOUT_RESULT_INVALID/);
  });

  it("refuses a layout row belonging to a different profile", async () => {
    await assert.rejects(readAdminLayout(PROFILE, repository({
      async readLayout() {
        return { profile_id: ORG, layout: ["operators"], updated_at: "2026-08-17T01:00:00.000Z" };
      },
    })), /ADMIN_LAYOUT_RESULT_INVALID/);
  });

  it("keeps HTTP-facing reads on owned rollup and layout tables", () => {
    const source = readFileSync(new URL("./analytics-repository.ts", import.meta.url), "utf8");
    const tables = [...source.matchAll(/\.from\(\"([^\"]+)\"\)/g)].map((match) => match[1]);
    assert.deepEqual([...new Set(tables)].sort(), ["admin_layouts", "kpi_rollups"]);
  });
});
