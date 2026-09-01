// web/src/lib/crs/mock/personas.ts — the four INTERFACES §8 personas and the body builder.
//
// These fixtures are a CROSS-LANE CONTRACT, not test data. Lane C's mock driver, the S1.7
// integration seed and the Milestone-2 demo script all read the same four shapes out of
// INTERFACES §8, and if the three disagree the demo breaks in front of the client. Changing a
// number here is therefore a contract change: the §8 property each persona is defined by must
// still hold afterwards, and `personas.test.ts` asserts every one of them.
//
// The four properties, verbatim from §8:
//
//   clean      low utilization, no negatives, long average age, at most 2 inquiries per bureau,
//              and a card with a limit at or above $10,000
//   derog      several accounts over 30% utilization, negatives present, inquiries above 2 on at
//              least one bureau
//   thin_file  fewer than 4 open personal accounts, short average age, nothing adverse
//   no_hit     no bureau record returned — contract-test only, never a seeded demo client
//
// The body shape below is OUR internal analysis envelope, not a CRS response shape. CRS v3 serves
// cached reports through `/users/efx-latest-report` and `/users/latest-report`; the sandbox driver
// normalizes their `providerViews` into this per-bureau envelope before feature extraction. The
// mock builds the same normalized form directly so downstream code remains driver-independent.
//
// The body is deliberately rich enough for Phase 5's `extractFeatures` to compute every field of
// `DerivedFeatures` (INTERFACES §2.1): per-account `balanceCents`, `limitCents`, `utilizationPct`,
// `ageMonths`, `isOpen` and `isNegative`; `inquiriesByBureau`; `negativesCount`;
// `openRevolvingCount`; `averageAgeMonths`; `highestRevolvingLimitCents`; and the DTI input
// `monthlyDebtPaymentsCents`. `statedMonthlyIncomeCents` is consumer-stated and is deliberately
// ABSENT — a bureau does not know it, so a bureau body that carried it would teach Phase 5 to
// read it from the wrong side of the boundary. Phase 5 owns `extractFeatures`; nothing in this
// file computes a derived feature.
//
// NO PERSONALLY IDENTIFYING DATA, even fake. There is no name field, no identity-number field, no
// address, no birth date and no account number anywhere in these types — accounts, inquiries and
// subjects carry opaque `mock-*` refs and nothing else. That is threat T-04-16: a fixture is
// permanent and readable by everyone with repo access, and the cheapest way to guarantee a
// fixture cannot carry identity content is to give it nowhere to put any.
//
// Compliance (DEV-ONBOARDING rule 4) applies to every string in this file exactly as it applies
// to UI copy. Each persona's description names a readiness STATE and never a repair ACTION, and
// the vocabulary is the one the frozen interface already sanctions — `isNegative`,
// "no negative items reported", `utilizationPct`.
//
// Nothing here reads env, and nothing here reads the wall clock: every function is a pure
// function of its arguments, with the current instant passed in from the injected `Clock` in
// `../ports.ts`. That purity is load-bearing rather than tidy — the S1.7 seed pins a
// `personaHint` per demo client and re-running the pipeline has to reproduce the same plan, which
// only holds if the same persona and the same instant produce a byte-identical body (T-04-20).

import type { BureauCode, CrsPersona, ReportCode } from '../types.ts';
import { CRS_BUREAU_CODES, CRS_REPORT_CODE_BY_BUREAU } from '../constants.ts';

// ---------------------------------------------------------------------------------------------
// Body shape
// ---------------------------------------------------------------------------------------------

/**
 * One account as a bureau reports it, in exactly the terms `AccountFeature` (INTERFACES §2.1)
 * is defined over — minus `utilizationPct`, which is derived and therefore Phase 5's to compute.
 *
 * `ageMonths` is RELATIVE and there is deliberately no `openedOn`. An absolute open date in a
 * fixture drifts with wall-clock time: `thin_file`'s "short average age" silently becomes a long
 * one as the months pass, and the §8 property the suite asserts quietly stops holding while every
 * test still shows green. A relative age cannot drift, so the fixture stays true indefinitely.
 */
