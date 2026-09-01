// web/src/lib/crs/mock/driver.test.ts — the mock driver's own behaviour.
//
// Scoped deliberately to what plan 04-07's cross-driver contract suite CANNOT assert. That suite
// runs the same cases against both drivers, so it can only assert things a sandbox driver against
// CRS's locked test identity would also satisfy; everything mock-specific — the member-ref shape,
// the persona encoded in it, the exact SMS pass code, the fixture quiz answers — lives here. The
// division matters, because a contract assertion that quietly only holds for the mock is a
// contract test that will start failing the day credentials arrive, for reasons nobody can find.
//
// Every case runs against a fixed clock. Nothing here sleeps, and the 30-second token TTL and the
// 72-hour lockout are both asserted to the millisecond because the clock is an argument rather
// than an ambient read.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CRS_IDV_LOCKOUT_HOURS,
  CRS_IDV_QUIZ_MAX_ANSWERS,
  CRS_PREAUTH_TOKEN_TTL_SECONDS,
} from '../constants.ts';
import { createFixedClock } from '../ports.ts';
import { SOFT_PULL_REPORT_REDACTION } from '../report.ts';
import { verifyAndParseWebhookImpl } from '../webhook.ts';
import { MOCK_IDV_QUIZ, MOCK_IDV_SMS_PASS_CODE } from './personas.ts';
import { createMockAdapter } from './driver.ts';

import type { CrsAdapter, CrsIdentity, CrsMemberRef, CrsPersona, ReportCode } from '../types.ts';
import type { CrsWebhookConfig } from '../webhook.ts';
import type { MockReportBody } from './personas.ts';

const CLOCK_INSTANT = '2026-08-16T12:00:00.000Z';
const CLOCK_INSTANT_MS = Date.parse(CLOCK_INSTANT);

/**
 * A synthetic identity, built entirely from reserved ranges so that no field could name a real
 * person or reach a real inbox: `example.invalid` is RFC 2606's reserved TLD, `555` is the
 * reserved fictional exchange, `00000` is an unassigned postal code, and an identity number
 * beginning `000` is one the issuing authority has never assigned. It is used only to satisfy the
 * frozen `CrsIdentity` shape; the driver reads three fields off it and retains none.
 */
const SYNTHETIC_IDENTITY: CrsIdentity = {
  firstName: 'Mock',
  lastName: 'Subject',
  dateOfBirth: '1990-01-01',
  ssn: '000000000',
  address: { line1: '1 Mock Way', city: 'Mocktown', state: 'CA', postalCode: '00000' },
  email: 'mock-subject@example.invalid',
  phone: '+15550000000',
};

/** Every control unconfigured — which is what makes the webhook verifier fail closed. */
const UNCONFIGURED_WEBHOOK: CrsWebhookConfig = {
  basicUser: null,
  basicPass: null,
  hmacSecret: null,
  hmacHeader: 'x-crs-signature',
  sourceIps: [],
};

function newAdapter(): { adapter: CrsAdapter; clock: ReturnType<typeof createFixedClock> } {
  const clock = createFixedClock(CLOCK_INSTANT);
  return { adapter: createMockAdapter({ clock, webhookConfig: UNCONFIGURED_WEBHOOK }), clock };
}

async function memberFor(adapter: CrsAdapter, persona: CrsPersona): Promise<CrsMemberRef> {
  const created = await adapter.createMember(SYNTHETIC_IDENTITY, { personaHint: persona });
  return created.memberRef;
}

const ALL_REPORT_CODES: ReportCode[] = ['EQF1001', 'EXP1001', 'TUC3002'];

/** The four correct answers, in the shape a submission carries them. */
function correctQuizAnswers(): Array<{ questionId: string; answerId: string }> {
  return MOCK_IDV_QUIZ.correctAnswers.map((answer) => ({
    questionId: answer.questionId,
    answerId: answer.answerId,
  }));
}

/** Four answers, every one of them wrong. */
function wrongQuizAnswers(): Array<{ questionId: string; answerId: string }> {
  return MOCK_IDV_QUIZ.correctAnswers.map((answer) => ({
    questionId: answer.questionId,
    answerId: 'mock-answer-wrong',
  }));
}

describe('createMockAdapter — shape', () => {
  it('reports the mock driver', () => {
    const { adapter } = newAdapter();
    assert.equal(adapter.driver, 'mock');
  });
});

