import { evaluatePlan } from './evaluator.ts';
import { featureFlag, type EnvSource } from '../env.ts';
import { recordEvalRun } from '../admin/evals.ts';
import { resolveActivePrompt } from '../admin/prompts.ts';
import { EVAL_POLICY_VERSION, evaluationDatasetHash } from '../admin/eval-policy.ts';
import { PLAN_EMBEDDED_PROMPT } from './prompts/plan-v1.ts';

import type { DerivedFeatures } from '../analysis/features.ts';
import type { FundingReadinessPlanV1, PlanDriver } from './types.ts';
import type { RecordEvalRunInput, ResolvedPrompt } from '../admin/prompt-types.ts';

const MAX_ATTEMPTS = 2;

export interface PlanEngineDependencies {
  env: EnvSource;
  resolvePrompt(fallback: typeof PLAN_EMBEDDED_PROMPT, env: EnvSource): Promise<ResolvedPrompt>;
  recordEvaluation(input: RecordEvalRunInput): Promise<unknown>;
}

const productionDependencies: PlanEngineDependencies = {
  env: process.env,
  resolvePrompt: (fallback, env) => resolveActivePrompt(fallback, undefined, env),
  recordEvaluation: (input) => recordEvalRun(input),
};

export async function runPlanEngine(
  driver: PlanDriver,
  features: DerivedFeatures,
  overrides: Partial<PlanEngineDependencies> = {},
): Promise<FundingReadinessPlanV1 | null> {
  if (features.bureausPulled.length === 0 && features.accounts.length === 0) return null;

  const deps = { ...productionDependencies, ...overrides };
  const governed = featureFlag('FEATURE_ADMIN', deps.env);
  const prompt: ResolvedPrompt = governed
    ? await deps.resolvePrompt(PLAN_EMBEDDED_PROMPT, deps.env)
    : Object.freeze({ ...PLAN_EMBEDDED_PROMPT, source: 'embedded' as const });

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const candidate = await driver.generateCandidate(features, prompt);
    const supervisor = await driver.supervise(features, candidate, prompt);
    const evaluation = evaluatePlan(candidate, features, prompt);
    if (governed) {
      const evaluationIdentity = {
        referenceDatasetHash: evaluationDatasetHash([features]),
        driver: candidate.generation.driver,
        model: candidate.generation.model,
        eligible: false,
      } as const;
      await deps.recordEvaluation({
        promptKey: prompt.key,
        promptVersion: prompt.version,
        evaluatorKey: 'plan.supervisor',
        passed: supervisor.approved,
        policyVersion: EVAL_POLICY_VERSION,
        ...evaluationIdentity,
        result: { codes: supervisor.codes },
      });
      await deps.recordEvaluation({
        promptKey: prompt.key,
        promptVersion: prompt.version,
        evaluatorKey: 'plan.deterministic',
        passed: evaluation.approved,
        policyVersion: EVAL_POLICY_VERSION,
        ...evaluationIdentity,
        result: { codes: evaluation.codes },
      });
    }
    if (supervisor.approved && evaluation.approved) return candidate;
  }

  throw new Error('PLAN_REJECTED');
}
