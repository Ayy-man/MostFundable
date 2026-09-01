import "server-only";

import { createPlanDriver } from "@/lib/llm/driver";
import { evaluatePlan } from "@/lib/llm/evaluator";
import { createSupportDraftDriver } from "@/lib/support/driver";
import { evaluateDraftLanguage } from "@/lib/support/language-gate";

import { recordEvalRun } from "./evals.ts";
import {
  PLAN_REFERENCE_DATASET,
  SUPPORT_REFERENCE_DATASET,
  promptEvaluationIdentity,
} from "./eval-policy.ts";

import type { EnvSource } from "@/lib/env";
import type { PlanDriver } from "@/lib/llm/types";
import type { SupportDraftDriver } from "@/lib/support/types";
import type { EvalRunRow, PromptEvaluationSummary, RecordEvalRunInput, ResolvedPrompt } from "./prompt-types.ts";

// Moved to `prompt-types.ts` so the admin surface, which cannot import a
// `server-only` module, describes the same policy object the gate enforces
// rather than a copy of it. Re-exported here because every existing importer
// and its tests read it from this module.
import { MANDATORY_PROMPT_EVALUATORS } from "./prompt-types.ts";

export { MANDATORY_PROMPT_EVALUATORS };

const SUPPORT_CONFIDENCE_THRESHOLD = 0.7;

export interface PromptEvaluatorDependencies {
  env: EnvSource;
  createPlanDriver(env: EnvSource): PlanDriver;
  createSupportDriver(env: EnvSource): SupportDraftDriver;
  record(input: RecordEvalRunInput): Promise<EvalRunRow>;
}

const productionDependencies: PromptEvaluatorDependencies = {
  env: process.env,
  createPlanDriver,
  createSupportDriver: createSupportDraftDriver,
  record: (input) => recordEvalRun(input),
};

type PendingEvalRun = Omit<
  RecordEvalRunInput,
  "actorId" | "driver" | "eligible" | "model" | "policyVersion" | "referenceDatasetHash"
>;

async function evaluatePlanPrompt(
  prompt: ResolvedPrompt,
  driver: PlanDriver,
  expectedModel: string,
): Promise<readonly PendingEvalRun[]> {
  const supervisorCodes = new Set<string>();
  const deterministicCodes = new Set<string>();
  for (const features of PLAN_REFERENCE_DATASET) {
    const candidate = await driver.generateCandidate(features, prompt);
    if (candidate.generation.driver !== driver.driver || candidate.generation.model !== expectedModel) {
      throw new Error("ADMIN_EVAL_DRIVER_MISMATCH");
    }
    const supervisor = await driver.supervise(features, candidate, prompt);
    const deterministic = evaluatePlan(candidate, features, prompt);
    for (const code of supervisor.codes) supervisorCodes.add(code);
    for (const code of deterministic.codes) deterministicCodes.add(code);
  }
  return Object.freeze([
    { promptKey: prompt.key, promptVersion: prompt.version, evaluatorKey: "plan.supervisor", passed: supervisorCodes.size === 0, result: { datasetSize: PLAN_REFERENCE_DATASET.length, codes: [...supervisorCodes].sort() } },
    { promptKey: prompt.key, promptVersion: prompt.version, evaluatorKey: "plan.deterministic", passed: deterministicCodes.size === 0, result: { datasetSize: PLAN_REFERENCE_DATASET.length, codes: [...deterministicCodes].sort() } },
  ]);
}

async function evaluateSupportPrompt(prompt: ResolvedPrompt, driver: SupportDraftDriver): Promise<readonly PendingEvalRun[]> {
  const supervisorCodes = new Set<string>();
  const languageCodes = new Set<string>();
  const confidences: number[] = [];
  for (const context of SUPPORT_REFERENCE_DATASET) {
    const candidate = await driver.generateDraft(context, prompt);
    const supervisor = await driver.superviseDraft(context, candidate, prompt);
    for (const code of supervisor.codes) supervisorCodes.add(code);
    for (const code of evaluateDraftLanguage(candidate.body)) languageCodes.add(code);
    confidences.push(candidate.confidence);
  }
  return Object.freeze([
    { promptKey: prompt.key, promptVersion: prompt.version, evaluatorKey: "support.supervisor", passed: supervisorCodes.size === 0, result: { datasetSize: SUPPORT_REFERENCE_DATASET.length, codes: [...supervisorCodes].sort() } },
    { promptKey: prompt.key, promptVersion: prompt.version, evaluatorKey: "support.language", passed: languageCodes.size === 0, result: { datasetSize: SUPPORT_REFERENCE_DATASET.length, codes: [...languageCodes].sort() } },
    { promptKey: prompt.key, promptVersion: prompt.version, evaluatorKey: "support.confidence", passed: confidences.every((value) => value >= SUPPORT_CONFIDENCE_THRESHOLD), result: { datasetSize: SUPPORT_REFERENCE_DATASET.length, minimum: Math.min(...confidences), threshold: SUPPORT_CONFIDENCE_THRESHOLD } },
  ]);
}

export async function evaluateStagedPrompt(
  prompt: ResolvedPrompt,
  actorId: string,
  overrides: Partial<PromptEvaluatorDependencies> = {},
): Promise<PromptEvaluationSummary> {
  if (prompt.source !== "database") throw new Error("ADMIN_EVAL_PROMPT_NOT_STAGED");
  const deps = { ...productionDependencies, ...overrides };
  const identity = promptEvaluationIdentity(prompt.key, deps.env);
  if (identity.driver === "mock") {
    return Object.freeze({
      key: prompt.key,
      version: prompt.version,
      passed: false,
      status: "held",
      reason: "launch_driver_unavailable",
      runs: Object.freeze([]),
    });
  }
  let inputs: readonly PendingEvalRun[];
  if (prompt.key === "funding-readiness-plan") {
    const driver = deps.createPlanDriver(deps.env);
    if (driver.driver !== identity.driver) throw new Error("ADMIN_EVAL_DRIVER_MISMATCH");
    inputs = await evaluatePlanPrompt(prompt, driver, identity.model);
  } else {
    const driver = deps.createSupportDriver(deps.env);
    if (driver.driver !== identity.driver || driver.model !== identity.model) {
      throw new Error("ADMIN_EVAL_DRIVER_MISMATCH");
    }
    inputs = await evaluateSupportPrompt(prompt, driver);
  }
  const expected = MANDATORY_PROMPT_EVALUATORS[prompt.key];
  if (inputs.length !== expected.length || inputs.some((input, index) => input.evaluatorKey !== expected[index])) {
    throw new Error("ADMIN_EVAL_POLICY_INVALID");
  }
  const runs: EvalRunRow[] = [];
  for (const input of inputs) {
    runs.push(await deps.record({ ...input, ...identity, eligible: true, actorId }));
  }
  return Object.freeze({
    key: prompt.key,
    version: prompt.version,
    passed: runs.every((run) => run.passed),
    status: "completed",
    reason: null,
    runs: Object.freeze(runs),
  });
}
