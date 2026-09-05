/**
 * The reference facts packs a staged narrative prompt is evaluated against.
 *
 * Two synthetic consumers, chosen so the two ways this prompt fails are both reachable: one file
 * with several unverified items, dollars, percents and a creditor label — the case where a model
 * invents an arithmetic result or reaches for a brand name — and one clean file, where the risk is
 * the opposite, a model writing a gap that is not there. Every number is invented. No real person,
 * no real account, no real institution.
 *
 * It lives beside the contract rather than in `admin/eval-policy.ts` because the pack shape is this
 * lane's, and `eval-policy.ts` should hash a dataset rather than own one.
 */

import type { FactsPackV2 } from './contract.ts';

const MIXED_FILE: FactsPackV2 = Object.freeze({
  schemaVersion: 2,
  computedAt: '2026-09-05T00:00:00.000Z',
  bureausPulled: Object.freeze(['EQF', 'EXP', 'TUC'] as const),
  readinessScore: 41,
  readinessLabel: 'Building Readiness',
  itemsToFix: 4,
  personalVerifiedCount: 6,
  personal: Object.freeze([
    { key: 'credit_score_700', state: 'unverified', observed: { score: 664 }, target: '700 or higher', gap: 'The highest bureau score on file is 664, below the 700 target.' },
    { key: 'personal_information_confirmed', state: 'verified', observed: { namesOnFile: 1 }, target: 'one name, one current address', gap: null },
    { key: 'clean_report', state: 'verified', observed: { addressesOnFile: 2, employersOnFile: 1 }, target: 'no extra addresses or employers', gap: null },
    { key: 'utilization_under_30', state: 'unverified', observed: { worstUtilizationPct: 84 }, target: 'under 30% on every card', gap: 'One card is at 84%, above the 30% target.' },
    { key: 'four_personal_accounts_open', state: 'verified', observed: { openAccountsCount: 5 }, target: 'four or more open', gap: null },
    { key: 'average_age_two_years', state: 'verified', observed: { averageAgeMonths: 39 }, target: 'two years or more', gap: null },
    { key: 'no_late_payments', state: 'unverified', observed: { lateAccounts: 1 }, target: 'no late payments in 24 months', gap: 'One account reports a late payment inside the last 24 months.' },
    { key: 'no_negative_items_reported', state: 'verified', observed: { negativesCount: 0 }, target: 'no negative items', gap: null },
    { key: 'personal_card_ten_k_limit', state: 'verified', observed: { highestRevolvingLimitCents: 1_200_000 }, target: 'one card at $10,000 or higher', gap: null },
    { key: 'inquiries_within_bureau_limit', state: 'unverified', observed: { worstBureauInquiries: 3 }, target: 'two or fewer on each bureau', gap: 'One bureau reports 3 inquiries, above the limit of 2.' },
  ] as const),
  business: Object.freeze([
    { key: 'business_name_confirmed', state: 'not_checkable', observed: {}, target: 'confirmed by the owner', gap: null },
    { key: 'industry_classification_confirmed', state: 'not_checkable', observed: {}, target: 'confirmed by the owner', gap: null },
    { key: 'business_entity_age_confirmed', state: 'not_checkable', observed: {}, target: 'confirmed by the owner', gap: null },
    { key: 'net_asset_value_confirmed', state: 'not_checkable', observed: {}, target: 'confirmed by the owner', gap: null },
    { key: 'business_identifier_present', state: 'not_checkable', observed: {}, target: 'supplied by the owner', gap: null },
    { key: 'business_email_present', state: 'not_checkable', observed: {}, target: 'supplied by the owner', gap: null },
    { key: 'business_website_present', state: 'not_checkable', observed: {}, target: 'supplied by the owner', gap: null },
  ] as const),
  accounts: Object.freeze([
    { accountRef: 'account-1', label: 'RETAIL CARD', kind: 'revolving', isOpen: true, isNegative: false, balanceCents: 420_000, limitCents: 500_000, utilizationPct: 84, ageMonths: 48, lateWithin24Months: false, pastDueCents: 0, targetBalanceCents: 145_000, paydownCents: 275_000 },
    { accountRef: 'account-2', label: 'CREDIT UNION CARD', kind: 'revolving', isOpen: true, isNegative: false, balanceCents: 30_000, limitCents: 1_200_000, utilizationPct: 3, ageMonths: 26, lateWithin24Months: false, pastDueCents: 0, targetBalanceCents: 348_000, paydownCents: 0 },
    { accountRef: 'account-3', label: 'AUTO LOAN', kind: 'installment', isOpen: true, isNegative: false, balanceCents: 980_000, limitCents: null, utilizationPct: null, ageMonths: 24, lateWithin24Months: true, pastDueCents: 21_500, targetBalanceCents: null, paydownCents: null },
  ] as const),
  inquiries: Object.freeze([
    { inquiryRef: 'inquiry-1', bureau: 'EXP', monthsAgo: 3, matchedNewAccountWithin45Days: false },
    { inquiryRef: 'inquiry-2', bureau: 'EXP', monthsAgo: 5, matchedNewAccountWithin45Days: true },
    { inquiryRef: 'inquiry-3', bureau: 'EXP', monthsAgo: 9, matchedNewAccountWithin45Days: false },
    { inquiryRef: 'inquiry-4', bureau: 'EQF', monthsAgo: 6, matchedNewAccountWithin45Days: true },
  ] as const),
  scores: Object.freeze([
    { bureau: 'EQF', model: 'VANTAGE', score: 651 },
    { bureau: 'EXP', model: 'VANTAGE', score: 664 },
    { bureau: 'TUC', model: 'VANTAGE', score: 658 },
  ] as const),
  identity: Object.freeze({ namesOnFile: 1, addressesOnFile: 2, employersOnFile: 1 }),
  overallUtilizationPct: 26,
  averageAgeMonths: 39,
  highestRevolvingLimitCents: 1_200_000,
  openAccountsCount: 5,
  negativesCount: 0,
  inquiriesByBureau: Object.freeze({ EQF: 1, EXP: 3, TUC: 0 }),
});

