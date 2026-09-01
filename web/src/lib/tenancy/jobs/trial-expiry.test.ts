import assert from "node:assert/strict";
import test from "node:test";

import type { TenancyRepository } from "../repository.ts";
import { registerTenancyJobs, TENANCY_TRIAL_EXPIRY_JOB } from "./register.ts";
import { runTrialExpiry } from "./trial-expiry.ts";

function repository(rows: number, error?: Error): TenancyRepository {
  return {
    async acceptInvite() { throw new Error(); }, async createInvite() { throw new Error(); },
    async deactivateMember() { throw new Error(); },
    async expireTrials(window) {
      assert.equal(window, "2026-08-17");
      if (error) throw error;
      return { rows, status: "ok" };
    },
    async findClaimedOrgBySlug() { return null; }, async findMember() { return null; },
    async provisionTenant() { throw new Error(); }, async publishBrand() { throw new Error(); },
    async readBrand() { return null; }, async readPublishedBrand() { return null; },
    async recordInviteDelivery() {}, async runTenantAction() { throw new Error(); },
    async updateBrand() { throw new Error(); },
  };
}

test("tenancy registration binds the exact daily global UTC tuple", async () => {
  let handlerJob = "";
  let cadenceJob = "";
  let provider: ((now: Date) => Promise<readonly unknown[]>) | null = null;
  registerTenancyJobs({
    handler(job) { handlerJob = job; },
    cadence(job, value) { cadenceJob = job; provider = value; },
  });
  assert.equal(handlerJob, TENANCY_TRIAL_EXPIRY_JOB);
  assert.equal(cadenceJob, TENANCY_TRIAL_EXPIRY_JOB);
  assert.deepEqual(await provider!(new Date("2026-08-17T23:59:59-07:00")), [{
    job: "tenancy.trial_expiry", subject: "global", window: "2026-08-18",
  }]);
});

test("handler returns stable counts for applied and replay windows without tenant details", async () => {
  for (const rows of [3, 0]) {
    const result = await runTrialExpiry("global", "2026-08-17", repository(rows));
    assert.deepEqual(result, { status: "ok", rows });
    assert.doesNotMatch(JSON.stringify(result), /org|slug|tenant_id/i);
  }
});

test("invalid tuples and repository failure fail closed", async () => {
  await assert.rejects(runTrialExpiry("org:any", "2026-08-17", repository(0)), /JOB_TUPLE_INVALID/);
  await assert.rejects(runTrialExpiry("global", "2026-8-17", repository(0)), /JOB_TUPLE_INVALID/);
  await assert.rejects(
    runTrialExpiry("global", "2026-08-17", repository(0, new Error("database detail"))),
    /database detail/,
  );
});

