import { CRS_BUREAU_CODES, CRS_REPORT_CODE_BY_BUREAU } from '../crs/constants.ts';

import type { BureauCode, SoftPullReport } from '../crs/types.ts';

export interface AccountFeature {
  /** Opaque, stable within one analysis run only. Never a real account number. */
  accountRef: string;
  kind: 'revolving' | 'installment' | 'mortgage' | 'other';
  balanceCents: number;
  limitCents: number | null;
  utilizationPct: number | null;
  ageMonths: number | null;
  isOpen: boolean;
  isNegative: boolean;
}

export interface DerivedFeatures {
  schemaVersion: 1;
  bureausPulled: BureauCode[];
  accounts: AccountFeature[];
  overallUtilizationPct: number | null;
  inquiriesByBureau: Record<BureauCode, number>;
  negativesCount: number;
  openRevolvingCount: number;
  averageAgeMonths: number | null;
  highestRevolvingLimitCents: number | null;
  dti: {
    monthlyDebtPaymentsCents: number;
    /** consumer-stated, not bureau-derived; null until collected */
    statedMonthlyIncomeCents: number | null;
    ratioPct: number | null;
  };
  /** Readiness states, one per §4 personal-credit factor. Never phrased as an action. */
  flags: {
    utilizationUnder30: boolean;
    fourOrMorePersonalAccountsOpen: boolean;
    averageAgeTwoYearsOrMore: boolean;
    noNegativeItemsReported: boolean;
    cardWithTenKLimit: boolean;
    twoOrFewerInquiriesEveryBureau: boolean;
    thinFile: boolean;
  };
  computedAt: string;
}

type AccountKind = AccountFeature['kind'];

interface NormalizedAccount {
  accountRef: string;
  kind: AccountKind;
  balanceCents: number;
  limitCents: number | null;
  ageMonths: number | null;
  isOpen: boolean;
  isNegative: boolean;
}

interface NormalizedBureauRecord {
  bureau: BureauCode;
  reportCode: string;
  pulledAt: string;
  subjectRef: string;
  accounts: NormalizedAccount[];
  inquiryCount: number;
  monthlyDebtPaymentsCents: number;
}

interface NormalizedBody {
  noHit: boolean;
  perBureau: NormalizedBureauRecord[];
}

type FeatureExtractionCode =
  | 'FEATURE_SOURCE_UNSUPPORTED'
  | 'FEATURE_SOURCE_CONFLICT';

class FeatureExtractionError extends Error {
  readonly code: FeatureExtractionCode;

  constructor(code: FeatureExtractionCode) {
    super(code === 'FEATURE_SOURCE_CONFLICT' ? 'Feature source conflict.' : 'Feature source unsupported.');
    this.name = 'FeatureExtractionError';
    this.code = code;
  }
}

const BODY_KEYS = ['noHit', 'perBureau'] as const;
const BUREAU_RECORD_KEYS = [
  'bureau',
  'reportCode',
  'pulledAt',
  'subjectRef',
  'accounts',
  'inquiries',
  'monthlyDebtPaymentsCents',
] as const;
const ACCOUNT_KEYS = [
  'accountRef',
  'kind',
  'balanceCents',
  'limitCents',
  'ageMonths',
  'isOpen',
  'isNegative',
] as const;
const INQUIRY_KEYS = ['inquiryRef', 'monthsAgo'] as const;
const ACCOUNT_KINDS = new Set<AccountKind>(['revolving', 'installment', 'mortgage', 'other']);
const BUREAU_SET = new Set<BureauCode>(CRS_BUREAU_CODES);

function unsupported(): never {
  throw new FeatureExtractionError('FEATURE_SOURCE_UNSUPPORTED');
}

function conflict(): never {
  throw new FeatureExtractionError('FEATURE_SOURCE_CONFLICT');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

function finiteNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function finiteNonnegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function boundedExternalIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value);
}

