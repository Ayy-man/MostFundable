import {
  BUSINESS_CHECKLIST_V1,
  PERSONAL_CHECKLIST_V1,
  checklistStatesFor,
  estimateCompletion,
} from './checklist-seeds.ts';
import { computeReadinessScore, evaluatePlan, readinessLabelFor } from './evaluator.ts';
import { PLAN_EMBEDDED_PROMPT } from './prompts/plan-v1.ts';

import type { DerivedFeatures } from '../analysis/features.ts';
import type { AccountChecklistStateV1, FundingReadinessPlanV1, PlanDriver } from './types.ts';
import type { ResolvedPrompt } from '../admin/prompt-types.ts';

export const MOCK_PLAN_MODEL = 'template-v1';

/**
 * The per-account utilization children the plan carries under `utilization_under_30`.
 *
 * Exported so the consumer Optimization read can derive the same children when the stored plan
 * body is the stub and only the run's derived features exist. Behaviour is unchanged: this is the
 * same function `deriveReadinessPlan` has always called, and it remains its only caller here.
 */
export function accountStates(features: DerivedFeatures): AccountChecklistStateV1[] {
  return features.accounts
    .filter(
      (account) =>
        account.isOpen &&
        account.kind === 'revolving' &&
        account.utilizationPct !== null &&
        account.utilizationPct >= 30,
    )
    .sort((left, right) => (left.accountRef < right.accountRef ? -1 : left.accountRef > right.accountRef ? 1 : 0))
    .map((account) => ({
      key: `utilization:${account.accountRef}`,
      accountRef: account.accountRef,
      title: 'Revolving account utilization is at least 30%',
      observedUtilizationPct: account.utilizationPct as number,
      state: 'unverified',
      blocking: true,
      todo: 'TODO(#127)',
    }));
}

export function deriveReadinessPlan(
  features: DerivedFeatures,
  prompt: Pick<ResolvedPrompt, 'key' | 'version'> = PLAN_EMBEDDED_PROMPT,
): FundingReadinessPlanV1 {
  const readinessScore = computeReadinessScore(features);
  const personalChecklist = checklistStatesFor(PERSONAL_CHECKLIST_V1, features);
  const utilizationIndex = personalChecklist.findIndex((item) => item.key === 'utilization_under_30');
  if (utilizationIndex >= 0) {
    personalChecklist[utilizationIndex] = { ...personalChecklist[utilizationIndex], children: accountStates(features) };
  }

  return {
    schemaVersion: 1,
    prompt: { key: 'funding-readiness-plan', version: prompt.version },
    derivedSchemaVersion: features.schemaVersion,
    readinessScore,
    readinessLabel: readinessLabelFor(readinessScore),
    personalChecklist,
    businessChecklist: checklistStatesFor(BUSINESS_CHECKLIST_V1, features),
    estimatedCompletion: estimateCompletion(),
    generation: { driver: 'mock', model: MOCK_PLAN_MODEL, promptVersion: prompt.version },
  };
}

export function createMockPlanDriver(): PlanDriver {
  return {
    driver: 'mock',
    async generateCandidate(features, prompt) {
      return deriveReadinessPlan(features, prompt ?? PLAN_EMBEDDED_PROMPT);
    },
    async supervise(features, candidate, prompt) {
      return evaluatePlan(candidate, features, prompt ?? PLAN_EMBEDDED_PROMPT);
    },
  };
}
