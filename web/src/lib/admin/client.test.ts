import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  loadAdminAnalytics,
  loadAdminEvals,
  loadAdminPrompts,
  evaluateAdminPromptVersion,
  saveAdminSetting,
} from "./client.ts";

const SETTING = { key: "TRIAL_DAYS", value: 14, updatedBy: null, updatedAt: "2026-08-17T00:00:00.000Z" };

function fetchScript(values: unknown[], calls: Array<{ input: string; init: RequestInit }>): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input: String(input), init: init ?? {} });
    const value = values.shift();
    return value instanceof Response ? value : Response.json(value);
  }) as typeof fetch;
}

describe("admin client", () => {
  it("sends private no-store setting mutations with an exact body", async () => {
    const calls: Array<{ input: string; init: RequestInit }> = [];
    assert.equal((await saveAdminSetting("TRIAL_DAYS", 14, fetchScript([{ setting: SETTING }], calls))).value, 14);
    assert.equal(calls[0].input, "/api/admin/settings/TRIAL_DAYS");
    assert.equal(calls[0].init.method, "PATCH");
    assert.equal(calls[0].init.cache, "no-store");
    assert.equal(calls[0].init.credentials, "same-origin");
    assert.equal(calls[0].init.body, JSON.stringify({ value: 14 }));
  });

  it("issues a fresh analytics fetch on every invocation and preserves no data", async () => {
    const calls: Array<{ input: string; init: RequestInit }> = [];
    const transport = fetchScript([{ rollups: [] }, { rollups: [] }], calls);
    assert.deepEqual(await loadAdminAnalytics("platform", "2026-08-17", transport), []);
    assert.deepEqual(await loadAdminAnalytics("platform", "2026-08-17", transport), []);
    assert.equal(calls.length, 2);
  });

  it("validates embedded fallback metadata and empty histories", async () => {
    const calls: Array<{ input: string; init: RequestInit }> = [];
    const prompts = await loadAdminPrompts(fetchScript([{ prompts: [
      { key: "support-draft", fallback: { key: "support-draft", version: 1, body: "embedded" } },
    ] }], calls));
    assert.equal(prompts[0].fallback.version, 1);
    assert.deepEqual(await loadAdminEvals(fetchScript([{ evals: [] }], calls)), []);
  });

  it("rejects HTTP failures and malformed success bodies", async () => {
    const calls: Array<{ input: string; init: RequestInit }> = [];
    await assert.rejects(loadAdminEvals(fetchScript([new Response(null, { status: 500 })], calls)), /ADMIN_HTTP_500/);
    await assert.rejects(loadAdminPrompts(fetchScript([{ prompts: [{ key: "unknown", fallback: {} }] }], calls)), /ADMIN_CLIENT_RESPONSE_INVALID/);
  });

  it("starts a code-owned prompt evaluation without a request body", async () => {
    const calls: Array<{ input: string; init: RequestInit }> = [];
    const evaluation = await evaluateAdminPromptVersion("support-draft", 2, fetchScript([{ evaluation: {
      key: "support-draft", version: 2, passed: true, status: "completed", reason: null, runs: [],
    } }], calls));
    assert.equal(evaluation.passed, true);
    assert.equal(calls[0].input, "/api/admin/prompts/support-draft/2/evaluate");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.body, undefined, "evaluation request carries no policy or result payload");
  });
});
