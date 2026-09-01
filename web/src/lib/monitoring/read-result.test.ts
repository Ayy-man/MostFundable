import assert from "node:assert/strict";
import { test } from "node:test";

import { buildMonitoringReadingResult } from "./read-result.ts";

const rows = [
  { id: "run-1", ran_at: "2026-08-10T12:00:00.000Z", trigger: "force_pull" },
  { id: "run-2", ran_at: "2026-08-30T12:00:00.000Z", trigger: "scheduled" },
];

test("provider deployments return the durable schedule without locally derived scores", () => {
  const result = buildMonitoringReadingResult(rows, "provider");

  assert.equal(result.available, false);
  assert.equal(result.reading, null);
  assert.equal(result.completedRefreshCount, 1);
  assert.equal(result.latestAnalysisAt, "2026-08-30T12:00:00.000Z");
  assert.equal(result.nextRefreshAt, "2026-09-29T12:00:00.000Z");
});

test("the mock rail alone derives scores while sharing the durable schedule", () => {
  const result = buildMonitoringReadingResult(rows, "mock");

  assert.equal(result.available, true);
  assert.ok(result.reading);
  assert.equal(result.nextRefreshAt, "2026-09-29T12:00:00.000Z");
  assert.equal(result.reading?.nextRefreshLabel, "Sep 29");
});
