import {
  BUSINESS_CHECKLIST_V1,
  PERSONAL_CHECKLIST_V1,
  checklistStatesFor,
} from './checklist-seeds.ts';
import { complianceLanguageCodes } from '../compliance/language-rules.mjs';

import type { DerivedFeatures } from '../analysis/features.ts';
import type {
  ChecklistSeedV1,
  PlanEvaluation,
  ReadinessLabel,
} from './types.ts';
import type { ResolvedPrompt } from '../admin/prompt-types.ts';

export const READINESS_INCOMPLETE_CAP = 99;

const PLAN_KEYS = [
  'schemaVersion',
  'prompt',
  'derivedSchemaVersion',
  'readinessScore',
  'readinessLabel',
  'personalChecklist',
  'businessChecklist',
  'estimatedCompletion',
  'generation',
] as const;
const PROMPT_KEYS = ['key', 'version'] as const;
const STATE_KEYS = ['key', 'title', 'state', 'blocking', 'todo', 'children'] as const;
const CHILD_KEYS = [
  'key',
  'accountRef',
  'title',
  'observedUtilizationPct',
  'state',
  'blocking',
  'todo',
] as const;
const ESTIMATE_KEYS = ['label', 'days'] as const;
const GENERATION_KEYS = ['driver', 'model', 'promptVersion'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function integerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;
}

function add(codes: Set<string>, condition: boolean, code: string): void {
  if (!condition) codes.add(code);
}

function measurableFlags(features: DerivedFeatures): boolean[] {
  return PERSONAL_CHECKLIST_V1.flatMap((seed) =>
    seed.evidenceFlag === null || typeof features.flags[seed.evidenceFlag] !== 'boolean'
      ? []
      : [features.flags[seed.evidenceFlag] === true],
  );
}

export function computeReadinessScore(features: DerivedFeatures): number {
  const flags = measurableFlags(features);
  const rawScore = flags.length === 0 ? 0 : Math.round((flags.filter(Boolean).length / flags.length) * 100);
  const states = [
    ...checklistStatesFor(PERSONAL_CHECKLIST_V1, features),
    ...checklistStatesFor(BUSINESS_CHECKLIST_V1, features),
  ];
  return states.some((state) => state.state === 'unverified')
    ? Math.min(rawScore, READINESS_INCOMPLETE_CAP)
    : rawScore;
}

export function itemsToFix(features: DerivedFeatures): number {
  return checklistStatesFor(PERSONAL_CHECKLIST_V1, features).filter((item) => item.state === 'unverified').length;
}

export function personalVerifiedCount(features: DerivedFeatures): number {
  return checklistStatesFor(PERSONAL_CHECKLIST_V1, features).filter((item) => item.state === 'verified').length;
}

export function readinessLabelFor(score: number): ReadinessLabel {
  if (score === 100) return 'Ready';
  return score >= 90 ? 'Near Ready' : 'Building Readiness';
}

function qualifyingAccounts(features: DerivedFeatures) {
  return features.accounts
    .filter(
      (account) =>
        account.isOpen &&
        account.kind === 'revolving' &&
        account.utilizationPct !== null &&
        account.utilizationPct >= 30,
    )
    .sort((left, right) => (left.accountRef < right.accountRef ? -1 : left.accountRef > right.accountRef ? 1 : 0));
}

function validateChild(
  value: unknown,
  account: DerivedFeatures['accounts'][number],
  codes: Set<string>,
): void {
  if (!isRecord(value) || !hasExactKeys(value, CHILD_KEYS)) {
    codes.add('CHILD_SCHEMA');
    return;
  }
  add(codes, value.key === `utilization:${account.accountRef}`, 'CHILD_KEY');
  add(codes, value.accountRef === account.accountRef, 'CHILD_ACCOUNT_REF');
  add(codes, value.title === 'Revolving account utilization is at least 30%', 'CHILD_TITLE');
  add(codes, value.observedUtilizationPct === account.utilizationPct, 'CHILD_NUMBER');
  add(codes, value.state === 'unverified', 'CHILD_STATE');
  add(codes, value.blocking === true, 'CHILD_BLOCKING');
  add(codes, value.todo === 'TODO(#127)', 'CHILD_MARKER');
}

