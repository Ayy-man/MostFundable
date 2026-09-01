import type { DerivedFeatures } from '../analysis/features.ts';
import type {
  ChecklistSeedV1,
  ChecklistStateV1,
  UnknownCompletionEstimateV1,
} from './types.ts';

export const PERSONAL_CHECKLIST_V1 = [
  {
    key: 'personal_information_confirmed',
    kind: 'personal_credit',
    title: 'Personal information is confirmed',
    blocking: true,
    todo: 'TODO(#127)',
    evidenceFlag: null,
  },
  {
    key: 'overall_report_ready',
    kind: 'personal_credit',
    title: 'Overall report readiness is confirmed',
    blocking: true,
    todo: 'TODO(#127)',
    evidenceFlag: null,
  },
  {
    key: 'utilization_under_30',
    kind: 'personal_credit',
    title: 'Revolving utilization is under 30%',
    blocking: true,
    todo: 'TODO(#127)',
    evidenceFlag: 'utilizationUnder30',
  },
  {
    key: 'four_personal_accounts_open',
    kind: 'personal_credit',
    title: 'Four or more personal accounts are open',
    blocking: true,
    todo: 'TODO(#127)',
    evidenceFlag: 'fourOrMorePersonalAccountsOpen',
  },
  {
    key: 'average_age_two_years',
    kind: 'personal_credit',
    title: 'Average account age is at least two years',
    blocking: true,
    todo: 'TODO(#127)',
    evidenceFlag: 'averageAgeTwoYearsOrMore',
  },
  {
    key: 'no_negative_items_reported',
    kind: 'personal_credit',
    title: 'No negative items are reported',
    blocking: true,
    todo: 'TODO(#127)',
    evidenceFlag: 'noNegativeItemsReported',
  },
  {
    key: 'personal_card_ten_k_limit',
    kind: 'personal_credit',
    title: 'A personal revolving account has a limit of at least $10,000',
    blocking: true,
    todo: 'TODO(#127)',
    evidenceFlag: 'cardWithTenKLimit',
  },
  {
    key: 'inquiries_within_bureau_limit',
    kind: 'personal_credit',
    title: 'Every bureau reports two or fewer inquiries',
    blocking: true,
    todo: 'TODO(#127)',
    evidenceFlag: 'twoOrFewerInquiriesEveryBureau',
  },
] as const satisfies readonly ChecklistSeedV1[];

export const BUSINESS_CHECKLIST_V1 = [
  {
    key: 'business_name_confirmed',
    kind: 'business_setup',
    title: 'Business name is confirmed for funding readiness',
    blocking: true,
    todo: 'TODO(#127)',
    evidenceFlag: null,
  },
  {
    key: 'industry_classification_confirmed',
    kind: 'business_setup',
    title: 'Industry classification is confirmed',
    blocking: true,
    todo: 'TODO(#127)',
    evidenceFlag: null,
  },
  {
    key: 'business_entity_age_confirmed',
    kind: 'business_setup',
    title: 'Business entity age is at least one month',
    blocking: true,
    todo: 'TODO(#127)',
    evidenceFlag: null,
  },
  {
    key: 'net_asset_value_confirmed',
    kind: 'business_setup',
    title: 'Net asset value information is confirmed',
    blocking: true,
    todo: 'TODO(#127)',
    evidenceFlag: null,
  },
  {
    key: 'business_identifier_present',
    kind: 'business_setup',
    title: 'Business identifier is present',
    blocking: true,
    todo: 'TODO(#127)',
    evidenceFlag: null,
  },
  {
    key: 'business_email_present',
    kind: 'business_setup',
    title: 'Business email is present',
    blocking: true,
    todo: 'TODO(#127)',
    evidenceFlag: null,
  },
  {
    key: 'business_website_present',
    kind: 'business_setup',
    title: 'Business website is present',
    blocking: true,
    todo: 'TODO(#127)',
    evidenceFlag: null,
  },
] as const satisfies readonly ChecklistSeedV1[];

export type ChecklistStateKeyV1 =
  | (typeof PERSONAL_CHECKLIST_V1)[number]['key']
  | (typeof BUSINESS_CHECKLIST_V1)[number]['key'];

const ALL_SEEDS = [...PERSONAL_CHECKLIST_V1, ...BUSINESS_CHECKLIST_V1] as const;

export const ACTION_DURATIONS_V1 = Object.freeze(
  Object.fromEntries(
    ALL_SEEDS.map((seed) => [seed.key, Object.freeze({ label: 'TBD', days: null })]),
  ) as Record<ChecklistStateKeyV1, Readonly<UnknownCompletionEstimateV1>>,
);

if (Object.keys(ACTION_DURATIONS_V1).length !== ALL_SEEDS.length) {
  throw new Error('CHECKLIST_DURATION_REGISTRY_INVALID');
}

export function checklistStatesFor(
  seeds: readonly ChecklistSeedV1[],
  features: DerivedFeatures,
): ChecklistStateV1[] {
  return seeds.map((seed) => ({
    key: seed.key,
    title: seed.title,
    state:
      seed.evidenceFlag !== null && features.flags[seed.evidenceFlag]
        ? 'verified'
        : 'unverified',
    blocking: true,
    todo: 'TODO(#127)',
    children: [],
  }));
}

export function estimateCompletion(): UnknownCompletionEstimateV1 {
  return { label: 'TBD', days: null };
}
