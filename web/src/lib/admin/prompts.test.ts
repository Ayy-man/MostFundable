import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveActivePrompt } from "./prompts.ts";

import type { EmbeddedPrompt, PromptReadRepository, PromptVersionRow } from "./prompt-types.ts";

const FALLBACK: EmbeddedPrompt = { key: "funding-readiness-plan", version: 1, body: "embedded body" };
const row = (version: number, body = "stored body"): PromptVersionRow => ({
  key: "funding-readiness-plan", version, body, active: true, createdBy: null, createdAt: "2026-08-17T00:00:00.000Z",
});

describe("admin prompts and active prompt", () => {
  it("returns embedded v1 without a repository call while governance is off", async () => {
    let calls = 0;
    const repository: PromptReadRepository = { async readActive() { calls += 1; return []; }, async listVersions() { return []; } };
    assert.deepEqual(await resolveActivePrompt(FALLBACK, repository, {}), { ...FALLBACK, source: "embedded" });
    assert.equal(calls, 0);
  });

  it("uses embedded v1 for an empty enabled table", async () => {
    const repository: PromptReadRepository = { async readActive() { return []; }, async listVersions() { return []; } };
    assert.deepEqual(await resolveActivePrompt(FALLBACK, repository, { FEATURE_ADMIN: "true" }), { ...FALLBACK, source: "embedded" });
  });

  it("returns one validated active database version", async () => {
    const repository: PromptReadRepository = { async readActive() { return [row(2)]; }, async listVersions() { return []; } };
    assert.deepEqual(await resolveActivePrompt(FALLBACK, repository, { FEATURE_ADMIN: "true" }), {
      key: FALLBACK.key, version: 2, body: "stored body", source: "database",
    });
  });

  it("fails closed for multiple or malformed active rows", async () => {
    const listVersions = async () => [];
    await assert.rejects(resolveActivePrompt(FALLBACK, { async readActive() { return [row(2), row(3)]; }, listVersions }, { FEATURE_ADMIN: "true" }), { message: "ADMIN_PROMPTS_RESULT_INVALID" });
    await assert.rejects(resolveActivePrompt(FALLBACK, { async readActive() { return [{ ...row(2), body: "" }]; }, listVersions }, { FEATURE_ADMIN: "true" }), { message: "ADMIN_PROMPTS_RESULT_INVALID" });
  });

  it("does not cache active versions across invocations", async () => {
    let version = 2;
    const repository: PromptReadRepository = { async readActive() { return [row(version++)]; }, async listVersions() { return []; } };
    assert.equal((await resolveActivePrompt(FALLBACK, repository, { FEATURE_ADMIN: "true" })).version, 2);
    assert.equal((await resolveActivePrompt(FALLBACK, repository, { FEATURE_ADMIN: "true" })).version, 3);
  });
});
