import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { JOB_NAMES } from "./definitions.ts";
import {
  getJobHandler,
  enabledHandlerJobs,
  registerJobHandler,
  resetJobRegistryForTests,
} from "./registry.ts";

const EXPECTED = [
  "crs.alert_batch",
  "analysis.schedule_due",
  "analysis.run",
  "billing.accruals",
  "outcomes.refresh_stats",
  "vault.sync_banks",
  "vault.reimport_kb",
  "purge.derived",
  "purge.uploaded_reports",
  "notifications.dispatch",
  "tenancy.trial_expiry",
  "kpi.rollup",
];

describe("job registry", () => {
  beforeEach(resetJobRegistryForTests);

  it("publishes exactly the frozen twelve-key catalog", () => {
    assert.deepEqual(JOB_NAMES, EXPECTED);
  });

  it("accepts the locked handler result and rejects duplicate ownership", async () => {
    registerJobHandler("billing.accruals", async () => ({ status: "ok", rows: 2 }), "FEATURE_REVENUE");
    await assert.doesNotReject(async () => {
      assert.deepEqual(await getJobHandler("billing.accruals")?.("org:x", "2026-08"), {
        rows: 2,
        status: "ok",
      });
    });
    assert.throws(
      () => registerJobHandler("billing.accruals", async () => ({ status: "skipped" }), "FEATURE_REVENUE"),
      /JOB_HANDLER_DUPLICATE/,
    );
  });

  it("rejects keys outside the catalog", () => {
    assert.throws(
      () => registerJobHandler("sibling.made_up", async () => ({ status: "ok" }), "FEATURE_VAULT"),
      /JOB_NAME_INVALID/,
    );
  });

  it("supports a sibling registration as one side-effect call", async () => {
    const loadSiblingRegistration = () => {
      registerJobHandler("vault.sync_banks", async () => ({ status: "skipped" }), "FEATURE_VAULT");
    };
    loadSiblingRegistration();
    assert.deepEqual(await getJobHandler("vault.sync_banks")?.("global", "2026-08-16"), {
      status: "skipped",
    });
  });

  it("enrollment alone owns the shared derived purge handler", () => {
    registerJobHandler("purge.derived", async () => ({ status: "ok" }), ["FEATURE_ENROLLMENT", "FEATURE_ANALYSIS"]);
    assert.deepEqual([...enabledHandlerJobs({ FEATURE_ENROLLMENT: "1", FEATURE_ANALYSIS: "0" })], ["purge.derived"]);
    assert.deepEqual([...enabledHandlerJobs({ FEATURE_ENROLLMENT: "0", FEATURE_ANALYSIS: "0" })], []);
  });
});
