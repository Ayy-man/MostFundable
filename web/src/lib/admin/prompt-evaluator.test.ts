import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createMockPlanDriver } from "@/lib/llm/mock-driver";
import { createMockSupportDraftDriver } from "@/lib/support/mock-driver";

import { evaluateStagedPrompt, MANDATORY_PROMPT_EVALUATORS } from "./prompt-evaluator.ts";

import type { RecordEvalRunInput, ResolvedPrompt } from "./prompt-types.ts";
import { OPENROUTER_MODEL } from "../llm/chat-transport.ts";

const ACTOR = "23000000-0000-4000-8000-000000000001";

function recorder(records: RecordEvalRunInput[]) {
  return async (input: RecordEvalRunInput) => {
    records.push(input);
    return {
      id: `23000000-0000-4000-8000-${String(records.length).padStart(12, "0")}`,
      promptKey: input.promptKey,
      promptVersion: input.promptVersion,
      evaluatorKey: input.evaluatorKey,
      passed: input.passed,
      policyVersion: input.policyVersion,
      referenceDatasetHash: input.referenceDatasetHash,
      driver: input.driver,
      model: input.model,
      eligible: input.eligible,
      result: input.result,
      ranBy: input.actorId ?? null,
      ranAt: "2026-08-17T00:00:00.000Z",
    };
  };
}

describe("staged prompt evaluator", () => {
  it("holds mock evaluation before it can create activation evidence", async () => {
    const records: RecordEvalRunInput[] = [];
    const prompt: ResolvedPrompt = Object.freeze({
      key: "funding-readiness-plan",
      version: 2,
      body: "A score increase of 50 is guaranteed.",
      source: "database",
    });
    const summary = await evaluateStagedPrompt(prompt, ACTOR, {
      env: { AI_DRIVER: "mock" },
      record: recorder(records),
    });

    assert.deepEqual(summary, {
      key: "funding-readiness-plan",
      version: 2,
      passed: false,
      status: "held",
      reason: "launch_driver_unavailable",
      runs: [],
    });
    assert.equal(records.length, 0, "mock evaluation records no activation-eligible evidence");
  });

  for (const key of ["funding-readiness-plan", "support-draft"] as const) {
    it(`runs the fixed ${key} dataset against the supplied immutable body`, async () => {
      const prompt: ResolvedPrompt = Object.freeze({ key, version: 2, body: `staged ${key}`, source: "database" });
      const records: RecordEvalRunInput[] = [];
      let suppliedBodies = 0;
      const plan = createMockPlanDriver();
      const support = createMockSupportDraftDriver();
      const summary = await evaluateStagedPrompt(prompt, ACTOR, {
        env: { AI_DRIVER: "openrouter", OPENROUTER_API_KEY: "test-key" },
        createPlanDriver: () => ({
          ...plan,
          driver: "openrouter" as const,
          async generateCandidate(features, supplied) {
            assert.equal(supplied, prompt);
            suppliedBodies += 1;
            const candidate = await plan.generateCandidate(features, supplied);
            return { ...candidate, generation: { ...candidate.generation, driver: "openrouter" as const, model: OPENROUTER_MODEL } };
          },
        }),
        createSupportDriver: () => ({
          ...support,
          driver: "openrouter" as const,
          model: OPENROUTER_MODEL,
          async generateDraft(context, supplied) {
            assert.equal(supplied, prompt);
            suppliedBodies += 1;
            return support.generateDraft(context, supplied);
          },
        }),
        record: recorder(records),
      });
      assert.equal(suppliedBodies, 2);
      assert.deepEqual(records.map((record) => record.evaluatorKey), [...MANDATORY_PROMPT_EVALUATORS[key]], "records exactly the code-owned evaluator set for the immutable staged body");
      assert.ok(records.every((record) => record.actorId === ACTOR && record.promptVersion === 2));
      assert.ok(records.every((record) => record.driver === "openrouter" && record.model === OPENROUTER_MODEL && record.eligible));
      assert.equal(summary.passed, true);
      assert.equal(summary.status, "completed");
    });
  }
});
