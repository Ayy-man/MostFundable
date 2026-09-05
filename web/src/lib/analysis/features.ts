import { CRS_BUREAU_CODES, CRS_REPORT_CODE_BY_BUREAU } from '../crs/constants.ts';
import type { BureauCode, SoftPullReport } from '../crs/types.ts';

export interface AccountFeature {
  accountRef: string;
  label?: string | null;
  kind: 'revolving' | 'installment' | 'mortgage' | 'other';
  balanceCents: number;
  limitCents: number | null;
  utilizationPct: number | null;
  ageMonths: number | null;
  pastDueCents?: number;
  lateWithin24Months?: boolean;
  isOpen: boolean;
  isNegative: boolean;
}

/** V1 is retained only for historical stored rows. extractFeatures always emits V2. */
export interface DerivedFeatures {
  schemaVersion: 1 | 2;
  bureausPulled: BureauCode[];
  scores?: { bureau: BureauCode; model: string; score: number }[];
  identity?: {
    namesOnFile: number | null;
    addressesOnFile: number | null;
    employersOnFile: number | null;
  };
  accounts: AccountFeature[];
  overallUtilizationPct: number | null;
  inquiries?: {
    inquiryRef: string;
    bureau: BureauCode;
    monthsAgo: number;
    matchedNewAccountWithin45Days: boolean;
  }[];
  inquiriesByBureau: Record<BureauCode, number>;
  negativesCount: number;
  lateAccountsCount?: number;
  collectionsCount?: number;
  publicRecordsCount?: number;
  openRevolvingCount: number;
  averageAgeMonths: number | null;
  highestRevolvingLimitCents: number | null;
  dti: {
    monthlyDebtPaymentsCents: number;
    statedMonthlyIncomeCents: number | null;
    ratioPct: number | null;
  };
  flags: {
    scoreAtLeast700?: boolean;
    personalInformationConfirmed?: boolean;
    cleanReport?: boolean;
    utilizationUnder30: boolean;
    fourOrMorePersonalAccountsOpen: boolean;
    averageAgeTwoYearsOrMore: boolean;
    noLatePayments?: boolean;
    noNegativeItemsReported?: boolean;
    cardWithTenKLimit: boolean;
    twoOrFewerInquiriesEveryBureau: boolean;
    thinFile: boolean;
  };
  computedAt: string;
}

type AccountKind = AccountFeature['kind'];
type NormalizedAccount = Omit<AccountFeature, 'utilizationPct'>;
type NormalizedInquiry = {
  inquiryRef: string;
  monthsAgo: number;
  reportedAt?: string;
  matchedNewAccountWithin45Days: boolean;
};
type RecordV2 = {
  bureau: BureauCode;
  reportCode: string;
  pulledAt: string;
  subjectRef: string;
  accounts: NormalizedAccount[];
  inquiries: NormalizedInquiry[];
  scores: { bureau: BureauCode; model: string; score: number }[];
  identity: {
    namesOnFile: number | null;
    addressesOnFile: number | null;
    employersOnFile: number | null;
  };
  summaryCounts: {
    totalCollections: number;
    totalPublicRecords: number;
    totalNegativeAccounts: number;
  };
  monthlyDebtPaymentsCents: number;
  v2: boolean;
};

class FeatureExtractionError extends Error {
  readonly code: 'FEATURE_SOURCE_UNSUPPORTED' | 'FEATURE_SOURCE_CONFLICT';

  constructor(code: 'FEATURE_SOURCE_UNSUPPORTED' | 'FEATURE_SOURCE_CONFLICT') {
    super(
      code === 'FEATURE_SOURCE_CONFLICT'
        ? 'Feature source conflict.'
        : 'Feature source unsupported.',
    );
    this.name = 'FeatureExtractionError';
    this.code = code;
  }
}