export interface MockAccount {
  /** Opaque and obviously synthetic. Never anything account-number-shaped. */
  readonly accountRef: string;
  readonly kind: 'revolving' | 'installment' | 'mortgage' | 'other';
  readonly balanceCents: number;
  /** `null` for installment and mortgage accounts, which have no credit limit. */
  readonly limitCents: number | null;
  /** Months since the account opened, relative to the pull instant. */
  readonly ageMonths: number;
  readonly isOpen: boolean;
  /** A negative item is REPORTED on this account. A readiness state, never an action. */
  readonly isNegative: boolean;
}

/** One inquiry. `monthsAgo` is relative for the same reason `ageMonths` is. */
export interface MockInquiry {
  readonly inquiryRef: string;
  readonly monthsAgo: number;
}

/**
 * What one bureau returned for one pull.
 *
 * There is one of these per bureau because the Data API is per bureau; a body that presented all
 * three bureaus as a single merged record would make the sandbox driver a rebuild rather than the
 * swap DEC-D3 requires.
 */
export interface MockBureauRecord {
  readonly bureau: BureauCode;
  readonly reportCode: ReportCode;
  /** ISO 8601, derived from the injected clock — the one absolute date in the whole body. */
  readonly pulledAt: string;
  /** Opaque per-persona subject handle, identical across bureaus so a merge can key on it. */
  readonly subjectRef: string;
  readonly accounts: readonly MockAccount[];
  readonly inquiries: readonly MockInquiry[];
  /** The DTI numerator input. The income side is consumer-stated and is not a bureau field. */
  readonly monthlyDebtPaymentsCents: number;
}

/**
 * The report body the mock driver seals.
 *
 * `noHit` is a first-class field rather than an inference from `perBureau.length === 0`, because
 * the two states a caller must tell apart are "no bureau holds a record for this subject" and
 * "no bureau was asked" — the first is `no_hit` and produces no plan, the second is a caller bug.
 */
export interface MockReportBody {
  readonly noHit: boolean;
  readonly perBureau: readonly MockBureauRecord[];
}

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

/**
 * How one bureau's view differs from the persona's canonical file.
 *
 * The three bureaus deliberately disagree a little within every persona, because a tri-merge that
 * is only ever exercised against three identical inputs is not exercised at all — the merge would
 * pass its tests while silently dropping or double-counting an account the moment real bureau
 * data disagreed. The disagreement is bounded so that the MERGED file still holds the §8
 * property: an omitted account is present at the other two bureaus, so the union is unchanged.
 */
export interface MockBureauVariant {
  /** Refs from the persona's account list that this bureau does not report. */
  readonly omittedAccountRefs: readonly string[];
  /** How many of the persona's inquiry pool this bureau reports, taken from the front. */
  readonly inquiryCount: number;
}

/** One persona's canonical file plus the three bureau views of it. */
export interface MockPersonaFixture {
  readonly persona: CrsPersona;
  /**
   * A readiness STATE, in the vocabulary the frozen interface sanctions. Never an action, never a
   * numeric outcome promise — DEV-ONBOARDING rule 4 covers this string exactly like UI copy.
   */
  readonly description: string;
  readonly subjectRef: string;
  readonly accounts: readonly MockAccount[];
  readonly inquiryPool: readonly MockInquiry[];
  readonly monthlyDebtPaymentsCents: number;
  readonly bureauVariants: Readonly<Record<BureauCode, MockBureauVariant>>;
}

/** Every bureau reports the whole file and no inquiries — the `no_hit` variant, which is unused. */
const NO_VARIATION: MockBureauVariant = { omittedAccountRefs: [], inquiryCount: 0 };

/**
 * The four personas. Each number is chosen so its §8 property holds with MARGIN rather than
 * marginally: `clean`'s utilization is 5%, not 29%, and `thin_file`'s average age is 10 months,
 * not 23. A fixture that only just clears its threshold turns any later tuning into a silent
 * contract break, and the assertion that catches it fires in Phase 5 instead of here.
 */
