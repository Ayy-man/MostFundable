import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createMockAdapter } from '../crs/mock/driver.ts';
import { createFixedClock } from '../crs/ports.ts';
import { sealReport } from '../crs/report.ts';
import { extractFeatures } from './features.ts';

import type {
  CrsAdapter,
  CrsIdentity,
  CrsPersona,
  ReportCode,
  SoftPullReport,
} from '../crs/types.ts';
import type { CrsWebhookConfig } from '../crs/webhook.ts';
import type { AccountFeature, DerivedFeatures } from './features.ts';

const CLOCK_INSTANT = '2026-08-16T12:00:00.000Z';
const ALL_REPORT_CODES: ReportCode[] = ['EQF1001', 'EXP1001', 'TUC3002'];
const SOURCE_CANARY = 'SOURCE-ONLY-CANARY-71c8d6';

const SYNTHETIC_IDENTITY: CrsIdentity = {
  firstName: 'Mock',
  lastName: 'Subject',
  dateOfBirth: '1990-01-01',
  ssn: '000000000',
  address: { line1: '1 Mock Way', city: 'Mocktown', state: 'CA', postalCode: '00000' },
  email: 'mock-subject@example.invalid',
  phone: '+15550000000',
};

const UNCONFIGURED_WEBHOOK: CrsWebhookConfig = {
  basicUser: null,
  basicPass: null,
  hmacSecret: null,
  hmacHeader: 'x-crs-signature',
  sourceIps: [],
};

function newAdapter(): CrsAdapter {
  return createMockAdapter({
    clock: createFixedClock(CLOCK_INSTANT),
    webhookConfig: UNCONFIGURED_WEBHOOK,
  });
}

async function reportFor(adapter: CrsAdapter, persona: CrsPersona): Promise<SoftPullReport> {
  const member = await adapter.createMember(SYNTHETIC_IDENTITY, { personaHint: persona });
  return adapter.softPull(member.memberRef, ALL_REPORT_CODES);
}

async function featuresFor(persona: CrsPersona): Promise<DerivedFeatures> {
  return extractFeatures(await reportFor(newAdapter(), persona));
}

function account(input: Partial<AccountFeature> & Pick<AccountFeature, 'accountRef'>) {
  return {
    accountRef: input.accountRef,
    kind: input.kind ?? 'revolving',
    balanceCents: input.balanceCents ?? 0,
    limitCents: input.limitCents === undefined ? 100_000 : input.limitCents,
    ageMonths: input.ageMonths === undefined ? 24 : input.ageMonths,
    isOpen: input.isOpen ?? true,
    isNegative: input.isNegative ?? false,
  };
}

function normalizedReport(input: {
  accounts: Array<ReturnType<typeof account>>;
  inquiries?: number;
  monthlyDebtPaymentsCents?: number;
  subjectRef?: string;
}): SoftPullReport {
  const inquiries = Array.from({ length: input.inquiries ?? 0 }, (_, index) => ({
    inquiryRef: index === 0 && input.subjectRef === SOURCE_CANARY
      ? SOURCE_CANARY
      : `synthetic-inquiry-${index}`,
    monthsAgo: index,
  }));
  const body = {
    noHit: false,
    perBureau: [
      {
        bureau: 'EQF',
        reportCode: 'EQF1001',
        pulledAt: CLOCK_INSTANT,
        subjectRef: input.subjectRef ?? 'synthetic-subject',
        accounts: input.accounts,
        inquiries,
        monthlyDebtPaymentsCents: input.monthlyDebtPaymentsCents ?? 0,
      },
    ],
  };

  return sealReport({
    bureaus: ['EQF'],
    reportCodes: ['EQF1001'],
    pulledAt: CLOCK_INSTANT,
    body,
  });
}

function assertExactShape(features: DerivedFeatures): void {
  assert.deepEqual(Object.keys(features).sort(), [
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
  assert.deepEqual(Object.keys(features.dti).sort(), [
    'monthlyDebtPaymentsCents',
    'ratioPct',
    'statedMonthlyIncomeCents',
  ]);
  assert.deepEqual(Object.keys(features.flags).sort(), [
    'averageAgeTwoYearsOrMore',
    'cardWithTenKLimit',
    'fourOrMorePersonalAccountsOpen',
    'noNegativeItemsReported',
    'thinFile',
    'twoOrFewerInquiriesEveryBureau',
    'utilizationUnder30',
  ]);
  for (const item of features.accounts) {
    assert.deepEqual(Object.keys(item).sort(), [
      'accountRef',
      'ageMonths',
      'balanceCents',
      'isNegative',
      'isOpen',
      'kind',
      'limitCents',
      'utilizationPct',
    ]);
  }
}

function containsString(value: unknown, target: string): boolean {
  if (typeof value === 'string') return value.includes(target);
  if (Array.isArray(value)) return value.some((item) => containsString(item, target));
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).some(
      ([key, item]) => key.includes(target) || containsString(item, target),
    );
  }
  return false;
}

