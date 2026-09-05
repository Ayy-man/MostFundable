import type { DerivedFeatures } from '../analysis/features.ts';
import type { ResolvedPrompt } from '../admin/prompt-types.ts';

export type ChecklistKind = 'personal_credit' | 'business_setup';
export type ChecklistState = 'verified' | 'unverified';
export type ReadinessLabel = 'Ready' | 'Near Ready' | 'Building Readiness';

export interface ChecklistSeedV1 {
  readonly key: string;
  readonly kind: ChecklistKind;
  readonly title: string;
  readonly blocking: true;
  readonly todo: 'TODO(#127)';
  readonly evidenceFlag: keyof DerivedFeatures['flags'] | null;
}

export interface AccountChecklistStateV1 {
  key: string;
  accountRef: string;
  title: string;
  observedUtilizationPct: number;
  state: 'unverified';
  blocking: true;
  todo: 'TODO(#127)';
}

export interface ChecklistStateV1 {
  key: string;
  title: string;
  state: ChecklistState;
  blocking: true;
  todo: 'TODO(#127)';
  children: AccountChecklistStateV1[];
}

export interface UnknownCompletionEstimateV1 {
  label: 'TBD';
  days: null;
}

export interface PromptReferenceV1 {
  key: 'funding-readiness-plan';
  version: number;
}

export interface PlanGenerationV1 {
  driver: 'mock' | 'openrouter';
  model: string;
  promptVersion: number;
}

export interface FundingReadinessPlanV1 {
  schemaVersion: 1;
  prompt: PromptReferenceV1;
  derivedSchemaVersion: 1 | 2;
  readinessScore: number;
  readinessLabel: ReadinessLabel;
  personalChecklist: ChecklistStateV1[];
  businessChecklist: ChecklistStateV1[];
  estimatedCompletion: UnknownCompletionEstimateV1;
  generation: PlanGenerationV1;
}

export interface SupervisorVerdict {
  approved: boolean;
  codes: string[];
}

export interface PlanDriver {
  readonly driver: 'mock' | 'openrouter';
  generateCandidate(features: DerivedFeatures, prompt?: ResolvedPrompt): Promise<FundingReadinessPlanV1>;
  supervise(
    features: DerivedFeatures,
    candidate: FundingReadinessPlanV1,
    prompt?: ResolvedPrompt,
  ): Promise<SupervisorVerdict>;
}

export interface PlanEvaluation {
  approved: boolean;
  codes: string[];
}
