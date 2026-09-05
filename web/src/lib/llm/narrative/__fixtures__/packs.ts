/**
 * Hand-built `FactsPackV2` fixtures for the narrative tests.
 *
 * Built from the contract types by hand rather than through `facts.ts`, on purpose. The whole
 * value of the checker is that it is an independent statement of what the narrative may say; a test
 * that produced its pack with the same code the production path uses would prove the two halves
 * agree with each other and nothing about whether either is right.
 *
 * `tinyPack` is a minimum viable pack — one unverified item, one account, one score — so a test
 * that is about one code is not reading past forty fields of scenery to find it. `packWith` layers
 * an override on top of it.
 */

import type { AccountFactV2, FactV2, FactsPackV2 } from '../contract.ts';

export function tinyPack(): FactsPackV2 {
  return {
    schemaVersion: 2,
    computedAt: '2026-09-05T12:00:00.000Z',
    bureausPulled: ['EQF'],
    readinessScore: 62,
    readinessLabel: 'Near Ready',
    itemsToFix: 1,
    personalVerifiedCount: 9,
    personal: [
      {
        key: 'utilization_under_30',
        state: 'unverified',
        observed: { worstUtilizationPct: 84 },
        target: 'under 30% on every card',
        gap: 'One card is at 84%, above the 30% target.',
      },
    ],
    business: [
      { key: 'business_email_present', state: 'not_checkable', observed: {}, target: 'supplied by the owner', gap: null },
    ],
    accounts: [
      {
        accountRef: 'account-1',
        label: 'RETAIL CARD 2020',
        kind: 'revolving',
        isOpen: true,
        isNegative: false,
        balanceCents: 420_000,
        limitCents: 500_000,
        utilizationPct: 84,
        ageMonths: 48,
        lateWithin24Months: false,
        pastDueCents: 0,
      },
    ],
    inquiries: [],
    scores: [{ bureau: 'EQF', model: 'VANTAGE', score: 688 }],
    identity: { namesOnFile: 1, addressesOnFile: 1, employersOnFile: 1 },
    overallUtilizationPct: 84,
    averageAgeMonths: 48,
    highestRevolvingLimitCents: 500_000,
    openAccountsCount: 1,
    negativesCount: 0,
    inquiriesByBureau: { EQF: 0, EXP: 0, TUC: 0 },
  };
}

export function packWith(overrides: Partial<FactsPackV2>): FactsPackV2 {
  return { ...tinyPack(), ...overrides };
}

export function personalFact(key: FactV2['key'], state: FactV2['state']): FactV2 {
  return {
    key,
    state,
    observed: {},
    target: 'the founder target',
    gap: state === 'unverified' ? 'A one-line gap with no numbers in it.' : null,
  };
}

export function accountWithLabel(label: string | null): AccountFactV2 {
  return { ...tinyPack().accounts[0], label };
}

/**
 * Four cards at or over their limits, a late payment, and four inquiries on one bureau.
 *
 * The hardest scenario for this prompt, and the one the live smoke run uses. Every failure mode
 * the eval found lives here: several dollar figures within an order of magnitude of each other
 * (so a unit slip is visible), more than three problems competing for at most three steps (so the
 * model has to rank rather than list), and a utilization number per card that invites the model to
 * compute a paydown figure the pack does not carry.
 */