describe('extractFeatures persona contract', () => {
  it('extracts the clean persona in canonical order', async () => {
    const features = await featuresFor('clean');

    assertExactShape(features);
    assert.equal(features.schemaVersion, 1);
    assert.deepEqual(features.bureausPulled, ['EQF', 'EXP', 'TUC']);
    assert.deepEqual(features.accounts.map((item) => item.accountRef), [
      'account-1',
      'account-2',
      'account-3',
      'account-4',
      'account-5',
      'account-6',
    ]);
    assert.equal(features.overallUtilizationPct, 5);
    assert.deepEqual(features.inquiriesByBureau, { EQF: 2, EXP: 1, TUC: 0 });
    assert.equal(features.negativesCount, 0);
    assert.equal(features.openRevolvingCount, 4);
    assert.equal(features.averageAgeMonths, 73.5);
    assert.equal(features.highestRevolvingLimitCents, 1_500_000);
    assert.deepEqual(features.dti, {
      monthlyDebtPaymentsCents: 188_000,
      statedMonthlyIncomeCents: null,
      ratioPct: null,
    });
    assert.deepEqual(features.flags, {
      utilizationUnder30: true,
      fourOrMorePersonalAccountsOpen: true,
      averageAgeTwoYearsOrMore: true,
      noNegativeItemsReported: true,
      cardWithTenKLimit: true,
      twoOrFewerInquiriesEveryBureau: true,
      thinFile: false,
    });
    assert.equal(features.computedAt, CLOCK_INSTANT);
  });

  it('collapses matching repeated accounts in the derog persona', async () => {
    const features = await featuresFor('derog');

    assertExactShape(features);
    assert.equal(features.accounts.length, 7);
    assert.deepEqual(features.accounts.map((item) => item.accountRef), [
      'account-1',
      'account-2',
      'account-3',
      'account-4',
      'account-5',
      'account-6',
      'account-7',
    ]);
    assert.deepEqual(
      features.accounts.slice(0, 4).map((item) => item.utilizationPct),
      [92.9, 92.8, 64.7, 86.7],
    );
    assert.equal(features.overallUtilizationPct, 87.8);
    assert.deepEqual(features.inquiriesByBureau, { EQF: 5, EXP: 2, TUC: 1 });
    assert.equal(features.negativesCount, 2);
    assert.equal(features.openRevolvingCount, 4);
    assert.equal(features.averageAgeMonths, 34.4);
    assert.equal(features.highestRevolvingLimitCents, 450_000);
    assert.equal(features.flags.utilizationUnder30, false);
    assert.equal(features.flags.noNegativeItemsReported, false);
    assert.equal(features.flags.twoOrFewerInquiriesEveryBureau, false);
  });

  it('keeps thin-file limiting states conservative', async () => {
    const features = await featuresFor('thin_file');

    assert.equal(features.accounts.length, 3);
    assert.equal(features.overallUtilizationPct, 12.4);
    assert.equal(features.averageAgeMonths, 10);
    assert.equal(features.openRevolvingCount, 2);
    assert.equal(features.flags.fourOrMorePersonalAccountsOpen, false);
    assert.equal(features.flags.averageAgeTwoYearsOrMore, false);
    assert.equal(features.flags.cardWithTenKLimit, false);
    assert.equal(features.flags.thinFile, true);
    assert.equal(features.flags.noNegativeItemsReported, true);
  });

  it('emits a valid exact no-hit object without a marker field', async () => {
    const features = await featuresFor('no_hit');

    assertExactShape(features);
    assert.deepEqual(features, {
      schemaVersion: 1,
      bureausPulled: [],
      accounts: [],
      overallUtilizationPct: null,
      inquiriesByBureau: { EQF: 0, EXP: 0, TUC: 0 },
      negativesCount: 0,
      openRevolvingCount: 0,
      averageAgeMonths: null,
      highestRevolvingLimitCents: null,
      dti: {
        monthlyDebtPaymentsCents: 0,
        statedMonthlyIncomeCents: null,
        ratioPct: null,
      },
      flags: {
        utilizationUnder30: false,
        fourOrMorePersonalAccountsOpen: false,
        averageAgeTwoYearsOrMore: false,
        noNegativeItemsReported: false,
        cardWithTenKLimit: false,
        twoOrFewerInquiriesEveryBureau: false,
        thinFile: true,
      },
      computedAt: CLOCK_INSTANT,
    });
  });
});