function isoInstant(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function parseAccount(value: unknown): NormalizedAccount {
  if (!isRecord(value) || !hasExactKeys(value, ACCOUNT_KEYS)) unsupported();

  const kind = value.kind;
  if (
    !boundedExternalIdentifier(value.accountRef) ||
    typeof kind !== 'string' ||
    !ACCOUNT_KINDS.has(kind as AccountKind) ||
    !finiteNonnegativeInteger(value.balanceCents) ||
    !(value.limitCents === null || finiteNonnegativeInteger(value.limitCents)) ||
    !(value.ageMonths === null || finiteNonnegativeNumber(value.ageMonths)) ||
    typeof value.isOpen !== 'boolean' ||
    typeof value.isNegative !== 'boolean'
  ) {
    unsupported();
  }

  return {
    accountRef: value.accountRef,
    kind: kind as AccountKind,
    balanceCents: value.balanceCents,
    limitCents: value.limitCents,
    ageMonths: value.ageMonths,
    isOpen: value.isOpen,
    isNegative: value.isNegative,
  };
}

function parseInquiryCount(value: unknown): number {
  if (!Array.isArray(value)) unsupported();

  const refs = new Set<string>();
  for (const item of value) {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, INQUIRY_KEYS) ||
      !boundedExternalIdentifier(item.inquiryRef) ||
      !finiteNonnegativeNumber(item.monthsAgo) ||
      refs.has(item.inquiryRef)
    ) {
      unsupported();
    }
    refs.add(item.inquiryRef);
  }
  return refs.size;
}

function parseBureauRecord(value: unknown): NormalizedBureauRecord {
  if (!isRecord(value) || !hasExactKeys(value, BUREAU_RECORD_KEYS)) unsupported();

  const bureau = value.bureau;
  if (
    typeof bureau !== 'string' ||
    !BUREAU_SET.has(bureau as BureauCode) ||
    value.reportCode !== CRS_REPORT_CODE_BY_BUREAU[bureau as BureauCode] ||
    !isoInstant(value.pulledAt) ||
    !boundedExternalIdentifier(value.subjectRef) ||
    !Array.isArray(value.accounts) ||
    !finiteNonnegativeInteger(value.monthlyDebtPaymentsCents)
  ) {
    unsupported();
  }

  return {
    bureau: bureau as BureauCode,
    reportCode: value.reportCode as string,
    pulledAt: value.pulledAt,
    subjectRef: value.subjectRef,
    accounts: value.accounts.map(parseAccount),
    inquiryCount: parseInquiryCount(value.inquiries),
    monthlyDebtPaymentsCents: value.monthlyDebtPaymentsCents,
  };
}

function parseBody(value: unknown): NormalizedBody {
  if (!isRecord(value) || !hasExactKeys(value, BODY_KEYS) || typeof value.noHit !== 'boolean' || !Array.isArray(value.perBureau)) {
    unsupported();
  }

  const perBureau = value.perBureau.map(parseBureauRecord);
  if (value.noHit !== (perBureau.length === 0)) unsupported();

  return { noHit: value.noHit, perBureau };
}

function sameAccount(left: NormalizedAccount, right: NormalizedAccount): boolean {
  return (
    left.accountRef === right.accountRef &&
    left.kind === right.kind &&
    left.balanceCents === right.balanceCents &&
    left.limitCents === right.limitCents &&
    left.ageMonths === right.ageMonths &&
    left.isOpen === right.isOpen &&
    left.isNegative === right.isNegative
  );
}