export function maxedCardsPack(): FactsPackV2 {
  return {
    schemaVersion: 2,
    computedAt: '2026-09-05T12:00:00.000Z',
    bureausPulled: ['EQF', 'EXP', 'TUC'],
    readinessScore: 28,
    readinessLabel: 'Building Readiness',
    itemsToFix: 5,
    personalVerifiedCount: 4,
    personal: [
      { key: 'credit_score_700', state: 'unverified', observed: { score: 598 }, target: '700 or higher', gap: 'The highest bureau score on file is 598, below the 700 target.' },
      { key: 'personal_information_confirmed', state: 'verified', observed: { namesOnFile: 1 }, target: 'one name, one current address', gap: null },
      { key: 'clean_report', state: 'not_checkable', observed: {}, target: 'no extra addresses or employers', gap: null },
      { key: 'utilization_under_30', state: 'unverified', observed: { worstUtilizationPct: 103 }, target: 'under 30% on every card', gap: 'The worst card is at 103%, above the 30% target.' },
      { key: 'four_personal_accounts_open', state: 'verified', observed: { openAccountsCount: 4 }, target: 'four or more open', gap: null },
      { key: 'average_age_two_years', state: 'unverified', observed: { averageAgeMonths: 14 }, target: 'two years or more', gap: 'Average account age is 14 months, under the 24-month target.' },
      { key: 'no_late_payments', state: 'unverified', observed: { lateAccounts: 2 }, target: 'no late payments in 24 months', gap: '2 accounts report a late payment inside the last 24 months.' },
      { key: 'no_negative_items_reported', state: 'verified', observed: { negativesCount: 0 }, target: 'no negative items', gap: null },
      { key: 'personal_card_ten_k_limit', state: 'unverified', observed: { highestRevolvingLimitCents: 350_000 }, target: 'one card at $10,000 or higher', gap: 'The largest limit on file is $3,500, under the $10,000 target.' },
      { key: 'inquiries_within_bureau_limit', state: 'verified', observed: { worstBureauInquiries: 2 }, target: 'two or fewer on each bureau', gap: null },
    ],
    business: [
      { key: 'business_name_confirmed', state: 'not_checkable', observed: {}, target: 'confirmed by the owner', gap: null },
      { key: 'business_email_present', state: 'not_checkable', observed: {}, target: 'supplied by the owner', gap: null },
      { key: 'business_website_present', state: 'not_checkable', observed: {}, target: 'supplied by the owner', gap: null },
    ],
    accounts: [
      { accountRef: 'account-1', label: 'STORE CARD', kind: 'revolving', isOpen: true, isNegative: false, balanceCents: 103_000, limitCents: 100_000, utilizationPct: 103, ageMonths: 11, lateWithin24Months: true, pastDueCents: 4_500 },
      { accountRef: 'account-2', label: 'CREDIT UNION VISA', kind: 'revolving', isOpen: true, isNegative: false, balanceCents: 332_500, limitCents: 350_000, utilizationPct: 95, ageMonths: 22, lateWithin24Months: false, pastDueCents: 0 },
      { accountRef: 'account-3', label: 'GAS CARD', kind: 'revolving', isOpen: true, isNegative: false, balanceCents: 48_000, limitCents: 60_000, utilizationPct: 80, ageMonths: 9, lateWithin24Months: true, pastDueCents: 3_200 },
      { accountRef: 'account-4', label: 'AUTO LOAN', kind: 'installment', isOpen: true, isNegative: false, balanceCents: 1_840_000, limitCents: null, utilizationPct: null, ageMonths: 14, lateWithin24Months: false, pastDueCents: 0 },
    ],
    inquiries: [
      { inquiryRef: 'inquiry-1', bureau: 'EQF', monthsAgo: 2, matchedNewAccountWithin45Days: true },
      { inquiryRef: 'inquiry-2', bureau: 'EQF', monthsAgo: 7, matchedNewAccountWithin45Days: false },
      { inquiryRef: 'inquiry-3', bureau: 'EXP', monthsAgo: 4, matchedNewAccountWithin45Days: true },
      { inquiryRef: 'inquiry-4', bureau: 'TUC', monthsAgo: 10, matchedNewAccountWithin45Days: false },
    ],
    scores: [
      { bureau: 'EQF', model: 'VANTAGE', score: 581 },
      { bureau: 'EXP', model: 'VANTAGE', score: 598 },
      { bureau: 'TUC', model: 'VANTAGE', score: 590 },
    ],
    identity: { namesOnFile: 1, addressesOnFile: 1, employersOnFile: 2 },
    overallUtilizationPct: 96,
    averageAgeMonths: 14,
    highestRevolvingLimitCents: 350_000,
    openAccountsCount: 4,
    negativesCount: 0,
    inquiriesByBureau: { EQF: 2, EXP: 1, TUC: 1 },
  };
}
