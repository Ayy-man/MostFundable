import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";

import {
  applyStackEnv,
  buildProblem,
  freePort,
  resolveStackEnv,
  stackSkipReason,
  startChildServer,
  stopChild,
} from "./billing-support";

const ADMIN_ID = "00000000-0000-0000-0000-000000000001";
const DAY = "2098-08-17";
const container = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_mostfundable";
const stack = resolveStackEnv();
if (stack !== null) applyStackEnv(stack);

function sql(statement: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-tAq", "-v", "ON_ERROR_STOP=1", "-c", statement],
    { encoding: "utf8" },
  ).trim();
}

let schemaProblem: string | null = null;
if (process.env.ADMIN_E2E === "1" && stack !== null) {
  try {
    const ownedTables = sql(`
      select count(*)
      from unnest(array['public.settings', 'public.kpi_rollups']) as expected(name)
      where to_regclass(expected.name) is not null
    `);
    if (ownedTables !== "2") {
      schemaProblem = "Phase-23 migrations are absent from the shared local database — SKIPPED, not passed";
    }
  } catch {
    schemaProblem = "the shared local database could not be inspected — SKIPPED, not passed";
  }
}
const skip = process.env.ADMIN_E2E !== "1"
  ? "ADMIN_E2E=1 is absent — SKIPPED, not passed"
  : stack === null
    ? stackSkipReason()
    : schemaProblem ?? buildProblem() ?? false;

async function api(baseUrl: string, path: string, input: { body?: unknown; method?: "GET" | "PATCH" | "POST"; actor?: string } = {}) {
  const method = input.method ?? "GET";
  const target = new URL(path, baseUrl);
  const response = await fetch(target, {
    method,
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
    headers: {
      ...(input.actor ? { "x-mf-demo-profile-id": input.actor } : {}),
      ...(input.body === undefined ? {} : { "content-type": "application/json" }),
      ...(!["GET", "HEAD"].includes(method) ? { origin: new URL(baseUrl).origin } : {}),
    },
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as Record<string, unknown> : null };
}

describe("admin governance live local chain", { skip }, () => {
  it("persists governed settings, prompt activation, KPI output, and own layout", async () => {
    let pid: number | null = null;
    let port: number | null = null;
    const priorSettingRaw = sql("select value #>> '{}' from public.settings where key = 'TRIAL_DAYS'");
    const priorPromptRaw = sql("select version from public.prompts where key = 'support-draft' and active");
    const priorSettingValue = priorSettingRaw ? Number(priorSettingRaw) : null;
    assert.ok(priorSettingValue === null || Number.isSafeInteger(priorSettingValue));
    assert.ok(priorPromptRaw === "" || Number.isSafeInteger(Number(priorPromptRaw)));

    try {
      port = await freePort();
      const server = await startChildServer({
        flags: { FEATURE_ADMIN: "true", FEATURE_REAL_AUTH: "" },
        port,
        stack: stack as NonNullable<typeof stack>,
      });
      pid = server.pid;

      assert.equal((await api(server.baseUrl, "/api/admin/settings/TRIAL_DAYS")).status, 401);
      assert.equal((await api(server.baseUrl, "/api/admin/settings/TRIAL_DAYS", { actor: ADMIN_ID })).status, 200);
      const written = await api(server.baseUrl, "/api/admin/settings/TRIAL_DAYS", { actor: ADMIN_ID, method: "PATCH", body: { value: 23 } });
      assert.equal(written.status, 200);
      const reread = await api(server.baseUrl, "/api/admin/settings/TRIAL_DAYS", { actor: ADMIN_ID });
      assert.equal(((reread.body?.setting as { value: number }).value), 23);
      assert.equal(sql("select value #>> '{}' from public.settings where key = 'TRIAL_DAYS'"), "23");

      const families = await api(server.baseUrl, "/api/admin/prompts", { actor: ADMIN_ID });
      assert.equal(families.status, 200);
      const created = await api(server.baseUrl, "/api/admin/prompts/support-draft/versions", {
        actor: ADMIN_ID, method: "POST", body: { body: "Governed support prompt for the Phase 23 local chain." },
      });
      assert.equal(created.status, 201);
      const createdVersion = (created.body?.prompt as { version: number }).version;
      // A clean reset has no stored prompt, so version creation first installs the embedded
      // version as the active fallback. Snapshot that post-create state because the held activation
      // below must preserve the state it can actually affect.
      const activeBeforeActivation = sql("select version from public.prompts where key = 'support-draft' and active");
      assert.equal(activeBeforeActivation, priorPromptRaw || "1");
      // Round 3 (R3D-03): the local mock can exercise the route but cannot produce
      // launch evidence, so create -> evaluate -> activate must remain held.
      const evaluated = await api(server.baseUrl, `/api/admin/prompts/support-draft/${createdVersion}/evaluate`, {
        actor: ADMIN_ID, method: "POST",
      });
      assert.equal(evaluated.status, 200);
      assert.equal((evaluated.body?.evaluation as { status: string }).status, "held");
      const activation = await api(server.baseUrl, "/api/admin/prompts/support-draft/activate", {
        actor: ADMIN_ID, method: "POST", body: { version: createdVersion },
      });
      assert.equal(activation.status, 200);
      assert.equal((activation.body?.activation as { status: string }).status, "held");
      assert.equal(sql("select version from public.prompts where key = 'support-draft' and active"), activeBeforeActivation);

      const run = await api(server.baseUrl, "/api/admin/analytics/run-now", {
        actor: ADMIN_ID, method: "POST", body: { subject: "platform", day: DAY },
      });
      assert.equal(run.status, 200);
      assert.equal(sql(`select count(*) from public.kpi_rollups where subject_id = 'platform' and day = '${DAY}'`), "1");
      const analytics = await api(server.baseUrl, `/api/admin/analytics?subject=platform&day=${DAY}`, { actor: ADMIN_ID });
      assert.equal(analytics.status, 200);
      const rows = analytics.body?.rollups as Array<{ metrics: { activeUsers: number | null } }>;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].metrics.activeUsers, null);

      const layout = ["aiUsage", "operators"];
      assert.equal((await api(server.baseUrl, "/api/admin/analytics/layout", { actor: ADMIN_ID, method: "PATCH", body: { layout } })).status, 200);
      assert.deepEqual((await api(server.baseUrl, "/api/admin/analytics/layout", { actor: ADMIN_ID })).body?.layout &&
        ((await api(server.baseUrl, "/api/admin/analytics/layout", { actor: ADMIN_ID })).body?.layout as { layout: string[] }).layout, layout);
      assert.equal((await api(server.baseUrl, "/api/admin/analytics/run-now", {
        actor: ADMIN_ID, method: "POST", body: { job: "billing.accruals", subject: "platform", day: DAY },
      })).status, 400);

    } finally {
      if (pid !== null && port !== null) stopChild(pid, port);
      if (priorSettingValue !== null) {
        sql(`select public.admin_set_setting('TRIAL_DAYS', '${priorSettingValue}'::jsonb, '${ADMIN_ID}')`);
      } else {
        sql("delete from public.settings where key = 'TRIAL_DAYS'");
      }
      sql(`delete from public.kpi_rollups where subject_id = 'platform' and day = '${DAY}'`);
      sql(`delete from public.admin_layouts where profile_id = '${ADMIN_ID}'`);
    }
  });
});