function roundedPercentage(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function accountFeature(account: NormalizedAccount, accountRef: string): AccountFeature {
  return {
    accountRef,
    kind: account.kind,
    balanceCents: account.balanceCents,
    limitCents: account.limitCents,
    utilizationPct:
      account.limitCents !== null && account.limitCents > 0
        ? roundedPercentage(account.balanceCents, account.limitCents)
        : null,
    ageMonths: account.ageMonths,
    isOpen: account.isOpen,
    isNegative: account.isNegative,
  };
}

export function extractFeatures(report: SoftPullReport): DerivedFeatures {
  const normalized = parseBody(report.body);
  if (!isoInstant(report.pulledAt)) unsupported();

  if (normalized.noHit) {
    if (report.bureaus.length !== 0) unsupported();
    return {
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
      computedAt: report.pulledAt,
    };
  }

  const recordByBureau = new Map<BureauCode, NormalizedBureauRecord>();
  const accountByRef = new Map<string, NormalizedAccount>();
  let monthlyDebtPaymentsCents = 0;

  for (const record of normalized.perBureau) {
    if (recordByBureau.has(record.bureau)) conflict();
    if (record.pulledAt !== report.pulledAt) conflict();
    if (!report.reportCodes.includes(record.reportCode as never)) conflict();

    // EFX 3B is three provider views, so each bureau has its own opaque subject identifier and its
    // own summary totals. Neither is supposed to agree across views. The subject identifier exits
    // nowhere; for monthly debt use the highest bureau total, which is conservative without
    // blindly summing bureau totals that can overlap.
    monthlyDebtPaymentsCents = Math.max(
      monthlyDebtPaymentsCents,
      record.monthlyDebtPaymentsCents,
    );
    recordByBureau.set(record.bureau, record);

    for (const account of record.accounts) {
      const existing = accountByRef.get(account.accountRef);
      if (existing !== undefined && !sameAccount(existing, account)) conflict();
      if (existing === undefined) accountByRef.set(account.accountRef, account);
    }
  }

  const reportedBureaus = new Set(report.bureaus);
  if (
    reportedBureaus.size !== report.bureaus.length ||
    reportedBureaus.size !== recordByBureau.size ||
    [...reportedBureaus].some((bureau) => !recordByBureau.has(bureau))
  ) {
    conflict();
  }

  const bureausPulled = CRS_BUREAU_CODES.filter((bureau) => recordByBureau.has(bureau));
  const accounts = [...accountByRef.values()]
    .sort((left, right) => left.accountRef < right.accountRef ? -1 : left.accountRef > right.accountRef ? 1 : 0)
    .map((account, index) => accountFeature(account, `account-${index + 1}`));
  const openRevolving = accounts.filter((account) => account.isOpen && account.kind === 'revolving');
  const revolvingWithLimits = openRevolving.filter(
    (account): account is AccountFeature & { limitCents: number } =>
      account.limitCents !== null && account.limitCents > 0,
  );
  const totalRevolvingBalance = revolvingWithLimits.reduce(
    (total, account) => total + account.balanceCents,
    0,
  );
  const totalRevolvingLimit = revolvingWithLimits.reduce(
    (total, account) => total + account.limitCents,
    0,
  );
  const overallUtilizationPct = roundedPercentage(totalRevolvingBalance, totalRevolvingLimit);
  const knownAges = accounts.flatMap((account) => account.ageMonths === null ? [] : [account.ageMonths]);
  const averageAgeMonths = knownAges.length === 0
    ? null
    : Math.round((knownAges.reduce((total, age) => total + age, 0) / knownAges.length) * 10) / 10;
  const revolvingLimits = accounts.flatMap((account) =>
    account.kind === 'revolving' && account.limitCents !== null ? [account.limitCents] : [],
  );
  const highestRevolvingLimitCents = revolvingLimits.length === 0
    ? null
    : Math.max(...revolvingLimits);
  const inquiriesByBureau: Record<BureauCode, number> = {
    EQF: recordByBureau.get('EQF')?.inquiryCount ?? 0,
    EXP: recordByBureau.get('EXP')?.inquiryCount ?? 0,
    TUC: recordByBureau.get('TUC')?.inquiryCount ?? 0,
  };
  const negativesCount = accounts.filter((account) => account.isNegative).length;
  const openAccountsCount = accounts.filter((account) => account.isOpen).length;

  return {
    schemaVersion: 1,
    bureausPulled,
    accounts,
    overallUtilizationPct,
    inquiriesByBureau,
    negativesCount,
    openRevolvingCount: openRevolving.length,
    averageAgeMonths,
    highestRevolvingLimitCents,
    dti: {
      monthlyDebtPaymentsCents,
      statedMonthlyIncomeCents: null,
      ratioPct: null,
    },
    flags: {
      utilizationUnder30: overallUtilizationPct !== null && overallUtilizationPct < 30,
      fourOrMorePersonalAccountsOpen: openAccountsCount >= 4,
      averageAgeTwoYearsOrMore: averageAgeMonths !== null && averageAgeMonths >= 24,
      noNegativeItemsReported: negativesCount === 0,
      cardWithTenKLimit:
        highestRevolvingLimitCents !== null && highestRevolvingLimitCents >= 1_000_000,
      twoOrFewerInquiriesEveryBureau: CRS_BUREAU_CODES.every(
        (bureau) => inquiriesByBureau[bureau] <= 2,
      ),
      thinFile: openAccountsCount < 4,
    },
    computedAt: report.pulledAt,
  };
}
