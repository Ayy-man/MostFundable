// web/src/lib/crs/mock/personas.test.ts — CRS-04, proven property by property.
//
// One table-driven suite over `MOCK_PERSONAS` rather than four copy-pasted blocks. That is not a
// tidiness preference: the loop iterates the fixture object itself, so a fifth persona added to
// `MOCK_PERSONAS` is asserted the moment it exists, and `PERSONA_PROPERTIES` below is typed
// `Record<CrsPersona, …>` so a fifth `CrsPersona` value that nobody wrote a property for is a
// typecheck failure rather than a silently skipped persona. Four hand-written blocks would give
// neither guarantee, and the failure they permit — a persona whose §8 property is never checked —
// only shows up in Phase 5, or in front of the client.
//
// The derived quantities are computed HERE, in this file, the way Phase 5 will compute them.
// `extractFeatures` and everything else under `lib/analysis/` is Phase 5's and is deliberately not
// written by this plan; `derive` below is a test-local stand-in whose only job is to prove the
// body is rich enough to support the computation. If the two ever disagree, the body is the
// contract and the disagreement is Phase 5's bug to find — which is exactly why the body carries
// raw per-account inputs and no derived field at all.
//
// Every persona is also asserted DETERMINISTIC, because the S1.7 seed pins a `personaHint` per
// demo client and re-running the pipeline has to reproduce the same plan (T-04-20). Determinism
// is asserted rather than assumed: two builds at the same instant are `deepEqual`, and two builds
// at different instants differ in `pulledAt` and in nothing else.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CRS_BUREAU_CODES, CRS_REPORT_CODE_BY_BUREAU } from '../constants.ts';
import { createFixedClock } from '../ports.ts';
import {
  MOCK_ALL_BUREAUS,
  MOCK_IDV_QUIZ,
  MOCK_IDV_SMS_PASS_CODE,
  MOCK_PERSONAS,
  buildMockBureauRecord,
  buildMockReportBody,
} from './personas.ts';

import type { BureauCode, CrsPersona } from '../types.ts';
import type { MockAccount, MockReportBody } from './personas.ts';

/** The pull instant every fixture in this file is built against. */
const PULL_INSTANT = '2026-08-16T12:00:00.000Z';

/** A second, deliberately distant instant — the clock-independence check builds against both. */
const LATER_INSTANT = '2027-03-04T08:30:00.000Z';

function pullInstant(): Date {
  return createFixedClock(PULL_INSTANT).now();
}

// ---------------------------------------------------------------------------------------------
// The Phase 5 computation, reproduced locally
// ---------------------------------------------------------------------------------------------

interface DerivedForTest {
  accountCount: number;
  openCount: number;
  overallUtilizationPct: number | null;
  negativesCount: number;
  averageAgeMonths: number | null;
  highestRevolvingLimitCents: number | null;
  revolvingAccountsOver30Pct: number;
  inquiriesByBureau: Partial<Record<BureauCode, number>>;
  monthlyDebtPaymentsCents: number;
}

/**
 * Merge the per-bureau records the way a tri-merge must and derive what §2.1 names.
 *
 * Accounts are unioned by `accountRef`, which is the whole reason a persona's bureaus disagree
 * about one account: a merge that double-counted or dropped it would show up here as a wrong
 * `accountCount`, and against three identical bureau inputs it could not show up at all.
 */
function derive(body: MockReportBody): DerivedForTest {
  const accountByRef = new Map<string, MockAccount>();
  for (const record of body.perBureau) {
    for (const account of record.accounts) accountByRef.set(account.accountRef, account);
  }
  const accounts = [...accountByRef.values()];

  const revolving = accounts.filter(
    (account): account is MockAccount & { limitCents: number } =>
      account.kind === 'revolving' && account.limitCents !== null,
  );
  const revolvingBalance = revolving.reduce((sum, account) => sum + account.balanceCents, 0);
  const revolvingLimit = revolving.reduce((sum, account) => sum + account.limitCents, 0);

  const inquiriesByBureau: Partial<Record<BureauCode, number>> = {};
  for (const record of body.perBureau) inquiriesByBureau[record.bureau] = record.inquiries.length;

  return {
    accountCount: accounts.length,
    openCount: accounts.filter((account) => account.isOpen).length,
    overallUtilizationPct:
      revolvingLimit === 0 ? null : (revolvingBalance / revolvingLimit) * 100,
    negativesCount: accounts.filter((account) => account.isNegative).length,
    averageAgeMonths:
      accounts.length === 0
        ? null
        : accounts.reduce((sum, account) => sum + account.ageMonths, 0) / accounts.length,
    highestRevolvingLimitCents:
      revolving.length === 0 ? null : Math.max(...revolving.map((account) => account.limitCents)),
    revolvingAccountsOver30Pct: revolving.filter(
      (account) => (account.balanceCents / account.limitCents) * 100 > 30,
    ).length,
    inquiriesByBureau,
    monthlyDebtPaymentsCents: body.perBureau[0]?.monthlyDebtPaymentsCents ?? 0,
  };
}