describe('createMember', () => {
  it('encodes the persona hint in the member ref', async () => {
    const { adapter } = newAdapter();

    for (const persona of ['clean', 'derog', 'thin_file', 'no_hit'] as const) {
      const ref = await memberFor(adapter, persona);
      assert.match(ref, /^mock_(clean|derog|thin_file|no_hit)_\d+$/);
      assert.match(ref, new RegExp(`^mock_${persona}_\\d+$`));
    }
  });

  it('defaults to clean when no persona is hinted', async () => {
    const { adapter } = newAdapter();
    const created = await adapter.createMember(SYNTHETIC_IDENTITY);
    assert.match(created.memberRef, /^mock_clean_\d+$/);
  });

  it('mints a different ref on every call', async () => {
    const { adapter } = newAdapter();
    const first = await memberFor(adapter, 'clean');
    const second = await memberFor(adapter, 'clean');
    assert.notEqual(first, second);
  });

  it('returns idpass false for a new member', async () => {
    const { adapter } = newAdapter();
    const created = await adapter.createMember(SYNTHETIC_IDENTITY, { personaHint: 'clean' });
    assert.equal(created.idpass, false);
  });

  it('opens on an SMS challenge with two attempts and no question count', async () => {
    const { adapter } = newAdapter();
    const created = await adapter.createMember(SYNTHETIC_IDENTITY, { personaHint: 'clean' });

    assert.equal(created.challenge.kind, 'sms');
    assert.equal(created.challenge.attemptsRemaining, 2);
    assert.equal(created.challenge.questionCount, undefined);
    assert.ok(Date.parse(created.challenge.expiresAt) > CLOCK_INSTANT_MS);
  });

  it('refuses an identity missing one of the three fields CRS requires', async () => {
    const { adapter } = newAdapter();

    await assert.rejects(
      () => adapter.createMember({ ...SYNTHETIC_IDENTITY, email: '  ' }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, 'CrsDriverError');
        return true;
      },
    );
  });
});

describe('getPreauthToken', () => {
  it('carries the published 30-second TTL and an expiry exactly that far ahead', async () => {
    const { adapter } = newAdapter();
    const ref = await memberFor(adapter, 'clean');

    const token = await adapter.getPreauthToken(ref);

    assert.equal(token.ttlSeconds, CRS_PREAUTH_TOKEN_TTL_SECONDS);
    assert.equal(token.ttlSeconds, 30);
    assert.equal(Date.parse(token.expiresAt) - CLOCK_INSTANT_MS, 30_000);
  });

  it('never returns the same token string twice', async () => {
    const { adapter } = newAdapter();
    const ref = await memberFor(adapter, 'clean');

    const first = await adapter.getPreauthToken(ref);
    const second = await adapter.getPreauthToken(ref);

    assert.notEqual(first.token, second.token);
  });

  it('issues a transparently synthetic token that could not pass for a real one', async () => {
    const { adapter } = newAdapter();
    const ref = await memberFor(adapter, 'derog');

    const token = await adapter.getPreauthToken(ref);
    assert.match(token.token, /^mock-preauth-token-/);
  });
});

describe('submitIdvStep — the SMS branch', () => {
  it('passes on the fixture code', async () => {
    const { adapter } = newAdapter();
    const ref = await memberFor(adapter, 'clean');

    const result = await adapter.submitIdvStep(ref, { kind: 'sms', code: MOCK_IDV_SMS_PASS_CODE });

    assert.equal(result.outcome, 'pass');
    assert.ok(result.outcome === 'pass');
    assert.equal(result.verifiedAt, CLOCK_INSTANT);
  });

  it('decrements the attempt budget on a wrong code', async () => {
    const { adapter } = newAdapter();
    const ref = await memberFor(adapter, 'clean');

    const result = await adapter.submitIdvStep(ref, { kind: 'sms', code: '111111' });

    assert.ok(result.outcome === 'retry');
    assert.equal(result.challenge.kind, 'sms');
    assert.equal(result.challenge.attemptsRemaining, 1);
  });

  it('moves to the quiz once the SMS attempts run out, rather than locking', async () => {
    const { adapter } = newAdapter();
    const ref = await memberFor(adapter, 'clean');

    await adapter.submitIdvStep(ref, { kind: 'sms', code: '111111' });
    const result = await adapter.submitIdvStep(ref, { kind: 'sms', code: '222222' });

    assert.ok(result.outcome === 'retry');
    assert.equal(result.challenge.kind, 'quiz');
    assert.equal(result.challenge.questionCount, MOCK_IDV_QUIZ.questionCount);
    assert.equal(result.challenge.attemptsRemaining, CRS_IDV_QUIZ_MAX_ANSWERS);
  });

  it('spends no attempt on a submission of the wrong kind', async () => {
    const { adapter } = newAdapter();
    const ref = await memberFor(adapter, 'clean');

    const result = await adapter.submitIdvStep(ref, { kind: 'quiz', answers: correctQuizAnswers() });

    assert.ok(result.outcome === 'retry');
    assert.equal(result.challenge.kind, 'sms');
    assert.equal(result.challenge.attemptsRemaining, 2);
  });
});