export const MOCK_PERSONAS: Readonly<Record<CrsPersona, MockPersonaFixture>> = {
  // -------------------------------------------------------------------------------------------
  // clean — §8: low utilization, no negatives, long average age, at most 2 inquiries per bureau,
  // a card with a limit at or above $10,000.
  //
  // Six open accounts. Revolving utilization is 155_000 / 3_100_000 = 5.0% overall and no single
  // card is above 6%. Average age is 441 / 6 = 73.5 months. Every `isNegative` is false. The
  // $15,000 card clears the ten-thousand-limit factor with room.
  // -------------------------------------------------------------------------------------------
  clean: {
    persona: 'clean',
    description:
      'Low revolving utilization, no negative items reported, a long average account age, at ' +
      'most two inquiries at every bureau, and a card with a limit at or above $10,000.',
    subjectRef: 'mock-subject-clean',
    accounts: [
      // The ten-thousand-limit card. 90_000 / 1_500_000 = 6.0%.
      { accountRef: 'mock-acct-cl1', kind: 'revolving', balanceCents: 90_000, limitCents: 1_500_000, ageMonths: 112, isOpen: true, isNegative: false },
      // 40_000 / 800_000 = 5.0%.
      { accountRef: 'mock-acct-cl2', kind: 'revolving', balanceCents: 40_000, limitCents: 800_000, ageMonths: 74, isOpen: true, isNegative: false },
      // 25_000 / 500_000 = 5.0%.
      { accountRef: 'mock-acct-cl3', kind: 'revolving', balanceCents: 25_000, limitCents: 500_000, ageMonths: 55, isOpen: true, isNegative: false },
      { accountRef: 'mock-acct-cl4', kind: 'installment', balanceCents: 620_000, limitCents: null, ageMonths: 41, isOpen: true, isNegative: false },
      { accountRef: 'mock-acct-cl5', kind: 'mortgage', balanceCents: 18_500_000, limitCents: null, ageMonths: 96, isOpen: true, isNegative: false },
      // Carries no balance, so it lowers overall utilization while adding open-account count.
      { accountRef: 'mock-acct-cl6', kind: 'revolving', balanceCents: 0, limitCents: 300_000, ageMonths: 63, isOpen: true, isNegative: false },
    ],
    inquiryPool: [
      { inquiryRef: 'mock-inq-cl1', monthsAgo: 9 },
      { inquiryRef: 'mock-inq-cl2', monthsAgo: 4 },
    ],
    // Mortgage 145_000 + installment 38_500 + revolving minimums 4_500.
    monthlyDebtPaymentsCents: 188_000,
    bureauVariants: {
      EQF: { omittedAccountRefs: [], inquiryCount: 2 },
      EXP: { omittedAccountRefs: [], inquiryCount: 1 },
      // TUC has not picked up the store card. Its own utilization is 155_000 / 2_800_000 = 5.5%,
      // so the §8 property holds bureau-by-bureau as well as on the merged file.
      TUC: { omittedAccountRefs: ['mock-acct-cl6'], inquiryCount: 0 },
    },
  },

  // -------------------------------------------------------------------------------------------
  // derog — §8: several accounts over 30% utilization, negatives present, inquiries above 2 on at
  // least one bureau.
  //
  // Four revolving accounts, every one of them above 60% utilization, and 825_000 / 940_000 =
  // 87.8% overall. Two accounts report a negative item. EQF shows 5 inquiries while EXP shows 2
  // and TUC shows 1 — so the suite has to assert "at least one bureau above 2" and an assertion
  // written as "every bureau above 2" fails against this fixture, which is the point. The highest
  // revolving limit is 450_000, below the 1_000_000 threshold, so `derog` differs from `clean` on
  // the ten-thousand-limit factor as well as on utilization and negatives.
  // -------------------------------------------------------------------------------------------
  derog: {
    persona: 'derog',
    description:
      'Several revolving accounts above 30% utilization, negative items reported on more than ' +
      'one account, and more than two inquiries at one bureau.',
    subjectRef: 'mock-subject-derog',
    accounts: [
      // 418_000 / 450_000 = 92.9%.
      { accountRef: 'mock-acct-dg1', kind: 'revolving', balanceCents: 418_000, limitCents: 450_000, ageMonths: 38, isOpen: true, isNegative: false },
      // 232_000 / 250_000 = 92.8%.
      { accountRef: 'mock-acct-dg2', kind: 'revolving', balanceCents: 232_000, limitCents: 250_000, ageMonths: 26, isOpen: true, isNegative: false },
      // 97_000 / 150_000 = 64.7%.
      { accountRef: 'mock-acct-dg3', kind: 'revolving', balanceCents: 97_000, limitCents: 150_000, ageMonths: 19, isOpen: true, isNegative: false },
      // 78_000 / 90_000 = 86.7%.
      { accountRef: 'mock-acct-dg4', kind: 'revolving', balanceCents: 78_000, limitCents: 90_000, ageMonths: 14, isOpen: true, isNegative: false },
      { accountRef: 'mock-acct-dg5', kind: 'installment', balanceCents: 940_000, limitCents: null, ageMonths: 29, isOpen: true, isNegative: true },
      { accountRef: 'mock-acct-dg6', kind: 'other', balanceCents: 62_000, limitCents: null, ageMonths: 44, isOpen: false, isNegative: true },
      { accountRef: 'mock-acct-dg7', kind: 'installment', balanceCents: 0, limitCents: null, ageMonths: 71, isOpen: false, isNegative: false },
    ],
    inquiryPool: [
      { inquiryRef: 'mock-inq-dg1', monthsAgo: 11 },
      { inquiryRef: 'mock-inq-dg2', monthsAgo: 8 },
      { inquiryRef: 'mock-inq-dg3', monthsAgo: 5 },
      { inquiryRef: 'mock-inq-dg4', monthsAgo: 3 },
      { inquiryRef: 'mock-inq-dg5', monthsAgo: 1 },
    ],
    // Revolving minimums 30_500 + installment 31_000.
    monthlyDebtPaymentsCents: 61_500,
    bureauVariants: {
      EQF: { omittedAccountRefs: [], inquiryCount: 5 },
      EXP: { omittedAccountRefs: ['mock-acct-dg7'], inquiryCount: 2 },
      TUC: { omittedAccountRefs: [], inquiryCount: 1 },
    },
  },

  // -------------------------------------------------------------------------------------------
  // thin_file — §8: fewer than 4 open personal accounts, short average age, nothing adverse.
  //
  // Three open accounts, average age 30 / 3 = 10.0 months, no negative item anywhere, and the
  // highest revolving limit is 120_000 — so the thin-file, account-count, average-age and
  // ten-thousand-limit factors all read differently from `clean` while nothing adverse appears.
  // -------------------------------------------------------------------------------------------
  thin_file: {
    persona: 'thin_file',
    description:
      'Fewer than four open accounts and a short average account age, with no negative items ' +
      'reported and low revolving utilization.',
    subjectRef: 'mock-subject-thin-file',
    accounts: [
      // 12_000 / 50_000 = 24.0%.
      { accountRef: 'mock-acct-tf1', kind: 'revolving', balanceCents: 12_000, limitCents: 50_000, ageMonths: 14, isOpen: true, isNegative: false },
      // 9_000 / 120_000 = 7.5%.
      { accountRef: 'mock-acct-tf2', kind: 'revolving', balanceCents: 9_000, limitCents: 120_000, ageMonths: 9, isOpen: true, isNegative: false },
      { accountRef: 'mock-acct-tf3', kind: 'installment', balanceCents: 84_000, limitCents: null, ageMonths: 7, isOpen: true, isNegative: false },
    ],
    inquiryPool: [
      { inquiryRef: 'mock-inq-tf1', monthsAgo: 5 },
      { inquiryRef: 'mock-inq-tf2', monthsAgo: 2 },
    ],
    // Installment 3_200 + revolving minimums 1_500.
    monthlyDebtPaymentsCents: 4_700,
    bureauVariants: {
      EQF: { omittedAccountRefs: [], inquiryCount: 2 },
      EXP: { omittedAccountRefs: [], inquiryCount: 1 },
      // Two open accounts at TUC alone, so the thin-file property holds per bureau as well.
      TUC: { omittedAccountRefs: ['mock-acct-tf2'], inquiryCount: 1 },
    },
  },

  // -------------------------------------------------------------------------------------------
  // no_hit — §8: no bureau record returned. Contract-test only, NEVER a seeded demo client, so
  // the S1.7 seed's three consumer clients are `clean`, `derog` and `thin_file` and no fourth.
  // -------------------------------------------------------------------------------------------
  no_hit: {
    persona: 'no_hit',
    description: 'No bureau record returned. Contract-test only, never a seeded demo client.',
    subjectRef: 'mock-subject-no-hit',
    accounts: [],
    inquiryPool: [],
    monthlyDebtPaymentsCents: 0,
    bureauVariants: { EQF: NO_VARIATION, EXP: NO_VARIATION, TUC: NO_VARIATION },
  },
};