function inquiryCounts(derived: DerivedForTest): number[] {
  return Object.values(derived.inquiriesByBureau);
}

// ---------------------------------------------------------------------------------------------
// The §8 property each persona is defined by
// ---------------------------------------------------------------------------------------------

/**
 * One assertion block per persona, keyed by the persona name.
 *
 * Typed `Record<CrsPersona, …>` deliberately. Adding a fifth value to `CrsPersona` without adding
 * its §8 property here is `error TS2741`, so a new persona cannot reach the suite unasserted.
 */
const PERSONA_PROPERTIES: Readonly<Record<CrsPersona, (derived: DerivedForTest, body: MockReportBody) => void>> = {
  // §8: low utilization, no negatives, long average age, at most 2 inquiries per bureau, a card
  // with a limit at or above $10,000.
  clean: (derived) => {
    assert.notEqual(derived.overallUtilizationPct, null);
    assert.ok(
      (derived.overallUtilizationPct ?? 100) < 30,
      `clean must show low utilization; got ${derived.overallUtilizationPct}%`,
    );
    assert.equal(derived.negativesCount, 0);
    assert.ok(
      (derived.averageAgeMonths ?? 0) >= 24,
      `clean must show a long average age; got ${derived.averageAgeMonths} months`,
    );
    for (const [bureau, count] of Object.entries(derived.inquiriesByBureau)) {
      assert.ok(count <= 2, `clean must show at most 2 inquiries at ${bureau}; got ${count}`);
    }
    assert.ok(
      (derived.highestRevolvingLimitCents ?? 0) >= 1_000_000,
      `clean must carry a card with a limit at or above $10,000; highest was ${derived.highestRevolvingLimitCents}`,
    );
  },

  // §8: several accounts over 30% utilization, negatives present, inquiries above 2 on at least
  // one bureau.
  derog: (derived) => {
    assert.ok(
      derived.revolvingAccountsOver30Pct >= 3,
      `derog must show several accounts over 30% utilization; got ${derived.revolvingAccountsOver30Pct}`,
    );
    assert.ok(
      (derived.overallUtilizationPct ?? 0) > 30,
      `derog must show overall utilization above 30%; got ${derived.overallUtilizationPct}%`,
    );
    assert.ok(
      derived.negativesCount >= 1,
      `derog must show negative items reported; got ${derived.negativesCount}`,
    );
    // "at least one", never "all" — the fixture keeps two bureaus at or below 2 precisely so an
    // assertion written as "every bureau" fails against it.
    const counts = inquiryCounts(derived);
    assert.ok(
      counts.some((count) => count > 2),
      `derog must show more than 2 inquiries at some bureau; got ${JSON.stringify(counts)}`,
    );
    assert.ok(
      counts.some((count) => count <= 2),
      'derog must keep at least one bureau at or below 2 inquiries, so "at least one" is load-bearing',
    );
    // Differs from clean on the ten-thousand-limit factor too, not only on utilization.
    assert.ok(
      (derived.highestRevolvingLimitCents ?? 0) < 1_000_000,
      `derog must carry no card at or above a $10,000 limit; highest was ${derived.highestRevolvingLimitCents}`,
    );
  },

  // §8: fewer than 4 open personal accounts, short average age, nothing adverse.
  thin_file: (derived) => {
    assert.ok(
      derived.openCount < 4,
      `thin_file must show fewer than 4 open accounts; got ${derived.openCount}`,
    );
    assert.ok(
      (derived.averageAgeMonths ?? 999) < 24,
      `thin_file must show a short average age; got ${derived.averageAgeMonths} months`,
    );
    assert.equal(derived.negativesCount, 0);
    assert.ok(
      (derived.highestRevolvingLimitCents ?? 0) < 1_000_000,
      `thin_file must carry no card at or above a $10,000 limit; highest was ${derived.highestRevolvingLimitCents}`,
    );
  },

  // §8: no bureau record returned.
  no_hit: (derived, body) => {
    assert.deepEqual(body.perBureau, []);
    assert.equal(body.noHit, true);
    assert.equal(derived.accountCount, 0);
  },
};