const CLEAN_FILE: FactsPackV2 = Object.freeze({
  schemaVersion: 2,
  computedAt: '2026-09-05T00:00:00.000Z',
  bureausPulled: Object.freeze(['EQF', 'EXP', 'TUC'] as const),
  readinessScore: 92,
  readinessLabel: 'Ready',
  itemsToFix: 0,
  personalVerifiedCount: 10,
  personal: Object.freeze([
    { key: 'credit_score_700', state: 'verified', observed: { score: 742 }, target: '700 or higher', gap: null },
    { key: 'personal_information_confirmed', state: 'verified', observed: { namesOnFile: 1 }, target: 'one name, one current address', gap: null },
    { key: 'clean_report', state: 'verified', observed: { addressesOnFile: 1, employersOnFile: 1 }, target: 'no extra addresses or employers', gap: null },
    { key: 'utilization_under_30', state: 'verified', observed: { worstUtilizationPct: 9 }, target: 'under 30% on every card', gap: null },
    { key: 'four_personal_accounts_open', state: 'verified', observed: { openAccountsCount: 6 }, target: 'four or more open', gap: null },
    { key: 'average_age_two_years', state: 'verified', observed: { averageAgeMonths: 71 }, target: 'two years or more', gap: null },
    { key: 'no_late_payments', state: 'verified', observed: { lateAccounts: 0 }, target: 'no late payments in 24 months', gap: null },
    { key: 'no_negative_items_reported', state: 'verified', observed: { negativesCount: 0 }, target: 'no negative items', gap: null },
    { key: 'personal_card_ten_k_limit', state: 'verified', observed: { highestRevolvingLimitCents: 2_500_000 }, target: 'one card at $10,000 or higher', gap: null },
    { key: 'inquiries_within_bureau_limit', state: 'verified', observed: { worstBureauInquiries: 1 }, target: 'two or fewer on each bureau', gap: null },
  ] as const),
  business: Object.freeze([
    { key: 'business_name_confirmed', state: 'verified', observed: {}, target: 'confirmed by the owner', gap: null },
    { key: 'industry_classification_confirmed', state: 'verified', observed: {}, target: 'confirmed by the owner', gap: null },
    { key: 'business_entity_age_confirmed', state: 'verified', observed: {}, target: 'confirmed by the owner', gap: null },
    { key: 'net_asset_value_confirmed', state: 'verified', observed: {}, target: 'confirmed by the owner', gap: null },
    { key: 'business_identifier_present', state: 'verified', observed: {}, target: 'supplied by the owner', gap: null },
    { key: 'business_email_present', state: 'verified', observed: {}, target: 'supplied by the owner', gap: null },
    { key: 'business_website_present', state: 'verified', observed: {}, target: 'supplied by the owner', gap: null },
  ] as const),
  accounts: Object.freeze([
    { accountRef: 'account-1', label: 'CREDIT UNION CARD', kind: 'revolving', isOpen: true, isNegative: false, balanceCents: 225_000, limitCents: 2_500_000, utilizationPct: 9, ageMonths: 96, lateWithin24Months: false, pastDueCents: 0, targetBalanceCents: 725_000, paydownCents: 0 },
  ] as const),
  inquiries: Object.freeze([]),
  scores: Object.freeze([
    { bureau: 'EQF', model: 'VANTAGE', score: 742 },
    { bureau: 'EXP', model: 'VANTAGE', score: 748 },
    { bureau: 'TUC', model: 'VANTAGE', score: 745 },
  ] as const),
  identity: Object.freeze({ namesOnFile: 1, addressesOnFile: 1, employersOnFile: 1 }),
  overallUtilizationPct: 9,
  averageAgeMonths: 71,
  highestRevolvingLimitCents: 2_500_000,
  openAccountsCount: 6,
  negativesCount: 0,
  inquiriesByBureau: Object.freeze({ EQF: 1, EXP: 1, TUC: 1 }),
});

export const NARRATIVE_REFERENCE_DATASET: readonly FactsPackV2[] = Object.freeze([MIXED_FILE, CLEAN_FILE]);
