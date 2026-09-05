import type { AccountFeature, DerivedFeatures } from '../../analysis/features.ts';

const INSTANT = '2026-08-16T12:00:00.000Z';

function account(
  accountRef: string,
  utilizationPct: number | null,
  overrides: Partial<AccountFeature> = {},
): AccountFeature {
  return {
    accountRef,
    kind: 'revolving',
    balanceCents: utilizationPct === null ? 0 : utilizationPct * 1_000,
    limitCents: utilizationPct === null ? null : 100_000,
    utilizationPct,
    ageMonths: 36,
    isOpen: true,
    isNegative: false,
    ...overrides,
  };
}

function baseFeatures(): DerivedFeatures {
  return {
    schemaVersion: 2,
    bureausPulled: ['EQF', 'EXP', 'TUC'],
    accounts: [],
    overallUtilizationPct: null,
    scores: [{ bureau: 'EQF', model: 'VANTAGE', score: 740 }],
    identity: { namesOnFile: 1, addressesOnFile: 1, employersOnFile: 0 },
    inquiries: [],
    inquiriesByBureau: { EQF: 0, EXP: 0, TUC: 0 },
    negativesCount: 0,
    lateAccountsCount: 0,
    collectionsCount: 0,
    publicRecordsCount: 0,
    openRevolvingCount: 0,
    averageAgeMonths: null,
    highestRevolvingLimitCents: null,
    dti: {
      monthlyDebtPaymentsCents: 0,
      statedMonthlyIncomeCents: null,
      ratioPct: null,
    },
    flags: {
      scoreAtLeast700: true,
      personalInformationConfirmed: false,
      cleanReport: true,
      utilizationUnder30: false,
      fourOrMorePersonalAccountsOpen: false,
      averageAgeTwoYearsOrMore: false,
      noLatePayments: true,
      noNegativeItemsReported: false,
      cardWithTenKLimit: false,
      twoOrFewerInquiriesEveryBureau: false,
      thinFile: false,
    },
    computedAt: INSTANT,
  };
}

export function cleanFeatures(): DerivedFeatures {
  const features = baseFeatures();
  features.accounts = [
    account('mock-acct-cl1', 6, { limitCents: 1_500_000, balanceCents: 90_000 }),
    account('mock-acct-cl2', 5),
    account('mock-acct-cl3', 5),
    account('mock-acct-cl4', null, { kind: 'installment' }),
    account('mock-acct-cl5', null, { kind: 'mortgage' }),
    account('mock-acct-cl6', 0),
  ];
  features.overallUtilizationPct = 5;
  features.inquiriesByBureau = { EQF: 2, EXP: 1, TUC: 0 };
  features.openRevolvingCount = 4;
  features.averageAgeMonths = 73.5;
  features.highestRevolvingLimitCents = 1_500_000;
  features.flags = {
    scoreAtLeast700: true,
    personalInformationConfirmed: false,
    cleanReport: true,
    utilizationUnder30: true,
    fourOrMorePersonalAccountsOpen: true,
    averageAgeTwoYearsOrMore: true,
    noLatePayments: true,
    noNegativeItemsReported: true,
    cardWithTenKLimit: true,
    twoOrFewerInquiriesEveryBureau: true,
    thinFile: false,
  };
  return features;
}

export function derogFeatures(): DerivedFeatures {
  const features = baseFeatures();
  features.accounts = [
    account('mock-acct-dg1', 92.9),
    account('mock-acct-dg2', 92.8),
    account('mock-acct-dg3', 64.7),
    account('mock-acct-dg4', 86.7),
    account('mock-acct-dg5', null, { kind: 'installment', isNegative: true }),
    account('mock-acct-dg6', null, { kind: 'mortgage' }),
    account('mock-acct-dg7', null, { kind: 'other', isNegative: true }),
  ];
  features.overallUtilizationPct = 87.8;
  features.inquiriesByBureau = { EQF: 5, EXP: 2, TUC: 1 };
  features.negativesCount = 2;
  features.openRevolvingCount = 4;
  features.averageAgeMonths = 34.4;
  features.highestRevolvingLimitCents = 450_000;
  features.flags = {
    scoreAtLeast700: false,
    personalInformationConfirmed: false,
    cleanReport: false,
    utilizationUnder30: false,
    fourOrMorePersonalAccountsOpen: true,
    averageAgeTwoYearsOrMore: true,
    noLatePayments: false,
    noNegativeItemsReported: false,
    cardWithTenKLimit: false,
    twoOrFewerInquiriesEveryBureau: false,
    thinFile: false,
  };
  return features;
}

export function thinFileFeatures(): DerivedFeatures {
  const features = baseFeatures();
  features.accounts = [
    account('mock-acct-tf1', 10),
    account('mock-acct-tf2', 15),
    account('mock-acct-tf3', null, { kind: 'installment' }),
  ];
  features.overallUtilizationPct = 12.4;
  features.inquiriesByBureau = { EQF: 1, EXP: 0, TUC: 0 };
  features.openRevolvingCount = 2;
  features.averageAgeMonths = 10;
  features.highestRevolvingLimitCents = 500_000;
  features.flags = {
    scoreAtLeast700: false,
    personalInformationConfirmed: false,
    cleanReport: true,
    utilizationUnder30: true,
    fourOrMorePersonalAccountsOpen: false,
    averageAgeTwoYearsOrMore: false,
    noLatePayments: true,
    noNegativeItemsReported: true,
    cardWithTenKLimit: false,
    twoOrFewerInquiriesEveryBureau: true,
    thinFile: true,
  };
  return features;
}

export function noHitFeatures(): DerivedFeatures {
  const features = baseFeatures();
  features.bureausPulled = [];
  features.flags.thinFile = true;
  return features;
}