describe('submitIdvStep — the quiz branch', () => {
  async function memberOnQuiz(adapter: CrsAdapter): Promise<CrsMemberRef> {
    const ref = await memberFor(adapter, 'clean');
    await adapter.submitIdvStep(ref, { kind: 'sms', code: '111111' });
    await adapter.submitIdvStep(ref, { kind: 'sms', code: '222222' });
    return ref;
  }

  it('passes when every answer matches the fixture', async () => {
    const { adapter } = newAdapter();
    const ref = await memberOnQuiz(adapter);

    const result = await adapter.submitIdvStep(ref, { kind: 'quiz', answers: correctQuizAnswers() });

    assert.ok(result.outcome === 'pass');
    assert.equal(result.verifiedAt, CLOCK_INSTANT);
  });

  it('treats a submission that repeats one correct answer as wrong', async () => {
    const { adapter } = newAdapter();
    const ref = await memberOnQuiz(adapter);
    const repeated = correctQuizAnswers()[0];

    const result = await adapter.submitIdvStep(ref, {
      kind: 'quiz',
      answers: [repeated, repeated, repeated, repeated],
    });

    assert.ok(result.outcome === 'retry');
  });

  it('locks after the whole allowance is spent, exactly 72 hours out', async () => {
    const { adapter } = newAdapter();
    const ref = await memberOnQuiz(adapter);

    for (let attempt = 1; attempt < CRS_IDV_QUIZ_MAX_ANSWERS; attempt += 1) {
      const retry = await adapter.submitIdvStep(ref, { kind: 'quiz', answers: wrongQuizAnswers() });
      assert.ok(retry.outcome === 'retry', `attempt ${attempt} should still be a retry`);
      assert.equal(retry.challenge.attemptsRemaining, CRS_IDV_QUIZ_MAX_ANSWERS - attempt);
    }

    const locked = await adapter.submitIdvStep(ref, { kind: 'quiz', answers: wrongQuizAnswers() });

    assert.ok(locked.outcome === 'locked');
    assert.equal(CRS_IDV_LOCKOUT_HOURS, 72);
    assert.equal(
      Date.parse(locked.lockedUntil) - CLOCK_INSTANT_MS,
      CRS_IDV_LOCKOUT_HOURS * 3600 * 1000,
    );
  });

  it('keeps reporting the same lockedUntil instead of sliding the window on every retry', async () => {
    const { adapter, clock } = newAdapter();
    const ref = await memberOnQuiz(adapter);

    let locked = await adapter.submitIdvStep(ref, { kind: 'quiz', answers: wrongQuizAnswers() });
    for (let attempt = 0; attempt < CRS_IDV_QUIZ_MAX_ANSWERS; attempt += 1) {
      locked = await adapter.submitIdvStep(ref, { kind: 'quiz', answers: wrongQuizAnswers() });
    }
    assert.ok(locked.outcome === 'locked');
    const firstLockedUntil = locked.lockedUntil;

    clock.advance(60 * 60 * 1000);
    const again = await adapter.submitIdvStep(ref, { kind: 'quiz', answers: correctQuizAnswers() });

    assert.ok(again.outcome === 'locked');
    assert.equal(again.lockedUntil, firstLockedUntil);
  });
});

describe('closeMember', () => {
  it('is idempotent and keeps the original instant', async () => {
    const { adapter, clock } = newAdapter();
    const ref = await memberFor(adapter, 'clean');

    const first = await adapter.closeMember(ref);
    clock.advance(6 * 60 * 60 * 1000);
    const second = await adapter.closeMember(ref);

    assert.equal(first.closedAt, CLOCK_INSTANT);
    assert.equal(second.closedAt, first.closedAt);
  });
});