// ---------------------------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------------------------

describe('MOCK_PERSONAS — the INTERFACES §8 contract', () => {
  it('ships exactly the four CrsPersona values and no others', () => {
    assert.deepEqual(Object.keys(MOCK_PERSONAS).sort(), ['clean', 'derog', 'no_hit', 'thin_file']);
  });

  it('has a §8 property block for every persona it ships', () => {
    assert.deepEqual(Object.keys(PERSONA_PROPERTIES).sort(), Object.keys(MOCK_PERSONAS).sort());
  });

  it('exposes every bureau in the tri-merge order', () => {
    assert.deepEqual([...MOCK_ALL_BUREAUS], [...CRS_BUREAU_CODES]);
  });
});

for (const personaKey of Object.keys(MOCK_PERSONAS)) {
  const persona = personaKey as CrsPersona;
  const fixture = MOCK_PERSONAS[persona];

  describe(`persona ${persona}`, () => {
    it('asserts its own INTERFACES §8 distinguishing property', () => {
      const body = buildMockReportBody(persona, MOCK_ALL_BUREAUS, pullInstant());
      PERSONA_PROPERTIES[persona](derive(body), body);
    });

    it('is keyed under its own name', () => {
      assert.equal(fixture.persona, persona);
    });

    it('carries opaque refs and no field that could hold identity content', () => {
      for (const account of fixture.accounts) {
        assert.match(account.accountRef, /^mock-acct-[a-z0-9]+$/);
      }
      for (const inquiry of fixture.inquiryPool) {
        assert.match(inquiry.inquiryRef, /^mock-inq-[a-z0-9]+$/);
      }
      assert.match(fixture.subjectRef, /^mock-subject-[a-z-]+$/);

      const accountRefs = fixture.accounts.map((account) => account.accountRef);
      assert.equal(new Set(accountRefs).size, accountRefs.length, 'account refs must be unique');
    });

    it('states ages relatively, so the property cannot drift as wall-clock time passes', () => {
      for (const account of fixture.accounts) {
        assert.ok(Number.isInteger(account.ageMonths) && account.ageMonths > 0);
      }
      for (const inquiry of fixture.inquiryPool) {
        assert.ok(Number.isInteger(inquiry.monthsAgo) && inquiry.monthsAgo > 0);
      }
    });

    it('gives installment and mortgage accounts no credit limit', () => {
      for (const account of fixture.accounts) {
        if (account.kind === 'installment' || account.kind === 'mortgage') {
          assert.equal(account.limitCents, null, `${account.accountRef} must carry no limit`);
        }
      }
    });

    it('supplies a non-zero DTI input whenever it reports any account', () => {
      assert.ok(Number.isInteger(fixture.monthlyDebtPaymentsCents));
      assert.ok(fixture.monthlyDebtPaymentsCents >= 0);
      if (fixture.accounts.length > 0) {
        assert.ok(
          fixture.monthlyDebtPaymentsCents > 0,
          'Phase 5 divides by this; a persona with accounts and no debt payment is not a real file',
        );
      }
    });

    it('varies its bureaus only in ways the merged file survives', () => {
      const accountRefs = new Set(fixture.accounts.map((account) => account.accountRef));

      for (const bureau of CRS_BUREAU_CODES) {
        const variant = fixture.bureauVariants[bureau];

        for (const omitted of variant.omittedAccountRefs) {
          // A typo here would omit nothing and the variation would silently stop existing.
          assert.ok(accountRefs.has(omitted), `${bureau} omits unknown account ${omitted}`);
        }
        assert.ok(variant.inquiryCount <= fixture.inquiryPool.length);
        assert.ok(variant.omittedAccountRefs.length < fixture.accounts.length + 1);
      }
    });

    it('labels each bureau record with that bureau’s own report code', () => {
      const body = buildMockReportBody(persona, MOCK_ALL_BUREAUS, pullInstant());
      for (const record of body.perBureau) {
        assert.equal(record.reportCode, CRS_REPORT_CODE_BY_BUREAU[record.bureau]);
        assert.equal(record.pulledAt, PULL_INSTANT);
        assert.equal(record.subjectRef, fixture.subjectRef);
      }
    });

    it('produces a deep-equal body when built twice against the same instant', () => {
      const first = buildMockReportBody(persona, MOCK_ALL_BUREAUS, pullInstant());
      const second = buildMockReportBody(persona, MOCK_ALL_BUREAUS, pullInstant());
      assert.deepEqual(first, second);
    });

    it('keeps its relative structure identical when the clock moves', () => {
      const now = buildMockReportBody(persona, MOCK_ALL_BUREAUS, pullInstant());
      const later = buildMockReportBody(
        persona,
        MOCK_ALL_BUREAUS,
        createFixedClock(LATER_INSTANT).now(),
      );

      const structure = (body: MockReportBody) =>
        body.perBureau.map((record) => ({
          bureau: record.bureau,
          accounts: record.accounts.map((account) => ({
            accountRef: account.accountRef,
            ageMonths: account.ageMonths,
          })),
          inquiries: record.inquiries.map((inquiry) => inquiry.inquiryRef),
        }));

      assert.deepEqual(structure(now), structure(later));

      // The only field the clock reaches is `pulledAt`, and it must actually have moved — an
      // assertion that two bodies are structurally identical proves nothing if the clock did not.
      for (const record of now.perBureau) assert.equal(record.pulledAt, PULL_INSTANT);
      for (const record of later.perBureau) assert.equal(record.pulledAt, LATER_INSTANT);
    });

    it('collapses a duplicated bureau to one record', () => {
      const body = buildMockReportBody(
        persona,
        ['EQF', 'EQF', 'EXP', 'EXP', 'EXP'],
        pullInstant(),
      );
      const bureaus = body.perBureau.map((record) => record.bureau);
      assert.deepEqual(bureaus, [...new Set(bureaus)]);
    });
  });
}

