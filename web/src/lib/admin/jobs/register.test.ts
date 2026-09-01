import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { getCadenceProviders, getJobHandler, resetJobRegistryForTests } from "@/lib/jobs/registry";
import { createKpiCadenceProvider, registerAdminJobs } from "./register.ts";

const ORG_A = "23000000-0000-4000-8000-000000000010";
const ORG_B = "23000000-0000-4000-8000-000000000011";
const MEMBER = "23000000-0000-4000-8000-000000000020";

afterEach(() => resetJobRegistryForTests());

describe("admin KPI registration", () => {
  it("registers one directly invocable handler and one cadence provider", async () => {
    resetJobRegistryForTests();
    const calls: string[][] = [];
    registerAdminJobs({
      handler: async (subject, window) => { calls.push([subject, window]); return { status: "ok", rows: 1 }; },
      targetSource: { async listOrgIds() { return []; }, async listMemberIds() { return []; } },
    });
    assert.deepEqual(await getJobHandler("kpi.rollup")?.("platform", "2026-08-17"), { status: "ok", rows: 1 });
    assert.deepEqual(calls, [["platform", "2026-08-17"]]);
    assert.equal(getCadenceProviders().size, 1);
  });

  it("returns sorted unique platform, org, and member tuples", async () => {
    const provider = createKpiCadenceProvider({
      async listOrgIds() { return [ORG_B, ORG_A, ORG_A]; },
      async listMemberIds() { return [MEMBER, MEMBER]; },
    });
    assert.deepEqual(await provider(new Date("2026-08-17T23:59:59.000Z")), [
      { job: "kpi.rollup", subject: `member:${MEMBER}`, window: "2026-08-17" },
      { job: "kpi.rollup", subject: `org:${ORG_A}`, window: "2026-08-17" },
      { job: "kpi.rollup", subject: `org:${ORG_B}`, window: "2026-08-17" },
      { job: "kpi.rollup", subject: "platform", window: "2026-08-17" },
    ]);
  });

  it("always includes platform for an empty target set", async () => {
    const provider = createKpiCadenceProvider({
      async listOrgIds() { return []; }, async listMemberIds() { return []; },
    });
    assert.deepEqual(await provider(new Date("2026-08-17T00:00:00.000Z")), [
      { job: "kpi.rollup", subject: "platform", window: "2026-08-17" },
    ]);
  });

  it("refuses invalid targets and duplicate registration", async () => {
    const provider = createKpiCadenceProvider({
      async listOrgIds() { return ["bad-id"]; }, async listMemberIds() { return []; },
    });
    await assert.rejects(provider(new Date("2026-08-17T00:00:00.000Z")), /ADMIN_KPI_TARGET_INVALID/);
    resetJobRegistryForTests();
    registerAdminJobs({ targetSource: { async listOrgIds() { return []; }, async listMemberIds() { return []; } } });
    assert.throws(() => registerAdminJobs(), /JOB_HANDLER_DUPLICATE:kpi.rollup/);
  });
});