// ---------------------------------------------------------------------------------------------
// Builders — pure functions of persona, bureau and the pull instant
// ---------------------------------------------------------------------------------------------

/**
 * Build one bureau's record for one persona, or `null` when that persona has no bureau record.
 *
 * `null` rather than an empty record for `no_hit` is the honest answer: an empty record says "this
 * bureau holds a file for this subject and it is empty", and that is a different fact from "no
 * bureau holds a file", which is the whole of what `no_hit` means. It also keeps the emptiness in
 * one place — `buildMockReportBody` filters, so there is no `no_hit` special case for a later
 * edit to forget, and a direct caller is forced by the type to handle the case.
 *
 * `now` is the pull instant, supplied by the caller from the injected `Clock`. It is the only
 * input that reaches an absolute date, and `pulledAt` is the only field it reaches.
 */
export function buildMockBureauRecord(
  persona: CrsPersona,
  bureau: BureauCode,
  now: Date,
): MockBureauRecord | null {
  const fixture = MOCK_PERSONAS[persona];
  const variant = fixture.bureauVariants[bureau];

  if (fixture.accounts.length === 0 && fixture.inquiryPool.length === 0) return null;

  const omitted = new Set(variant.omittedAccountRefs);

  return {
    bureau,
    reportCode: CRS_REPORT_CODE_BY_BUREAU[bureau],
    pulledAt: now.toISOString(),
    subjectRef: fixture.subjectRef,
    accounts: fixture.accounts.filter((account) => !omitted.has(account.accountRef)),
    inquiries: fixture.inquiryPool.slice(0, variant.inquiryCount),
    monthlyDebtPaymentsCents: fixture.monthlyDebtPaymentsCents,
  };
}