const BUREAU_SET = new Set<BureauCode>(CRS_BUREAU_CODES);
const KINDS = new Set<AccountKind>(['revolving', 'installment', 'mortgage', 'other']);
const V1_RECORD = [
  'bureau',
  'reportCode',
  'pulledAt',
  'subjectRef',
  'accounts',
  'inquiries',
  'monthlyDebtPaymentsCents',
];
const V2_RECORD = [...V1_RECORD, 'scores', 'identity', 'summaryCounts'];
const V1_ACCOUNT = [
  'accountRef',
  'kind',
  'balanceCents',
  'limitCents',
  'ageMonths',
  'isOpen',
  'isNegative',
];
const V2_ACCOUNT = [...V1_ACCOUNT, 'label', 'pastDueCents', 'lateWithin24Months'];
const V1_INQUIRY = ['inquiryRef', 'monthsAgo'];
const V2_INQUIRY = [...V1_INQUIRY, 'reportedAt', 'matchedNewAccountWithin45Days'];

function unsupported(): never {
  throw new FeatureExtractionError('FEATURE_SOURCE_UNSUPPORTED');
}

function conflict(): never {
  throw new FeatureExtractionError('FEATURE_SOURCE_CONFLICT');
}

function record(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function exact(v: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(v).sort();
  const expected = [...keys].sort();

  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function int(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

function number(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

function identifier(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    v.length > 0 &&
    v.length <= 128 &&
    !/[\u0000-\u001f\u007f]/.test(v)
  );
}

function instant(v: unknown): v is string {
  return typeof v === 'string' && Number.isFinite(Date.parse(v));
}

function hasValidAccountValues(v: Record<string, unknown>, isV2: boolean): boolean {
  return (
    identifier(v.accountRef) &&
    typeof v.kind === 'string' &&
    KINDS.has(v.kind as AccountKind) &&
    int(v.balanceCents) &&
    (v.limitCents === null || int(v.limitCents)) &&
    (v.ageMonths === null || number(v.ageMonths)) &&
    typeof v.isOpen === 'boolean' &&
    typeof v.isNegative === 'boolean' &&
    (!isV2 || v.label === null || (typeof v.label === 'string' && v.label.length <= 64)) &&
    (!isV2 || int(v.pastDueCents)) &&
    (!isV2 || typeof v.lateWithin24Months === 'boolean')
  );
}

function parseAccount(v: unknown): NormalizedAccount {
  if (!record(v) || (!exact(v, V1_ACCOUNT) && !exact(v, V2_ACCOUNT))) {
    unsupported();
  }

  const isV2 = exact(v, V2_ACCOUNT);

  if (!hasValidAccountValues(v, isV2)) {
    unsupported();
  }

  return {
    accountRef: v.accountRef as string,
    kind: v.kind as AccountKind,
    balanceCents: v.balanceCents as number,
    limitCents: v.limitCents as number | null,
    ageMonths: v.ageMonths as number | null,
    label: isV2 ? (v.label as string | null) : null,
    pastDueCents: isV2 ? (v.pastDueCents as number) : 0,
    lateWithin24Months: isV2 ? (v.lateWithin24Months as boolean) : false,
    isOpen: v.isOpen as boolean,
    isNegative: v.isNegative as boolean,
  };
}

function parseInquiry(item: unknown, refs: Set<string>): NormalizedInquiry {
  if (
    !record(item) ||
    (!exact(item, V1_INQUIRY) && !exact(item, V2_INQUIRY)) ||
    !identifier(item.inquiryRef) ||
    !number(item.monthsAgo) ||
    refs.has(item.inquiryRef)
  ) {
    return unsupported();
  }

  refs.add(item.inquiryRef);
  const isV2 = exact(item, V2_INQUIRY);

  if (
    isV2 &&
    (!instant(item.reportedAt) || typeof item.matchedNewAccountWithin45Days !== 'boolean')
  ) {
    return unsupported();
  }

  return {
    inquiryRef: item.inquiryRef,
    monthsAgo: item.monthsAgo,
    ...(isV2 ? { reportedAt: item.reportedAt as string } : {}),
    matchedNewAccountWithin45Days: isV2
      ? (item.matchedNewAccountWithin45Days as boolean)
      : false,
  };
}

function parseInquiries(v: unknown): NormalizedInquiry[] {
  if (!Array.isArray(v)) {
    unsupported();
  }

  const refs = new Set<string>();

  return v.map((item) => parseInquiry(item, refs));
}

function parseScore(item: unknown): RecordV2['scores'][number] {
  if (
    !record(item) ||
    !exact(item, ['bureau', 'model', 'score']) ||
    typeof item.bureau !== 'string' ||
    !BUREAU_SET.has(item.bureau as BureauCode) ||
    typeof item.model !== 'string' ||
    item.model.length < 1 ||
    item.model.length > 64 ||
    typeof item.score !== 'number' ||
    !Number.isInteger(item.score) ||
    item.score < 300 ||
    item.score > 850
  ) {
    return unsupported();
  }

  return {
    bureau: item.bureau as BureauCode,
    model: item.model,
    score: item.score,
  };
}

function parseScores(v: unknown): RecordV2['scores'] {
  if (!Array.isArray(v)) {
    unsupported();
  }

  return v.map(parseScore);
}

function parseIdentity(v: unknown): RecordV2['identity'] {
  if (!record(v) || !exact(v, ['namesOnFile', 'addressesOnFile', 'employersOnFile'])) {
    unsupported();
  }

  for (const key of ['namesOnFile', 'addressesOnFile', 'employersOnFile'] as const) {
    if (!(v[key] === null || int(v[key]))) {
      unsupported();
    }
  }

  return v as RecordV2['identity'];
}

function parseCounts(v: unknown): RecordV2['summaryCounts'] {
  if (
    !record(v) ||
    !exact(v, ['totalCollections', 'totalPublicRecords', 'totalNegativeAccounts']) ||
    !int(v.totalCollections) ||
    !int(v.totalPublicRecords) ||
    !int(v.totalNegativeAccounts)
  ) {
    unsupported();
  }

  return v as RecordV2['summaryCounts'];
}

function parseRecord(item: unknown): RecordV2 {
  if (
    !record(item) ||
    (!exact(item, V1_RECORD) && !exact(item, V2_RECORD)) ||
    typeof item.bureau !== 'string' ||
    !BUREAU_SET.has(item.bureau as BureauCode) ||
    item.reportCode !== CRS_REPORT_CODE_BY_BUREAU[item.bureau as BureauCode] ||
    !instant(item.pulledAt) ||
    !identifier(item.subjectRef) ||
    !int(item.monthlyDebtPaymentsCents) ||
    !Array.isArray(item.accounts)
  ) {
    return unsupported();
  }

  const isV2 = exact(item, V2_RECORD);

  return {
    bureau: item.bureau as BureauCode,
    reportCode: item.reportCode as string,
    pulledAt: item.pulledAt,
    subjectRef: item.subjectRef,
    accounts: item.accounts.map(parseAccount),
    inquiries: parseInquiries(item.inquiries),
    scores: isV2 ? parseScores(item.scores) : [],
    identity: isV2
      ? parseIdentity(item.identity)
      : { namesOnFile: null, addressesOnFile: null, employersOnFile: null },
    summaryCounts: isV2
      ? parseCounts(item.summaryCounts)
      : { totalCollections: 0, totalPublicRecords: 0, totalNegativeAccounts: 0 },
    monthlyDebtPaymentsCents: item.monthlyDebtPaymentsCents,
    v2: isV2,
  };
}

function parseBody(v: unknown): { noHit: boolean; perBureau: RecordV2[] } {
  if (
    !record(v) ||
    !exact(v, ['noHit', 'perBureau']) ||
    typeof v.noHit !== 'boolean' ||
    !Array.isArray(v.perBureau)
  ) {
    unsupported();
  }

  const perBureau = v.perBureau.map(parseRecord);

  if (v.noHit !== (perBureau.length === 0)) {
    unsupported();
  }

  return { noHit: v.noHit, perBureau };
}

function same(a: NormalizedAccount, b: NormalizedAccount): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function pct(n: number, d: number): number | null {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : null;
}

function toFeature(a: NormalizedAccount, accountRef: string): AccountFeature {
  return {
    ...a,
    accountRef,
    utilizationPct: a.limitCents !== null && a.limitCents > 0 ? pct(a.balanceCents, a.limitCents) : null,
  };
}

function collectRecords(
  perBureau: RecordV2[],
  report: SoftPullReport,
): { records: Map<BureauCode, RecordV2>; raw: Map<string, NormalizedAccount>; debt: number } {
  const records = new Map<BureauCode, RecordV2>();
  const raw = new Map<string, NormalizedAccount>();
  let debt = 0;

  for (const item of perBureau) {
    if (
      records.has(item.bureau) ||
      item.pulledAt !== report.pulledAt ||
      !report.reportCodes.includes(item.reportCode as never)
    ) {
      conflict();
    }

    records.set(item.bureau, item);
    debt = Math.max(debt, item.monthlyDebtPaymentsCents);

    for (const account of item.accounts) {
      const prior = raw.get(account.accountRef);

      if (prior !== undefined && !same(prior, account)) {
        conflict();
      }

      if (prior === undefined) {
        raw.set(account.accountRef, account);
      }
    }
  }

  return { records, raw, debt };
}

function ensureRequestedBureaus(
  report: SoftPullReport,
  records: Map<BureauCode, RecordV2>,
): void {
  const requested = new Set(report.bureaus);

  if (
    requested.size !== report.bureaus.length ||
    requested.size !== records.size ||
    [...requested].some((bureau) => !records.has(bureau))
  ) {
    conflict();
  }
}

export function extractFeatures(report: SoftPullReport): DerivedFeatures {
  const body = parseBody(report.body);

  if (!instant(report.pulledAt)) {
    unsupported();
  }

  if (body.noHit) {
    if (report.bureaus.length !== 0) {
      unsupported();
    }

    return build([], new Map(), report.pulledAt, 0);
  }

  const { records, raw, debt } = collectRecords(body.perBureau, report);

  ensureRequestedBureaus(report, records);

  return build([...raw.values()], records, report.pulledAt, debt);
}

function accountFeatures(raw: NormalizedAccount[]): AccountFeature[] {
  return raw
    .sort((a, b) => a.accountRef.localeCompare(b.accountRef))
    .map((account, index) => toFeature(account, `account-${index + 1}`));
}

function limitedRevolvingAccounts(accounts: AccountFeature[]): Array<AccountFeature & { limitCents: number }> {
  return accounts.filter(
    (account): account is AccountFeature & { limitCents: number } =>
      account.isOpen &&
      account.kind === 'revolving' &&
      account.limitCents !== null &&
      account.limitCents > 0,
  );
}

function utilizationPct(accounts: Array<AccountFeature & { limitCents: number }>): number | null {
  const balances = accounts.reduce((total, account) => total + account.balanceCents, 0);
  const limits = accounts.reduce((total, account) => total + account.limitCents, 0);

  return pct(balances, limits);
}

function averageAccountAge(accounts: AccountFeature[]): number | null {
  const ages = accounts.flatMap((account) => (account.ageMonths === null ? [] : [account.ageMonths]));

  if (ages.length === 0) {
    return null;
  }

  return Math.round((ages.reduce((a, b) => a + b, 0) / ages.length) * 10) / 10;
}

function revolvingLimits(accounts: AccountFeature[]): number[] {
  return accounts.flatMap((account) =>
    account.kind === 'revolving' && account.limitCents !== null ? [account.limitCents] : [],
  );
}

function countInquiriesByBureau(records: Map<BureauCode, RecordV2>): Record<BureauCode, number> {
  return {
    EQF: records.get('EQF')?.inquiries.length ?? 0,
    EXP: records.get('EXP')?.inquiries.length ?? 0,
    TUC: records.get('TUC')?.inquiries.length ?? 0,
  };
}

function featureInquiries(records: Map<BureauCode, RecordV2>): NonNullable<DerivedFeatures['inquiries']> {
  return CRS_BUREAU_CODES.flatMap((bureau) => {
    return (records.get(bureau)?.inquiries ?? []).map((item, index) => ({
      inquiryRef: `${bureau.toLowerCase()}-inquiry-${index + 1}`,
      bureau,
      monthsAgo: item.monthsAgo,
      matchedNewAccountWithin45Days: item.matchedNewAccountWithin45Days,
    }));
  });
}

function maximumIdentityValue(
  values: RecordV2[],
  hasV2: boolean,
  field: keyof RecordV2['identity'],
): number | null {
  if (values.length === 0 || !hasV2) {
    return null;
  }

  return Math.max(...values.map((item) => item.identity[field] ?? 0));
}

function featureIdentity(values: RecordV2[], hasV2: boolean): NonNullable<DerivedFeatures['identity']> {
  return {
    namesOnFile: maximumIdentityValue(values, hasV2, 'namesOnFile'),
    addressesOnFile: maximumIdentityValue(values, hasV2, 'addressesOnFile'),
    employersOnFile: maximumIdentityValue(values, hasV2, 'employersOnFile'),
  };
}

function v2Flags(
  hasV2: boolean,
  lowestScore: number | null,
  identity: NonNullable<DerivedFeatures['identity']>,
  lateAccountsCount: number,
  negativesCount: number,
  collectionsCount: number,
  publicRecordsCount: number,
): Pick<
  NonNullable<DerivedFeatures['flags']>,
  'scoreAtLeast700' | 'cleanReport' | 'noLatePayments' | 'noNegativeItemsReported'
> {
  if (!hasV2) {
    return {};
  }

  return {
    scoreAtLeast700: lowestScore !== null && lowestScore >= 700,
    cleanReport:
      identity.employersOnFile === 0 &&
      identity.addressesOnFile !== null &&
      identity.addressesOnFile <= 1,
    noLatePayments: lateAccountsCount === 0,
    noNegativeItemsReported: negativesCount + collectionsCount + publicRecordsCount === 0,
  };
}

function build(
  raw: NormalizedAccount[],
  records: Map<BureauCode, RecordV2>,
  computedAt: string,
  monthlyDebtPaymentsCents: number,
): DerivedFeatures {
  const accounts = accountFeatures(raw);
  const openRevolving = accounts.filter((account) => account.isOpen && account.kind === 'revolving');
  const limited = limitedRevolvingAccounts(accounts);
  const overallUtilizationPct = utilizationPct(limited);
  const averageAgeMonths = averageAccountAge(accounts);
  const limits = revolvingLimits(accounts);
  const inquiriesByBureau = countInquiriesByBureau(records);
  const inquiries = featureInquiries(records);
  const scores = CRS_BUREAU_CODES.flatMap((bureau) => records.get(bureau)?.scores ?? []);
  const values = [...records.values()];
  const hasV2 = values.length === 0 || values.every((item) => item.v2);
  const identity = featureIdentity(values, hasV2);
  const collectionsCount = Math.max(0, ...values.map((record) => record.summaryCounts.totalCollections));
  const publicRecordsCount = Math.max(
    0,
    ...values.map((record) => record.summaryCounts.totalPublicRecords),
  );
  const negativesCount = accounts.filter((account) => account.isNegative).length;
  const lateAccountsCount = accounts.filter((account) => account.lateWithin24Months).length;
  const openAccountsCount = accounts.filter((account) => account.isOpen).length;
  const lowestScore = scores.length === 0 ? null : Math.min(...scores.map((score) => score.score));

  return {
    schemaVersion: 2,
    bureausPulled: CRS_BUREAU_CODES.filter((bureau) => records.has(bureau)),
    scores,
    identity,
    accounts,
    overallUtilizationPct,
    inquiries,
    inquiriesByBureau,
    negativesCount,
    lateAccountsCount,
    collectionsCount,
    publicRecordsCount,
    openRevolvingCount: openRevolving.length,
    averageAgeMonths,
    highestRevolvingLimitCents: limits.length === 0 ? null : Math.max(...limits),
    dti: {
      monthlyDebtPaymentsCents,
      statedMonthlyIncomeCents: null,
      ratioPct: null,
    },
    flags: {
      ...v2Flags(
        hasV2,
        lowestScore,
        identity,
        lateAccountsCount,
        negativesCount,
        collectionsCount,
        publicRecordsCount,
      ),
      personalInformationConfirmed: false,
      utilizationUnder30:
        limited.length > 0 && limited.every((account) => (account.utilizationPct ?? 100) < 30),
      fourOrMorePersonalAccountsOpen: openAccountsCount >= 4,
      averageAgeTwoYearsOrMore: averageAgeMonths !== null && averageAgeMonths >= 24,
      cardWithTenKLimit: limits.some((limit) => limit >= 1_000_000),
      twoOrFewerInquiriesEveryBureau: CRS_BUREAU_CODES.every(
        (bureau) => inquiriesByBureau[bureau] <= 2,
      ),
      thinFile: openAccountsCount < 4,
    },
    computedAt,
  };
}
