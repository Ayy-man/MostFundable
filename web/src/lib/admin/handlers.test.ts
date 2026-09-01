import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  handleActivatePrompt,
  handleAnalytics,
  handleAnalyticsRunNow,
  handleCreatePromptVersion,
  handleEvalDetail,
  handleEvalHistory,
  handleEvaluatePrompt,
  handleGetLayout,
  handleOverview,
  handlePatchSetting,
  handlePromptVersions,
} from "./handlers.ts";
import { evaluateStagedPrompt } from "./prompt-evaluator.ts";

import type { AdminHandlerDependencies } from "./handlers.ts";

const ACTOR = "23000000-0000-4000-8000-000000000001";
const EVAL = "23000000-0000-4000-8000-000000000002";
const ORG = "23000000-0000-4000-8000-000000000010";
const DAY = "2026-08-17";

function dependencies(overrides: Partial<AdminHandlerDependencies> = {}): AdminHandlerDependencies {
  return {
    async requireAdmin() { return { id: ACTOR, role: "platform_admin" }; },
    async getSetting() { return null; },
    async setSetting(key, value, actorId) {
      return { key, value, updatedBy: actorId, updatedAt: "2026-08-17T00:00:00.000Z" };
    },
    async readOverviewCounts() { return { operators: 2, consumers: 5, analyses: 9 }; },
    async readFundedCents() { return 4_500_000; },
    async readCashCents() { return 350_000; },
    async listRollups() { return []; },
    async readLayout() { return null; },
    async setLayout(profileId, layout) {
      return { profileId, layout, updatedAt: "2026-08-17T00:00:00.000Z" };
    },
    async runNow() { return { claimed: 1, failed: 0, retried: 0, skipped: 0, succeeded: 1 }; },
    async readTenants() { return []; },
    async readFundedVolume() { return { monthly: [], weekly: [] }; },
    async readPlatformMrrCents() { return 0; },
    async readPendingReviews() { return []; },
    async listPromptVersions() { return []; },
    async createPromptVersion(fallback, body, actorId) {
      return { key: fallback.key, version: 2, body, active: false, createdBy: actorId, createdAt: "2026-08-17T00:00:00.000Z" };
    },
    async activatePromptVersion(key, version, actorId) {
      return {
        status: "activated", reason: null,
        prompt: { key, version, body: "stored", active: true, createdBy: actorId, createdAt: "2026-08-17T00:00:00.000Z" },
      };
    },
    async evaluatePrompt(prompt) { return { key: prompt.key, version: prompt.version, passed: true, status: "completed", reason: null, runs: [] }; },
    async fallbackFor(key) { return { key, version: 1, body: "embedded" }; },
    async listEvalRuns() { return []; },
    async readEvalRun() { return null; },
    ...overrides,
  };
}

async function body(response: Response): Promise<unknown> { return response.json(); }