function validateChecklist(
  value: unknown,
  seeds: readonly ChecklistSeedV1[],
  features: DerivedFeatures,
  personal: boolean,
  codes: Set<string>,
): void {
  if (!Array.isArray(value) || value.length !== seeds.length) {
    codes.add(personal ? 'PERSONAL_LENGTH' : 'BUSINESS_LENGTH');
    return;
  }

  const expectedStates = checklistStatesFor(seeds, features);
  const accounts = qualifyingAccounts(features);
  for (let index = 0; index < seeds.length; index += 1) {
    const state = value[index];
    const seed = seeds[index];
    const expected = expectedStates[index];
    if (!isRecord(state) || !hasExactKeys(state, STATE_KEYS)) {
      codes.add('STATE_SCHEMA');
      continue;
    }
    add(codes, state.key === seed.key, 'STATE_KEY_ORDER');
    add(codes, state.title === seed.title, 'STATE_TITLE');
    add(codes, state.state === expected.state, 'STATE_VALUE');
    add(codes, state.blocking === true, 'STATE_BLOCKING');
    add(codes, state.todo === 'TODO(#127)', 'STATE_MARKER');

    const expectedChildren = personal && seed.key === 'utilization_under_30' ? accounts : [];
    if (!Array.isArray(state.children) || state.children.length !== expectedChildren.length) {
      codes.add('CHILD_COUNT');
      continue;
    }
    for (let childIndex = 0; childIndex < expectedChildren.length; childIndex += 1) {
      validateChild(state.children[childIndex], expectedChildren[childIndex], codes);
    }
  }
}

function validateLanguage(value: unknown, codes: Set<string>): void {
  for (const code of complianceLanguageCodes(value)) codes.add(code);
}

export function evaluateText(value: unknown): PlanEvaluation {
  const codes = new Set<string>();
  validateLanguage(value, codes);
  return { approved: codes.size === 0, codes: [...codes].sort() };
}

export function evaluatePlan(
  candidate: unknown,
  features: DerivedFeatures,
  expectedPrompt: Pick<ResolvedPrompt, 'key' | 'version'> = { key: 'funding-readiness-plan', version: 1 },
): PlanEvaluation {
  const codes = new Set<string>();
  validateLanguage(candidate, codes);

  if (!isRecord(candidate) || !hasExactKeys(candidate, PLAN_KEYS)) {
    codes.add('PLAN_SCHEMA');
    return { approved: false, codes: [...codes].sort() };
  }

  add(codes, candidate.schemaVersion === 1, 'SCHEMA_VERSION');
  add(codes, candidate.derivedSchemaVersion === features.schemaVersion, 'DERIVED_SCHEMA_VERSION');
  add(
    codes,
    isRecord(candidate.prompt) &&
      hasExactKeys(candidate.prompt, PROMPT_KEYS) &&
      candidate.prompt.key === expectedPrompt.key &&
      candidate.prompt.version === expectedPrompt.version,
    'PROMPT_REFERENCE',
  );

  const expectedScore = computeReadinessScore(features);
  add(codes, integerInRange(candidate.readinessScore, 0, 100), 'SCORE_SCHEMA');
  add(codes, candidate.readinessScore === expectedScore, 'SCORE_VALUE');
  add(codes, candidate.readinessLabel === readinessLabelFor(expectedScore), 'READINESS_LABEL');
  if (candidate.readinessLabel === 'Ready') {
    add(codes, candidate.readinessScore === 100, 'READY_REQUIRES_COMPLETE');
  }

  validateChecklist(candidate.personalChecklist, PERSONAL_CHECKLIST_V1, features, true, codes);
  validateChecklist(candidate.businessChecklist, BUSINESS_CHECKLIST_V1, features, false, codes);

  add(
    codes,
    isRecord(candidate.estimatedCompletion) &&
      hasExactKeys(candidate.estimatedCompletion, ESTIMATE_KEYS) &&
      candidate.estimatedCompletion.label === 'TBD' &&
      candidate.estimatedCompletion.days === null,
    'COMPLETION_ESTIMATE',
  );
  add(
    codes,
    isRecord(candidate.generation) &&
      hasExactKeys(candidate.generation, GENERATION_KEYS) &&
      (candidate.generation.driver === 'mock' || candidate.generation.driver === 'openrouter') &&
      typeof candidate.generation.model === 'string' &&
      candidate.generation.model.length >= 1 &&
      candidate.generation.model.length <= 128 &&
      candidate.generation.promptVersion === expectedPrompt.version,
    'GENERATION_METADATA',
  );

  if (isRecord(candidate.generation) && typeof candidate.generation.model === 'string') {
    add(codes, candidate.generation.model.trim() === candidate.generation.model, 'GENERATION_MODEL');
  }
  return { approved: codes.size === 0, codes: [...codes].sort() };
}
