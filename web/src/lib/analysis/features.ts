import { CRS_BUREAU_CODES, CRS_REPORT_CODE_BY_BUREAU } from '../crs/constants.ts';
import type { BureauCode, SoftPullReport } from '../crs/types.ts';

export interface AccountFeature {
  accountRef: string; label?: string | null; kind: 'revolving' | 'installment' | 'mortgage' | 'other';
  balanceCents: number; limitCents: number | null; utilizationPct: number | null; ageMonths: number | null;
  pastDueCents?: number; lateWithin24Months?: boolean; isOpen: boolean; isNegative: boolean;
}
/** V1 is retained only for historical stored rows. extractFeatures always emits V2. */
export interface DerivedFeatures {
  schemaVersion: 1 | 2; bureausPulled: BureauCode[];
  scores?: { bureau: BureauCode; model: string; score: number }[];
  identity?: { namesOnFile: number | null; addressesOnFile: number | null; employersOnFile: number | null };
  accounts: AccountFeature[]; overallUtilizationPct: number | null;
  inquiries?: { inquiryRef: string; bureau: BureauCode; monthsAgo: number; matchedNewAccountWithin45Days: boolean }[];
  inquiriesByBureau: Record<BureauCode, number>; negativesCount: number; lateAccountsCount?: number;
  collectionsCount?: number; publicRecordsCount?: number; openRevolvingCount: number;
  averageAgeMonths: number | null; highestRevolvingLimitCents: number | null;
  dti: { monthlyDebtPaymentsCents: number; statedMonthlyIncomeCents: number | null; ratioPct: number | null };
  flags: {
    scoreAtLeast700?: boolean; personalInformationConfirmed?: boolean; cleanReport?: boolean;
    utilizationUnder30: boolean; fourOrMorePersonalAccountsOpen: boolean; averageAgeTwoYearsOrMore: boolean;
    noLatePayments?: boolean; noNegativeItemsReported: boolean; cardWithTenKLimit: boolean;
    twoOrFewerInquiriesEveryBureau: boolean; thinFile: boolean;
  };
  computedAt: string;
}
type AccountKind = AccountFeature['kind'];
type NormalizedAccount = Omit<AccountFeature, 'utilizationPct'>;
type NormalizedInquiry = { inquiryRef: string; monthsAgo: number; reportedAt?: string; matchedNewAccountWithin45Days: boolean };
type RecordV2 = { bureau: BureauCode; reportCode: string; pulledAt: string; subjectRef: string; accounts: NormalizedAccount[]; inquiries: NormalizedInquiry[]; scores: { bureau: BureauCode; model: string; score: number }[]; identity: { namesOnFile: number | null; addressesOnFile: number | null; employersOnFile: number | null }; summaryCounts: { totalCollections: number; totalPublicRecords: number; totalNegativeAccounts: number }; monthlyDebtPaymentsCents: number; v2: boolean };
class FeatureExtractionError extends Error { readonly code: 'FEATURE_SOURCE_UNSUPPORTED' | 'FEATURE_SOURCE_CONFLICT'; constructor(code: 'FEATURE_SOURCE_UNSUPPORTED' | 'FEATURE_SOURCE_CONFLICT') { super(code === 'FEATURE_SOURCE_CONFLICT' ? 'Feature source conflict.' : 'Feature source unsupported.'); this.name = 'FeatureExtractionError'; this.code = code; } }
const BUREAU_SET = new Set<BureauCode>(CRS_BUREAU_CODES);
const KINDS = new Set<AccountKind>(['revolving', 'installment', 'mortgage', 'other']);
const V1_RECORD = ['bureau', 'reportCode', 'pulledAt', 'subjectRef', 'accounts', 'inquiries', 'monthlyDebtPaymentsCents'];
const V2_RECORD = [...V1_RECORD, 'scores', 'identity', 'summaryCounts'];
const V1_ACCOUNT = ['accountRef', 'kind', 'balanceCents', 'limitCents', 'ageMonths', 'isOpen', 'isNegative'];
const V2_ACCOUNT = [...V1_ACCOUNT, 'label', 'pastDueCents', 'lateWithin24Months'];
const V1_INQUIRY = ['inquiryRef', 'monthsAgo']; const V2_INQUIRY = [...V1_INQUIRY, 'reportedAt', 'matchedNewAccountWithin45Days'];
function unsupported(): never { throw new FeatureExtractionError('FEATURE_SOURCE_UNSUPPORTED'); }
function conflict(): never { throw new FeatureExtractionError('FEATURE_SOURCE_CONFLICT'); }
function record(v: unknown): v is Record<string, unknown> { return typeof v === 'object' && v !== null && !Array.isArray(v); }
function exact(v: Record<string, unknown>, keys: readonly string[]): boolean { const a = Object.keys(v).sort(); const e = [...keys].sort(); return a.length === e.length && a.every((x, i) => x === e[i]); }
function int(v: unknown): v is number { return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0; }
function number(v: unknown): v is number { return typeof v === 'number' && Number.isFinite(v) && v >= 0; }
function identifier(v: unknown): v is string { return typeof v === 'string' && v.length > 0 && v.length <= 128 && !/[\u0000-\u001f\u007f]/.test(v); }
function instant(v: unknown): v is string { return typeof v === 'string' && Number.isFinite(Date.parse(v)); }
function parseAccount(v: unknown): NormalizedAccount {
  if (!record(v) || (!exact(v, V1_ACCOUNT) && !exact(v, V2_ACCOUNT))) unsupported(); const isV2 = exact(v, V2_ACCOUNT);
  if (!identifier(v.accountRef) || typeof v.kind !== 'string' || !KINDS.has(v.kind as AccountKind) || !int(v.balanceCents) || !(v.limitCents === null || int(v.limitCents)) || !(v.ageMonths === null || number(v.ageMonths)) || typeof v.isOpen !== 'boolean' || typeof v.isNegative !== 'boolean' || (isV2 && !(v.label === null || (typeof v.label === 'string' && v.label.length <= 64))) || (isV2 && !int(v.pastDueCents)) || (isV2 && typeof v.lateWithin24Months !== 'boolean')) unsupported();
  return { accountRef: v.accountRef, kind: v.kind as AccountKind, balanceCents: v.balanceCents, limitCents: v.limitCents, ageMonths: v.ageMonths, label: isV2 ? v.label as string | null : null, pastDueCents: isV2 ? v.pastDueCents as number : 0, lateWithin24Months: isV2 ? v.lateWithin24Months as boolean : false, isOpen: v.isOpen, isNegative: v.isNegative };
}
function parseInquiries(v: unknown): NormalizedInquiry[] {
  if (!Array.isArray(v)) unsupported(); const refs = new Set<string>();
  return v.map((item) => { if (!record(item) || (!exact(item, V1_INQUIRY) && !exact(item, V2_INQUIRY)) || !identifier(item.inquiryRef) || !number(item.monthsAgo) || refs.has(item.inquiryRef)) unsupported(); refs.add(item.inquiryRef); const isV2 = exact(item, V2_INQUIRY); if (isV2 && (!instant(item.reportedAt) || typeof item.matchedNewAccountWithin45Days !== 'boolean')) unsupported(); return { inquiryRef: item.inquiryRef, monthsAgo: item.monthsAgo, ...(isV2 ? { reportedAt: item.reportedAt as string } : {}), matchedNewAccountWithin45Days: isV2 ? item.matchedNewAccountWithin45Days as boolean : false }; });
}
function parseScores(v: unknown): RecordV2['scores'] { if (!Array.isArray(v)) unsupported(); return v.map((item) => { if (!record(item) || !exact(item, ['bureau', 'model', 'score']) || typeof item.bureau !== 'string' || !BUREAU_SET.has(item.bureau as BureauCode) || typeof item.model !== 'string' || item.model.length < 1 || item.model.length > 64 || typeof item.score !== 'number' || !Number.isInteger(item.score) || item.score < 300 || item.score > 850) unsupported(); return { bureau: item.bureau as BureauCode, model: item.model, score: item.score }; }); }
function parseIdentity(v: unknown): RecordV2['identity'] { if (!record(v) || !exact(v, ['namesOnFile', 'addressesOnFile', 'employersOnFile'])) unsupported(); for (const key of ['namesOnFile', 'addressesOnFile', 'employersOnFile'] as const) if (!(v[key] === null || int(v[key]))) unsupported(); return v as RecordV2['identity']; }
function parseCounts(v: unknown): RecordV2['summaryCounts'] { if (!record(v) || !exact(v, ['totalCollections', 'totalPublicRecords', 'totalNegativeAccounts']) || !int(v.totalCollections) || !int(v.totalPublicRecords) || !int(v.totalNegativeAccounts)) unsupported(); return v as RecordV2['summaryCounts']; }
function parseBody(v: unknown): { noHit: boolean; perBureau: RecordV2[] } {
  if (!record(v) || !exact(v, ['noHit', 'perBureau']) || typeof v.noHit !== 'boolean' || !Array.isArray(v.perBureau)) unsupported();
  const perBureau = v.perBureau.map((item): RecordV2 => { if (!record(item) || (!exact(item, V1_RECORD) && !exact(item, V2_RECORD)) || typeof item.bureau !== 'string' || !BUREAU_SET.has(item.bureau as BureauCode) || item.reportCode !== CRS_REPORT_CODE_BY_BUREAU[item.bureau as BureauCode] || !instant(item.pulledAt) || !identifier(item.subjectRef) || !int(item.monthlyDebtPaymentsCents) || !Array.isArray(item.accounts)) unsupported(); const isV2 = exact(item, V2_RECORD); return { bureau: item.bureau as BureauCode, reportCode: item.reportCode as string, pulledAt: item.pulledAt, subjectRef: item.subjectRef, accounts: item.accounts.map(parseAccount), inquiries: parseInquiries(item.inquiries), scores: isV2 ? parseScores(item.scores) : [], identity: isV2 ? parseIdentity(item.identity) : { namesOnFile: null, addressesOnFile: null, employersOnFile: null }, summaryCounts: isV2 ? parseCounts(item.summaryCounts) : { totalCollections: 0, totalPublicRecords: 0, totalNegativeAccounts: 0 }, monthlyDebtPaymentsCents: item.monthlyDebtPaymentsCents, v2: isV2 }; });
  if (v.noHit !== (perBureau.length === 0)) unsupported(); return { noHit: v.noHit, perBureau };
}
function same(a: NormalizedAccount, b: NormalizedAccount): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function pct(n: number, d: number): number | null { return d > 0 ? Math.round(n / d * 1000) / 10 : null; }
function toFeature(a: NormalizedAccount, accountRef: string): AccountFeature { return { ...a, accountRef, utilizationPct: a.limitCents !== null && a.limitCents > 0 ? pct(a.balanceCents, a.limitCents) : null }; }
export function extractFeatures(report: SoftPullReport): DerivedFeatures {
  const body = parseBody(report.body); if (!instant(report.pulledAt)) unsupported(); if (body.noHit) { if (report.bureaus.length !== 0) unsupported(); return build([], new Map(), report.pulledAt, 0); }
  const records = new Map<BureauCode, RecordV2>(); const raw = new Map<string, NormalizedAccount>(); let debt = 0;
  for (const item of body.perBureau) { if (records.has(item.bureau) || item.pulledAt !== report.pulledAt || !report.reportCodes.includes(item.reportCode as never)) conflict(); records.set(item.bureau, item); debt = Math.max(debt, item.monthlyDebtPaymentsCents); for (const account of item.accounts) { const prior = raw.get(account.accountRef); if (prior !== undefined && !same(prior, account)) conflict(); if (prior === undefined) raw.set(account.accountRef, account); } }
  const requested = new Set(report.bureaus); if (requested.size !== report.bureaus.length || requested.size !== records.size || [...requested].some((bureau) => !records.has(bureau))) conflict(); return build([...raw.values()], records, report.pulledAt, debt);
}
function build(raw: NormalizedAccount[], records: Map<BureauCode, RecordV2>, computedAt: string, monthlyDebtPaymentsCents: number): DerivedFeatures {
  const accounts = raw.sort((a, b) => a.accountRef.localeCompare(b.accountRef)).map((a, i) => toFeature(a, `account-${i + 1}`)); const openRevolving = accounts.filter((a) => a.isOpen && a.kind === 'revolving'); const limited = openRevolving.filter((a): a is AccountFeature & { limitCents: number } => a.limitCents !== null && a.limitCents > 0); const overallUtilizationPct = pct(limited.reduce((n, a) => n + a.balanceCents, 0), limited.reduce((n, a) => n + a.limitCents, 0)); const ages = accounts.flatMap((a) => a.ageMonths === null ? [] : [a.ageMonths]); const averageAgeMonths = ages.length === 0 ? null : Math.round(ages.reduce((a, b) => a + b, 0) / ages.length * 10) / 10; const limits = accounts.flatMap((a) => a.kind === 'revolving' && a.limitCents !== null ? [a.limitCents] : []); const inquiriesByBureau: Record<BureauCode, number> = { EQF: records.get('EQF')?.inquiries.length ?? 0, EXP: records.get('EXP')?.inquiries.length ?? 0, TUC: records.get('TUC')?.inquiries.length ?? 0 }; const inquiries = CRS_BUREAU_CODES.flatMap((bureau) => (records.get(bureau)?.inquiries ?? []).map((item, i) => ({ inquiryRef: `${bureau.toLowerCase()}-inquiry-${i + 1}`, bureau, monthsAgo: item.monthsAgo, matchedNewAccountWithin45Days: item.matchedNewAccountWithin45Days }))); const scores = CRS_BUREAU_CODES.flatMap((bureau) => records.get(bureau)?.scores ?? []); const values = [...records.values()]; const hasV2 = values.length === 0 || values.every((item) => item.v2); const maximum = (field: keyof RecordV2['identity']) => values.length === 0 || !hasV2 ? null : Math.max(...values.map((item) => item.identity[field] ?? 0)); const identity = { namesOnFile: maximum('namesOnFile'), addressesOnFile: maximum('addressesOnFile'), employersOnFile: maximum('employersOnFile') }; const collectionsCount = Math.max(0, ...values.map((r) => r.summaryCounts.totalCollections)); const publicRecordsCount = Math.max(0, ...values.map((r) => r.summaryCounts.totalPublicRecords)); const negativesCount = accounts.filter((a) => a.isNegative).length; const lateAccountsCount = accounts.filter((a) => a.lateWithin24Months).length; const openAccountsCount = accounts.filter((a) => a.isOpen).length; const lowestScore = scores.length === 0 ? null : Math.min(...scores.map((s) => s.score));
  return { schemaVersion: 2, bureausPulled: CRS_BUREAU_CODES.filter((b) => records.has(b)), scores, identity, accounts, overallUtilizationPct, inquiries, inquiriesByBureau, negativesCount, lateAccountsCount, collectionsCount, publicRecordsCount, openRevolvingCount: openRevolving.length, averageAgeMonths, highestRevolvingLimitCents: limits.length === 0 ? null : Math.max(...limits), dti: { monthlyDebtPaymentsCents, statedMonthlyIncomeCents: null, ratioPct: null }, flags: { ...(hasV2 ? { scoreAtLeast700: lowestScore !== null && lowestScore >= 700, cleanReport: identity.employersOnFile === 0 && identity.addressesOnFile !== null && identity.addressesOnFile <= 1, noLatePayments: lateAccountsCount === 0, noNegativeItemsReported: negativesCount + collectionsCount + publicRecordsCount === 0 } : {}), personalInformationConfirmed: false, utilizationUnder30: limited.length > 0 && limited.every((a) => (a.utilizationPct ?? 100) < 30), fourOrMorePersonalAccountsOpen: openAccountsCount >= 4, averageAgeTwoYearsOrMore: averageAgeMonths !== null && averageAgeMonths >= 24, cardWithTenKLimit: limits.some((limit) => limit >= 1_000_000), twoOrFewerInquiriesEveryBureau: CRS_BUREAU_CODES.every((b) => inquiriesByBureau[b] <= 2), thinFile: openAccountsCount < 4 }, computedAt };
}
