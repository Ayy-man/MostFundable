import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ACTION_DURATIONS_V1,
  BUSINESS_CHECKLIST_V1,
  PERSONAL_CHECKLIST_V1,
  checklistStatesFor,
  estimateCompletion,
} from './checklist-seeds.ts';
import {
  PLAN_CANDIDATE_SCHEMA_V1,
  PLAN_PROMPT_V1,
  PLAN_SUPERVISOR_SCHEMA_V1,
  serializeDerived,
} from './prompts/plan-v1.ts';

import type { DerivedFeatures } from '../analysis/features.ts';

const FEATURE_FIXTURE: DerivedFeatures = {
  schemaVersion: 1,
  bureausPulled: ['EQF', 'EXP', 'TUC'],
  accounts: [],
  overallUtilizationPct: 5,
  inquiriesByBureau: { EQF: 1, EXP: 1, TUC: 1 },
  negativesCount: 0,
  openRevolvingCount: 4,
  averageAgeMonths: 48,
  highestRevolvingLimitCents: 1_000_000,
  dti: {
    monthlyDebtPaymentsCents: 100_000,
    statedMonthlyIncomeCents: null,
    ratioPct: null,
  },
  flags: {
    utilizationUnder30: true,
    fourOrMorePersonalAccountsOpen: true,
    averageAgeTwoYearsOrMore: true,
    noNegativeItemsReported: true,
    cardWithTenKLimit: true,
    twoOrFewerInquiriesEveryBureau: true,
    thinFile: false,
  },
  computedAt: '2026-08-16T12:00:00.000Z',
};

function assertStrictObjects(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertStrictObjects);
    return;
  }
  if (typeof value !== 'object' || value === null) return;

  const record = value as Record<string, unknown>;
  if (record.type === 'object') assert.equal(record.additionalProperties, false);
  Object.values(record).forEach(assertStrictObjects);
}

describe('checklist seed registries', () => {
  it('contains the complete personal and business inventories in stable order', () => {
    assert.deepEqual(PERSONAL_CHECKLIST_V1.map((seed) => seed.key), [
      'credit_score_700',
      'personal_information_confirmed',
      'clean_report',
      'utilization_under_30',
      'four_personal_accounts_open',
      'average_age_two_years',
      'no_late_payments',
      'no_negative_items_reported',
      'personal_card_ten_k_limit',
      'inquiries_within_bureau_limit',
    ]);
    assert.deepEqual(BUSINESS_CHECKLIST_V1.map((seed) => seed.key), [
      'business_name_confirmed',
      'industry_classification_confirmed',
      'business_entity_age_confirmed',
      'net_asset_value_confirmed',
      'business_identifier_present',
      'business_email_present',
      'business_website_present',
    ]);
  });

  it('marks every unique seed as blocking and pending confirmation', () => {
    const seeds = [...PERSONAL_CHECKLIST_V1, ...BUSINESS_CHECKLIST_V1];
    assert.equal(new Set(seeds.map((seed) => seed.key)).size, 17);
    assert.ok(seeds.every((seed) => seed.blocking));
    assert.ok(seeds.every((seed) => seed.todo === 'TODO(#127)'));
    assert.ok(seeds.every((seed) => seed.title.length > 0));
  });

  it('maps only the six frozen feature predicates to verified states', () => {
    const personal = checklistStatesFor(PERSONAL_CHECKLIST_V1, FEATURE_FIXTURE);
    const business = checklistStatesFor(BUSINESS_CHECKLIST_V1, FEATURE_FIXTURE);

    assert.deepEqual(personal.filter((item) => ['credit_score_700', 'personal_information_confirmed', 'clean_report', 'no_late_payments'].includes(item.key)).map((state) => state.state), [
      'unverified',
      'unverified',
      'unverified',
      'unverified',
    ]);
    assert.ok(personal.filter((item) => !['credit_score_700', 'personal_information_confirmed', 'clean_report', 'no_late_payments'].includes(item.key)).every((state) => state.state === 'verified'));
    assert.ok(business.every((state) => state.state === 'unverified'));
  });

  it('keeps every duration unknown and exhaustive', () => {
    const keys = [...PERSONAL_CHECKLIST_V1, ...BUSINESS_CHECKLIST_V1].map((seed) => seed.key);
    assert.deepEqual(Object.keys(ACTION_DURATIONS_V1), keys);
    assert.ok(
      Object.values(ACTION_DURATIONS_V1).every(
        (duration) => duration.label === 'TBD' && duration.days === null,
      ),
    );
    assert.deepEqual(estimateCompletion(), { label: 'TBD', days: null });
  });
});

describe('prompt version and schemas', () => {
  it('has one stable prompt identity and separate strict schemas', () => {
    assert.equal(PLAN_PROMPT_V1.key, 'funding-readiness-plan');
    assert.equal(PLAN_PROMPT_V1.version, 1);
    assert.notEqual(PLAN_PROMPT_V1.candidateSchemaName, PLAN_PROMPT_V1.supervisorSchemaName);
    assertStrictObjects(PLAN_CANDIDATE_SCHEMA_V1);
    assertStrictObjects(PLAN_SUPERVISOR_SCHEMA_V1);
  });

  it('declares exact top-level candidate and supervisor keys', () => {
    assert.deepEqual(PLAN_CANDIDATE_SCHEMA_V1.required, [
      'schemaVersion',
      'prompt',
      'derivedSchemaVersion',
      'readinessScore',
      'readinessLabel',
      'personalChecklist',
      'businessChecklist',
      'estimatedCompletion',
      'generation',
    ]);
    assert.deepEqual(Object.keys(PLAN_CANDIDATE_SCHEMA_V1.properties), PLAN_CANDIDATE_SCHEMA_V1.required);
    assert.deepEqual(PLAN_SUPERVISOR_SCHEMA_V1.required, ['approved', 'codes']);
    assert.deepEqual(Object.keys(PLAN_SUPERVISOR_SCHEMA_V1.properties), ['approved', 'codes']);
  });

  it('serializes an exact detached DerivedFeatures projection', () => {
    const serialized = serializeDerived(FEATURE_FIXTURE);
    assert.deepEqual(serialized, FEATURE_FIXTURE);
    assert.notEqual(serialized, FEATURE_FIXTURE);
    assert.notEqual(serialized.accounts, FEATURE_FIXTURE.accounts);
    assert.notEqual(serialized.flags, FEATURE_FIXTURE.flags);
    assert.deepEqual(Object.keys(serialized).sort(), [
      'accounts',
      'averageAgeMonths',
      'bureausPulled',
      'computedAt',
      'dti',
      'flags',
      'highestRevolvingLimitCents',
      'inquiriesByBureau',
      'negativesCount',
      'openRevolvingCount',
      'overallUtilizationPct',
      'schemaVersion',
    ]);
  });
});
