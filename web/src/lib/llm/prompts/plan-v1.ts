import type { DerivedFeatures } from '../../analysis/features.ts';

const ACCOUNT_STATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'key',
    'accountRef',
    'title',
    'observedUtilizationPct',
    'state',
    'blocking',
    'todo',
  ],
  properties: {
    key: { type: 'string', minLength: 1, maxLength: 160 },
    accountRef: { type: 'string', minLength: 1, maxLength: 128 },
    title: { type: 'string', minLength: 1, maxLength: 240 },
    observedUtilizationPct: { type: 'number', minimum: 0, maximum: 100 },
    state: { const: 'unverified' },
    blocking: { const: true },
    todo: { const: 'TODO(#127)' },
  },
} as const;

const CHECKLIST_STATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'title', 'state', 'blocking', 'todo', 'children'],
  properties: {
    key: { type: 'string', minLength: 1, maxLength: 128 },
    title: { type: 'string', minLength: 1, maxLength: 240 },
    state: { type: 'string', enum: ['verified', 'unverified'] },
    blocking: { const: true },
    todo: { const: 'TODO(#127)' },
    children: { type: 'array', maxItems: 64, items: ACCOUNT_STATE_SCHEMA },
  },
} as const;

export const PLAN_CANDIDATE_SCHEMA_V1 = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'prompt',
    'derivedSchemaVersion',
    'readinessScore',
    'readinessLabel',
    'personalChecklist',
    'businessChecklist',
    'estimatedCompletion',
    'generation',
  ],
  properties: {
    schemaVersion: { const: 1 },
    prompt: {
      type: 'object',
      additionalProperties: false,
      required: ['key', 'version'],
      properties: {
        key: { const: 'funding-readiness-plan' },
        version: { const: 1 },
      },
    },
    derivedSchemaVersion: { const: 1 },
    readinessScore: { type: 'integer', minimum: 0, maximum: 100 },
    readinessLabel: {
      type: 'string',
      enum: ['Ready', 'Near Ready', 'Building Readiness'],
    },
    personalChecklist: {
      type: 'array',
      minItems: 8,
      maxItems: 8,
      items: CHECKLIST_STATE_SCHEMA,
    },
    businessChecklist: {
      type: 'array',
      minItems: 7,
      maxItems: 7,
      items: CHECKLIST_STATE_SCHEMA,
    },
    estimatedCompletion: {
      type: 'object',
      additionalProperties: false,
      required: ['label', 'days'],
      properties: {
        label: { const: 'TBD' },
        days: { type: 'null' },
      },
    },
    generation: {
      type: 'object',
      additionalProperties: false,
      required: ['driver', 'model', 'promptVersion'],
      properties: {
        driver: { type: 'string', enum: ['mock', 'openrouter'] },
        model: { type: 'string', minLength: 1, maxLength: 128 },
        promptVersion: { const: 1 },
      },
    },
  },
} as const;

export function planCandidateSchemaForPrompt(version: number) {
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('PLAN_PROMPT_VERSION_INVALID');
  return {
    ...PLAN_CANDIDATE_SCHEMA_V1,
    properties: {
      ...PLAN_CANDIDATE_SCHEMA_V1.properties,
      prompt: {
        ...PLAN_CANDIDATE_SCHEMA_V1.properties.prompt,
        properties: {
          ...PLAN_CANDIDATE_SCHEMA_V1.properties.prompt.properties,
          version: { const: version },
        },
      },
      generation: {
        ...PLAN_CANDIDATE_SCHEMA_V1.properties.generation,
        properties: {
          ...PLAN_CANDIDATE_SCHEMA_V1.properties.generation.properties,
          promptVersion: { const: version },
        },
      },
    },
  } as const;
}

export const PLAN_SUPERVISOR_SCHEMA_V1 = {
  type: 'object',
  additionalProperties: false,
  required: ['approved', 'codes'],
  properties: {
    approved: { type: 'boolean' },
    codes: {
      type: 'array',
      maxItems: 32,
      items: { type: 'string', minLength: 1, maxLength: 64 },
    },
  },
} as const;

export function serializeDerived(features: DerivedFeatures): DerivedFeatures {
  return {
    schemaVersion: 1,
    bureausPulled: [...features.bureausPulled],
    accounts: features.accounts.map((account) => ({
      accountRef: account.accountRef,
      kind: account.kind,
      balanceCents: account.balanceCents,
      limitCents: account.limitCents,
      utilizationPct: account.utilizationPct,
      ageMonths: account.ageMonths,
      isOpen: account.isOpen,
      isNegative: account.isNegative,
    })),
    overallUtilizationPct: features.overallUtilizationPct,
    inquiriesByBureau: {
      EQF: features.inquiriesByBureau.EQF,
      EXP: features.inquiriesByBureau.EXP,
      TUC: features.inquiriesByBureau.TUC,
    },
    negativesCount: features.negativesCount,
    openRevolvingCount: features.openRevolvingCount,
    averageAgeMonths: features.averageAgeMonths,
    highestRevolvingLimitCents: features.highestRevolvingLimitCents,
    dti: {
      monthlyDebtPaymentsCents: features.dti.monthlyDebtPaymentsCents,
      statedMonthlyIncomeCents: features.dti.statedMonthlyIncomeCents,
      ratioPct: features.dti.ratioPct,
    },
    flags: {
      utilizationUnder30: features.flags.utilizationUnder30,
      fourOrMorePersonalAccountsOpen: features.flags.fourOrMorePersonalAccountsOpen,
      averageAgeTwoYearsOrMore: features.flags.averageAgeTwoYearsOrMore,
      noNegativeItemsReported: features.flags.noNegativeItemsReported,
      cardWithTenKLimit: features.flags.cardWithTenKLimit,
      twoOrFewerInquiriesEveryBureau: features.flags.twoOrFewerInquiriesEveryBureau,
      thinFile: features.flags.thinFile,
    },
    computedAt: features.computedAt,
  };
}

const PLAN_SYSTEM_V1 =
  'Create a grounded funding-readiness state plan using only the supplied derived values. ' +
  'Return the exact requested schema and do not add predictions or unsupported facts.';

export const PLAN_EMBEDDED_PROMPT = Object.freeze({
  key: 'funding-readiness-plan' as const,
  version: 1 as const,
  body: PLAN_SYSTEM_V1,
});

export const PLAN_PROMPT_V1 = Object.freeze({
  key: 'funding-readiness-plan' as const,
  version: 1 as const,
  system: PLAN_SYSTEM_V1,
  body: PLAN_SYSTEM_V1,
  candidateSchemaName: 'funding_readiness_plan_v1',
  supervisorSchemaName: 'funding_readiness_supervisor_v1',
  candidateSchema: PLAN_CANDIDATE_SCHEMA_V1,
  supervisorSchema: PLAN_SUPERVISOR_SCHEMA_V1,
  serializeDerived,
});