describe("admin handler contracts", () => {
  it("authenticates before reading a settings mutation and derives the actor", async () => {
    const calls: string[] = [];
    const request = { async json() { calls.push("json"); return { value: 21 }; } } as Request;
    const response = await handlePatchSetting(request, "TRIAL_DAYS", dependencies({
      async requireAdmin() { calls.push("auth"); return { id: ACTOR, role: "platform_admin" }; },
      async setSetting(key, value, actorId) {
        calls.push(`${key}:${value}:${actorId}`);
        return { key, value, updatedBy: actorId, updatedAt: "2026-08-17T00:00:00.000Z" };
      },
    }));
    assert.deepEqual(calls, ["auth", "json", `TRIAL_DAYS:21:${ACTOR}`]);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  });

  it("returns the closed auth response without parsing a mutation body", async () => {
    let parsed = false;
    const response = await handlePatchSetting(
      { async json() { parsed = true; return { value: 21 }; } } as Request,
      "TRIAL_DAYS",
      dependencies({ async requireAdmin() { throw { status: 401 }; } }),
    );
    assert.equal(response.status, 401);
    assert.equal(parsed, false);
    assert.deepEqual(await body(response), { error: { code: "unauthenticated" } });
  });

  it("accepts only a fixed subject and through-day analytics query", async () => {
    const calls: string[][] = [];
    const response = await handleAnalytics(
      new Request(`http://local/api/admin/analytics?subject=org:${ORG}&day=${DAY}`),
      dependencies({ async listRollups(subject, day) { calls.push([subject, day]); return []; } }),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [[`org:${ORG}`, DAY]]);
    assert.deepEqual(await body(response), { rollups: [] });
  });

  it("uses the session profile for layout and represents missing data as null", async () => {
    const seen: string[] = [];
    const response = await handleGetLayout(dependencies({ async readLayout(profileId) { seen.push(profileId); return null; } }));
    assert.deepEqual(seen, [ACTOR]);
    assert.deepEqual(await body(response), { layout: null });
  });

  it("authenticates before reading, and returns counts plus flag-gated funded/cash cents", async () => {
    const calls: string[] = [];
    const response = await handleOverview({ applications: true, fees: true }, dependencies({
      async requireAdmin() { calls.push("auth"); return { id: ACTOR, role: "platform_admin" }; },
      async readOverviewCounts() { calls.push("counts"); return { operators: 2, consumers: 5, analyses: 9 }; },
      async readFundedCents() { calls.push("funded"); return 4_500_000; },
      async readCashCents() { calls.push("cash"); return 350_000; },
    }));
    assert.equal(response.status, 200);
    assert.equal(calls[0], "auth");
    assert.deepEqual([...calls].sort(), ["auth", "cash", "counts", "funded"]);
    assert.deepEqual(await body(response), { operators: 2, consumers: 5, analyses: 9, funded: 4_500_000, cash: 350_000 });
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  });

  it("returns null funded/cash without reading their sums when the flags are off", async () => {
    let funded = false;
    let cash = false;
    const response = await handleOverview({ applications: false, fees: false }, dependencies({
      async readFundedCents() { funded = true; return 4_500_000; },
      async readCashCents() { cash = true; return 350_000; },
    }));
    assert.equal(response.status, 200);
    assert.equal(funded, false);
    assert.equal(cash, false);
    assert.deepEqual(await body(response), { operators: 2, consumers: 5, analyses: 9, funded: null, cash: null });
  });

  it("returns null funded when the flag is on but no outcome is recorded", async () => {
    const response = await handleOverview({ applications: true, fees: true }, dependencies({
      async readFundedCents() { return null; },
      async readCashCents() { return 0; },
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await body(response), { operators: 2, consumers: 5, analyses: 9, funded: null, cash: 0 });
  });

  it("returns the closed auth response without reading overview counts", async () => {
    let read = false;
    const response = await handleOverview({ applications: true, fees: true }, dependencies({
      async requireAdmin() { throw { status: 401 }; },
      async readOverviewCounts() { read = true; return { operators: 0, consumers: 0, analyses: 0 }; },
    }));
    assert.equal(response.status, 401);
    assert.equal(read, false);
    assert.deepEqual(await body(response), { error: { code: "unauthenticated" } });
  });

  it("maps a failed overview read to the generic request failure", async () => {
    const response = await handleOverview({ applications: true, fees: true }, dependencies({
      async readFundedCents() { throw new Error("ADMIN_OVERVIEW_FUNDED_FAILED"); },
    }));
    assert.equal(response.status, 500);
    assert.deepEqual(await body(response), { error: { code: "admin_request_failed" } });
  });

  it("constructs only the kpi run-now tuple and rejects a caller-supplied job key", async () => {
    const calls: string[][] = [];
    const ok = await handleAnalyticsRunNow(new Request("http://local", {
      method: "POST", body: JSON.stringify({ subject: "platform", day: DAY }),
    }), dependencies({ async runNow(subject, day) { calls.push([subject, day]); return { claimed: 1, failed: 0, retried: 0, skipped: 0, succeeded: 1 }; } }));
    assert.equal(ok.status, 200);
    assert.deepEqual(calls, [["platform", DAY]]);
    const refused = await handleAnalyticsRunNow(new Request("http://local", {
      method: "POST", body: JSON.stringify({ job: "billing.accruals", subject: "platform", day: DAY }),
    }), dependencies());
    assert.equal(refused.status, 400);
  });

  it("lists, appends, and reactivates only the two prompt families", async () => {
    assert.equal((await handlePromptVersions("support-draft", dependencies())).status, 200);
    assert.equal((await handlePromptVersions("unknown", dependencies())).status, 400);
    const created = await handleCreatePromptVersion(new Request("http://local", {
      method: "POST", body: JSON.stringify({ body: "new body" }),
    }), "support-draft", dependencies());
    assert.equal(created.status, 201);
    assert.equal(((await body(created)) as { prompt: { createdBy: string } }).prompt.createdBy, ACTOR);
    const activated = await handleActivatePrompt(new Request("http://local", {
      method: "POST", body: JSON.stringify({ version: 1 }),
    }), "support-draft", dependencies());
    assert.deepEqual(await body(activated), {
      activation: {
        status: "activated", reason: null,
        prompt: { key: "support-draft", version: 1, body: "stored", active: true, createdBy: ACTOR, createdAt: "2026-08-17T00:00:00.000Z" },
      },
    });
    const held = await handleActivatePrompt(new Request("http://local", {
      method: "POST", body: JSON.stringify({ version: 2 }),
    }), "support-draft", dependencies({
      async activatePromptVersion(key, version, actorId) {
        return {
          status: "held", reason: "evaluation_evidence_missing",
          prompt: { key, version, body: "candidate", active: false, createdBy: actorId, createdAt: "2026-08-17T00:00:00.000Z" },
        };
      },
    }));
    assert.deepEqual(await body(held), {
      activation: {
        status: "held", reason: "evaluation_evidence_missing",
        prompt: { key: "support-draft", version: 2, body: "candidate", active: false, createdBy: ACTOR, createdAt: "2026-08-17T00:00:00.000Z" },
      },
    });
  });

  it("keeps evaluation HTTP bounded and read-only", async () => {
    const filters: unknown[] = [];
    const response = await handleEvalHistory(new Request(
      "http://local/api/admin/evals?promptKey=support-draft&promptVersion=2&limit=25",
    ), dependencies({ async listEvalRuns(value) { filters.push(value); return []; } }));
    assert.equal(response.status, 200);
    assert.deepEqual(filters, [{ promptKey: "support-draft", promptVersion: 2, limit: 25 }]);
    assert.equal((await handleEvalHistory(new Request("http://local/api/admin/evals?limit=201"), dependencies())).status, 400);
    assert.equal((await handleEvalDetail("bad", dependencies())).status, 400);
    assert.equal((await handleEvalDetail(EVAL, dependencies())).status, 404);
  });

  it("creates, evaluates, and activates a staged prompt without caller-supplied evaluation inputs", async () => {
    const staged = { key: "support-draft" as const, version: 2, body: "candidate", active: false, createdBy: ACTOR, createdAt: "2026-08-17T00:00:00.000Z" };
    let evidence = false;
    const deps = dependencies({
      async listPromptVersions() { return [staged]; },
      async evaluatePrompt(prompt, actorId) {
        assert.deepEqual(prompt, { key: "support-draft", version: 2, body: "candidate", source: "database" });
        assert.equal(actorId, ACTOR);
        evidence = true;
        return { key: prompt.key, version: prompt.version, passed: true, status: "completed", reason: null, runs: [] };
      },
      async activatePromptVersion() {
        assert.equal(evidence, true, "activation observes product-recorded staged evaluation evidence");
        return { status: "activated", reason: null, prompt: { ...staged, active: true } };
      },
    });
    const evaluated = await handleEvaluatePrompt("support-draft", "2", deps);
    assert.equal(evaluated.status, 200);
    assert.deepEqual(await body(evaluated), { evaluation: { key: "support-draft", version: 2, passed: true, status: "completed", reason: null, runs: [] } });
    const activated = await handleActivatePrompt(new Request("http://local", { method: "POST", body: JSON.stringify({ version: 2 }) }), "support-draft", deps);
    assert.equal(((await body(activated)) as { activation: { status: string } }).activation.status, "activated");
  });

  it("holds a mock route evaluation and leaves the staged prompt inactive", async () => {
    const staged = {
      key: "funding-readiness-plan" as const,
      version: 9,
      body: "A score increase of 50 is guaranteed.",
      active: false,
      createdBy: ACTOR,
      createdAt: "2026-08-17T00:00:00.000Z",
    };
    const active = false;
    const deps = dependencies({
      async listPromptVersions() { return [staged]; },
      async evaluatePrompt(prompt, actorId) {
        return evaluateStagedPrompt(prompt, actorId, {
          env: { AI_DRIVER: "mock" },
          async record() { throw new Error("mock must record no activation evidence"); },
        });
      },
      async activatePromptVersion() {
        return {
          status: "held",
          reason: "evaluation_evidence_missing",
          prompt: { ...staged, active },
        };
      },
    });

    const evaluated = await handleEvaluatePrompt("funding-readiness-plan", "9", deps);
    assert.deepEqual(await body(evaluated), {
      evaluation: {
        key: "funding-readiness-plan",
        version: 9,
        passed: false,
        status: "held",
        reason: "launch_driver_unavailable",
        runs: [],
      },
    });
    const activation = await handleActivatePrompt(
      new Request("http://local", { method: "POST", body: JSON.stringify({ version: 9 }) }),
      "funding-readiness-plan",
      deps,
    );
    assert.equal(((await body(activation)) as { activation: { status: string; prompt: { active: boolean } } }).activation.status, "held");
    assert.equal(active, false, "mock create-evaluate-activate leaves the prompt staged");
  });
});