describe('buildMockBureauRecord', () => {
  it('answers null for no_hit at every bureau, rather than an empty record', () => {
    for (const bureau of CRS_BUREAU_CODES) {
      assert.equal(buildMockBureauRecord('no_hit', bureau, pullInstant()), null);
    }
  });

  it('answers a record for every other persona at every bureau', () => {
    for (const persona of ['clean', 'derog', 'thin_file'] as const) {
      for (const bureau of CRS_BUREAU_CODES) {
        const record = buildMockBureauRecord(persona, bureau, pullInstant());
        assert.notEqual(record, null);
        assert.equal(record?.bureau, bureau);
      }
    }
  });
});

describe('buildMockReportBody', () => {
  it('reports no_hit as an empty per-bureau list with the flag set', () => {
    const body = buildMockReportBody('no_hit', MOCK_ALL_BUREAUS, pullInstant());
    assert.equal(body.perBureau.length, 0);
    assert.equal(body.noHit, true);
  });

  it('reports noHit false for a persona that produced records', () => {
    const body = buildMockReportBody('clean', MOCK_ALL_BUREAUS, pullInstant());
    assert.equal(body.noHit, false);
    assert.equal(body.perBureau.length, 3);
  });

  it('produces one record per bureau asked for, and no more', () => {
    const body = buildMockReportBody('derog', ['TUC'], pullInstant());
    assert.equal(body.perBureau.length, 1);
    assert.equal(body.perBureau[0].bureau, 'TUC');
    assert.equal(body.perBureau[0].reportCode, 'TUC3002');
  });

  it('answers an empty body when no bureau was asked for', () => {
    const body = buildMockReportBody('clean', [], pullInstant());
    assert.deepEqual(body, { noHit: true, perBureau: [] });
  });
});

describe('identity-verification fixtures', () => {
  it('uses an obviously synthetic SMS code', () => {
    assert.equal(MOCK_IDV_SMS_PASS_CODE, '000000');
  });

  it('carries one correct answer per advertised question, with mock-prefixed ids', () => {
    assert.equal(MOCK_IDV_QUIZ.correctAnswers.length, MOCK_IDV_QUIZ.questionCount);

    const questionIds = MOCK_IDV_QUIZ.correctAnswers.map((answer) => answer.questionId);
    assert.equal(new Set(questionIds).size, questionIds.length);

    for (const answer of MOCK_IDV_QUIZ.correctAnswers) {
      assert.match(answer.questionId, /^mock-quiz-q\d+$/);
      assert.match(answer.answerId, /^mock-answer-q\d+-[a-z]$/);
    }
  });
});