describe('softPull', () => {
  it('reports the bureaus that produced a record and the codes that were asked for', async () => {
    const { adapter } = newAdapter();

    for (const persona of ['clean', 'derog', 'thin_file'] as const) {
      const ref = await memberFor(adapter, persona);
      const report = await adapter.softPull(ref, ALL_REPORT_CODES);

      assert.deepEqual(report.bureaus, ['EQF', 'EXP', 'TUC']);
      assert.deepEqual(report.reportCodes, ALL_REPORT_CODES);
      assert.equal(report.pulledAt, CLOCK_INSTANT);
    }
  });

  it('reports no bureau for no_hit while still naming the codes requested', async () => {
    const { adapter } = newAdapter();
    const ref = await memberFor(adapter, 'no_hit');

    const report = await adapter.softPull(ref, ALL_REPORT_CODES);

    assert.deepEqual(report.bureaus, []);
    assert.deepEqual(report.reportCodes, ALL_REPORT_CODES);
    assert.equal((report.body as MockReportBody).noHit, true);
  });

  it('fans out per bureau — one requested code produces exactly one record', async () => {
    const { adapter } = newAdapter();
    const ref = await memberFor(adapter, 'derog');

    const report = await adapter.softPull(ref, ['EXP1001']);

    assert.deepEqual(report.bureaus, ['EXP']);
    assert.equal((report.body as MockReportBody).perBureau.length, 1);
    assert.equal((report.body as MockReportBody).perBureau[0].bureau, 'EXP');
  });

  it('produces a SEALED report — the seal must hold on one the driver built, not only on one a test sealed', async () => {
    const { adapter } = newAdapter();
    const ref = await memberFor(adapter, 'derog');

    const report = await adapter.softPull(ref, ALL_REPORT_CODES);

    assert.throws(() => JSON.stringify(report));
    assert.throws(() => JSON.stringify({ context: 'a log line', wrapped: report }));
    assert.equal(String(report), SOFT_PULL_REPORT_REDACTION);
    assert.equal(`${report}`, SOFT_PULL_REPORT_REDACTION);
  });

  it('answers the same body twice for the same persona and the same instant', async () => {
    const { adapter } = newAdapter();

    const first = await adapter.softPull(await memberFor(adapter, 'clean'), ALL_REPORT_CODES);
    const second = await adapter.softPull(await memberFor(adapter, 'clean'), ALL_REPORT_CODES);

    assert.deepEqual(first.body, second.body);
  });

  it('refuses a member ref this driver did not mint, rather than defaulting to a persona', async () => {
    const { adapter } = newAdapter();

    await assert.rejects(
      () => adapter.softPull('not-a-mock-ref' as CrsMemberRef, ALL_REPORT_CODES),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, 'CrsDriverError');
        // The refusal names driver, operation and status and nothing else.
        assert.ok(!error.message.includes('not-a-mock-ref'));
        return true;
      },
    );
  });
});

describe('verifyAndParseWebhook', () => {
  it('refuses a forged request with the same reason the shared module gives', () => {
    const { adapter } = newAdapter();
    const headers = new Headers({ 'content-type': 'application/json' });
    const forged = '[{"id":"mock-hook-1","type":"TEST","user_id":"mock_clean_000001","time":1755345600000}]';

    const throughDriver = adapter.verifyAndParseWebhook({ headers, rawBody: forged });
    const throughModule = verifyAndParseWebhookImpl({
      headers,
      rawBody: forged,
      config: UNCONFIGURED_WEBHOOK,
    });

    assert.deepEqual(throughDriver, { ok: false, reason: 'bad_auth' });
    assert.deepEqual(throughDriver, throughModule);
  });

  it('parses an authenticated request identically to the shared module', () => {
    const clock = createFixedClock(CLOCK_INSTANT);
    const config: CrsWebhookConfig = {
      basicUser: 'not-a-real-user',
      basicPass: 'not-a-real-pass',
      hmacSecret: null,
      hmacHeader: 'x-crs-signature',
      sourceIps: [],
    };
    const adapter = createMockAdapter({ clock, webhookConfig: config });

    const credential = Buffer.from('not-a-real-user:not-a-real-pass', 'utf8').toString('base64');
    const headers = new Headers({ authorization: `Basic ${credential}` });
    const authentic = '[{"id":"mock-hook-1","type":"TEST","user_id":"mock_clean_000001","time":1755345600000}]';

    const throughDriver = adapter.verifyAndParseWebhook({ headers, rawBody: authentic });
    const throughModule = verifyAndParseWebhookImpl({ headers, rawBody: authentic, config });

    assert.ok(throughDriver.ok);
    assert.deepEqual(throughDriver, throughModule);
  });
});