describe('extractFeatures boundary rules', () => {
  it('is deterministic for equivalent reports at a fixed instant', async () => {
    const first = extractFeatures(await reportFor(newAdapter(), 'clean'));
    const second = extractFeatures(await reportFor(newAdapter(), 'clean'));
    assert.deepEqual(first, second);
  });

  it('does not emit source-only subject or inquiry values and does not mutate the body', () => {
    const report = normalizedReport({
      accounts: [account({ accountRef: 'opaque-account' })],
      inquiries: 1,
      subjectRef: SOURCE_CANARY,
    });
    const bodyBefore = report.body;

    const features = extractFeatures(report);

    assert.equal(containsString(features, SOURCE_CANARY), false);
    assert.deepEqual(features.accounts.map((item) => item.accountRef), ['account-1']);
    assert.equal(report.body, bodyBefore);
    assert.equal(
      (report.body as { perBureau: Array<{ subjectRef: string }> }).perBureau[0]?.subjectRef,
      SOURCE_CANARY,
    );
  });

  it('rejects external identifiers before using them as merge keys', () => {
    const overlong = 'x'.repeat(129);
    for (const report of [
      normalizedReport({ accounts: [account({ accountRef: overlong })] }),
      normalizedReport({ accounts: [account({ accountRef: 'bounded' })], subjectRef: overlong }),
    ]) {
      assert.throws(() => extractFeatures(report), { message: 'Feature source unsupported.' });
    }
  });

  it('rejects unknown keys and invalid numeric domains with fixed metadata', () => {
    const invalidBodies = [
      { noHit: true, perBureau: [], extra: SOURCE_CANARY },
      {
        noHit: false,
        perBureau: [{
          bureau: 'EQF',
          reportCode: 'EQF1001',
          pulledAt: CLOCK_INSTANT,
          subjectRef: SOURCE_CANARY,
          accounts: [account({ accountRef: 'opaque-account', balanceCents: -1 })],
          inquiries: [],
          monthlyDebtPaymentsCents: 0,
        }],
      },
    ];

    for (const body of invalidBodies) {
      const report = sealReport({
        bureaus: body.noHit ? [] : ['EQF'],
        reportCodes: ['EQF1001'],
        pulledAt: CLOCK_INSTANT,
        body,
      });
      assert.throws(
        () => extractFeatures(report),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal(error.name, 'FeatureExtractionError');
          assert.equal(error.message, 'Feature source unsupported.');
          assert.equal(error.message.includes(SOURCE_CANARY), false);
          return true;
        },
      );
    }
  });

  it('rejects conflicting repeated account observations', () => {
    const first = account({ accountRef: 'opaque-account', balanceCents: 10_000 });
    const second = account({ accountRef: 'opaque-account', balanceCents: 20_000 });
    const body = {
      noHit: false,
      perBureau: [
        {
          bureau: 'EQF',
          reportCode: 'EQF1001',
          pulledAt: CLOCK_INSTANT,
          subjectRef: 'synthetic-subject',
          accounts: [first],
          inquiries: [],
          monthlyDebtPaymentsCents: 0,
        },
        {
          bureau: 'EXP',
          reportCode: 'EXP1001',
          pulledAt: CLOCK_INSTANT,
          subjectRef: 'synthetic-subject',
          accounts: [second],
          inquiries: [],
          monthlyDebtPaymentsCents: 0,
        },
      ],
    };
    const report = sealReport({
      bureaus: ['EQF', 'EXP'],
      reportCodes: ['EQF1001', 'EXP1001'],
      pulledAt: CLOCK_INSTANT,
      body,
    });

    assert.throws(
      () => extractFeatures(report),
      (error: unknown) => error instanceof Error && error.message === 'Feature source conflict.',
    );
  });

  it('accepts bureau-specific subject ids and uses the highest monthly-debt summary', () => {
    const body = {
      noHit: false,
      perBureau: [
        {
          bureau: 'EQF',
          reportCode: 'EQF1001',
          pulledAt: CLOCK_INSTANT,
          subjectRef: 'efx-subject',
          accounts: [account({ accountRef: 'efx-account' })],
          inquiries: [],
          monthlyDebtPaymentsCents: 20_000,
        },
        {
          bureau: 'EXP',
          reportCode: 'EXP1001',
          pulledAt: CLOCK_INSTANT,
          subjectRef: 'exp-subject',
          accounts: [account({ accountRef: 'exp-account' })],
          inquiries: [],
          monthlyDebtPaymentsCents: 45_000,
        },
        {
          bureau: 'TUC',
          reportCode: 'TUC3002',
          pulledAt: CLOCK_INSTANT,
          subjectRef: 'tu-subject',
          accounts: [account({ accountRef: 'tu-account' })],
          inquiries: [],
          monthlyDebtPaymentsCents: 30_000,
        },
      ],
    };
    const report = sealReport({
      bureaus: ['EQF', 'EXP', 'TUC'],
      reportCodes: ['EQF1001', 'EXP1001', 'TUC3002'],
      pulledAt: CLOCK_INSTANT,
      body,
    });

    const features = extractFeatures(report);

    assert.deepEqual(features.bureausPulled, ['EQF', 'EXP', 'TUC']);
    assert.equal(features.dti.monthlyDebtPaymentsCents, 45_000);
    assert.equal(features.accounts.length, 3);
  });

  it('handles zero limits, unknown ages, and absent stated income without inventing values', () => {
    const features = extractFeatures(normalizedReport({
      accounts: [
        account({ accountRef: 'opaque-zero-limit', balanceCents: 500, limitCents: 0, ageMonths: null }),
      ],
      monthlyDebtPaymentsCents: 250,
    }));

    assert.equal(features.accounts[0]?.utilizationPct, null);
    assert.equal(features.overallUtilizationPct, null);
    assert.equal(features.averageAgeMonths, null);
    assert.deepEqual(features.dti, {
      monthlyDebtPaymentsCents: 250,
      statedMonthlyIncomeCents: null,
      ratioPct: null,
    });
  });

  it('applies every measurable flag at its exact boundary', () => {
    const boundary = extractFeatures(normalizedReport({
      accounts: [
        account({ accountRef: 'a', balanceCents: 30_000, limitCents: 100_000, ageMonths: 24 }),
        account({ accountRef: 'b', kind: 'installment', limitCents: null, ageMonths: 24 }),
        account({ accountRef: 'c', kind: 'other', limitCents: null, ageMonths: 24 }),
        account({ accountRef: 'd', kind: 'revolving', balanceCents: 0, limitCents: 1_000_000, ageMonths: 24 }),
      ],
      inquiries: 2,
    }));

    assert.equal(boundary.flags.utilizationUnder30, true);
    assert.equal(boundary.overallUtilizationPct, 2.7);
    assert.equal(boundary.flags.fourOrMorePersonalAccountsOpen, true);
    assert.equal(boundary.flags.averageAgeTwoYearsOrMore, true);
    assert.equal(boundary.flags.noNegativeItemsReported, true);
    assert.equal(boundary.flags.cardWithTenKLimit, true);
    assert.equal(boundary.flags.twoOrFewerInquiriesEveryBureau, true);
    assert.equal(boundary.flags.thinFile, false);

    const failing = extractFeatures(normalizedReport({
      accounts: [
        account({
          accountRef: 'only',
          balanceCents: 30_000,
          limitCents: 100_000,
          ageMonths: 23.9,
          isNegative: true,
        }),
      ],
      inquiries: 3,
    }));

    assert.equal(failing.flags.utilizationUnder30, false);
    assert.equal(failing.flags.fourOrMorePersonalAccountsOpen, false);
    assert.equal(failing.flags.averageAgeTwoYearsOrMore, false);
    assert.equal(failing.flags.noNegativeItemsReported, false);
    assert.equal(failing.flags.cardWithTenKLimit, false);
    assert.equal(failing.flags.twoOrFewerInquiriesEveryBureau, false);
    assert.equal(failing.flags.thinFile, true);
  });
});