/**
 * Build the whole body for one persona across the bureaus that were asked.
 *
 * Modelled as the normalized per-bureau records the sandbox boundary produces from CRS v3
 * `providerViews`. This is an internal compatibility shape, not a provider endpoint model.
 *
 * Duplicate bureaus in the argument collapse to one record. A caller asking for `EQF1001` twice
 * has made a mistake, and answering with the same file twice would double every count Phase 5
 * derives from the merged body.
 */
export function buildMockReportBody(
  persona: CrsPersona,
  bureaus: readonly BureauCode[],
  now: Date,
): MockReportBody {
  const seen = new Set<BureauCode>();
  const perBureau: MockBureauRecord[] = [];

  for (const bureau of bureaus) {
    if (seen.has(bureau)) continue;
    seen.add(bureau);

    const record = buildMockBureauRecord(persona, bureau, now);
    if (record !== null) perBureau.push(record);
  }

  return { noHit: perBureau.length === 0, perBureau };
}

/** Every bureau, in the order the tri-merge reports them. Convenience for a caller pulling all. */
export const MOCK_ALL_BUREAUS: readonly BureauCode[] = CRS_BUREAU_CODES;

// ---------------------------------------------------------------------------------------------
// Identity-verification fixtures
//
// Both literals are obviously fake and could not be mistaken for a value a real provider issued.
// The SMS code is all zeroes and the quiz ids are `mock-`-prefixed; neither is a credential, and
// neither carries or implies any identity content.
// ---------------------------------------------------------------------------------------------

/** The one SMS code the mock's identity step accepts. Every other code is a wrong answer. */
export const MOCK_IDV_SMS_PASS_CODE = '000000';

/** One expected answer, in the shape `IdvSubmission` carries. */
export interface MockIdvQuizAnswer {
  readonly questionId: string;
  readonly answerId: string;
}

/**
 * The quiz the mock's identity step checks a submission against.
 *
 * CRS v3 has no KBA or quiz fallback; this fixture exists only to retain deterministic coverage of
 * the legacy local enrollment state while mock remains the default. The sandbox driver never
 * constructs or accepts this challenge.
 */
export const MOCK_IDV_QUIZ: {
  readonly questionCount: number;
  readonly correctAnswers: readonly MockIdvQuizAnswer[];
} = {
  questionCount: 4,
  correctAnswers: [
    { questionId: 'mock-quiz-q1', answerId: 'mock-answer-q1-c' },
    { questionId: 'mock-quiz-q2', answerId: 'mock-answer-q2-a' },
    { questionId: 'mock-quiz-q3', answerId: 'mock-answer-q3-d' },
    { questionId: 'mock-quiz-q4', answerId: 'mock-answer-q4-b' },
  ],
};
