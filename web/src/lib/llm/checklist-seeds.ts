import type { DerivedFeatures } from '../analysis/features.ts';
import { PERSONAL_ITEM_KEYS_V2, PERSONAL_ITEM_TITLES_V2 } from './narrative/contract.ts';
import type {
  ChecklistSeedV1,
  ChecklistStateV1,
  UnknownCompletionEstimateV1,
} from './types.ts';

const PERSONAL_FLAG_BY_KEY = {
  credit_score_700: 'scoreAtLeast700',
  personal_information_confirmed: null,
  clean_report: 'cleanReport',
  utilization_under_30: 'utilizationUnder30',
  four_personal_accounts_open: 'fourOrMorePersonalAccountsOpen',
  average_age_two_years: 'averageAgeTwoYearsOrMore',
  no_late_payments: 'noLatePayments',
  no_negative_items_reported: 'noNegativeItemsReported',
  personal_card_ten_k_limit: 'cardWithTenKLimit',
  inquiries_within_bureau_limit: 'twoOrFewerInquiriesEveryBureau',
} as const;

export const PERSONAL_CHECKLIST_V1 = PERSONAL_ITEM_KEYS_V2.map((key) => ({
  key,
  kind: 'personal_credit' as const,
  title: PERSONAL_ITEM_TITLES_V2[key],
  blocking: true,
  todo: 'TODO(#127)' as const,
  evidenceFlag: PERSONAL_FLAG_BY_KEY[key],
})) satisfies readonly ChecklistSeedV1[];

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
