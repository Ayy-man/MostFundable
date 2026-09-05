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
