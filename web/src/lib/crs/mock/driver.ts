// web/src/lib/crs/mock/driver.ts — `createMockAdapter`, a REAL implementation of `CrsAdapter`.
//
// This is not a test double and should not be read as one. DEC-D3 makes the mock the Milestone-2
// deliverable — the client demo runs against it, stated out loud as a mock — and says the sandbox
// driver is "a swap, not a rebuild". Every method of the frozen interface is implemented for
// real: the identity step is an actual state machine with attempt budgets and a lockout, tokens
// carry a real TTL computed from the injected clock and are never reissued identically, closing a
// member is genuinely idempotent, and `softPull` fans out per bureau exactly as the Data API
// forces before merging on our side.
//
// Two consequences of "real implementation" that are easy to lose:
//
//   - Every report leaves through `sealReport` in `../report.ts`, the ONE construction site for a
//     `SoftPullReport`. The mock is held to the identical control the sandbox driver is, because
//     "it is only mock data" is precisely the reasoning that puts a bureau body in a log line
//     (T-04-17), and a second construction site here would hand a caller an unsealed report
//     (T-04-18).
//   - Webhook verification DELEGATES to `verifyAndParseWebhookImpl` in `../webhook.ts` rather than
//     being reimplemented. A mock that accepted a forged request the sandbox driver rejects would
//     make every cross-driver contract test in plan 04-07 a lie (T-04-19).
//
// Determinism is a requirement, not a nicety. Nothing in this file reads the wall clock, draws a
// random number or reads an environment variable — time arrives through the injected `Clock` and
// webhook configuration arrives through `deps`. The S1.7 seed pins a `personaHint` per demo
// client and re-running the pipeline has to reproduce the same plan, which only holds if the same
// persona against the same instant produces a byte-identical body (T-04-20).
//
// Nothing here logs. The body a soft pull produces never reaches a log line, an error message or
// any other output channel, and no method in this file writes anything anywhere.

import {
  CRS_BUREAU_CODES,
  CRS_IDV_LOCKOUT_HOURS,
  CRS_IDV_QUIZ_MAX_ANSWERS,
  CRS_MOBILE_VERIFICATION_TTL_SECONDS,
  CRS_PREAUTH_TOKEN_TTL_SECONDS,
  CRS_REPORT_CODE_BY_BUREAU,
} from '../constants.ts';
import { CrsDriverError } from '../errors.ts';
import { sealReport } from '../report.ts';
import { verifyAndParseWebhookImpl } from '../webhook.ts';
import { MOCK_IDV_QUIZ, MOCK_IDV_SMS_PASS_CODE, buildMockReportBody } from './personas.ts';

import type { Clock } from '../ports.ts';
import type {
  BureauCode,
  CreateMemberOptions,
  CreateMemberResult,
  CrsAdapter,
  CrsIdentity,
  CrsMemberRef,
  CrsPersona,
  CrsWebhookParse,
  IdvChallengeState,
  IdvResult,
  IdvSubmission,
  ObservedCreditScore,
  PreauthToken,
  ReportCode,
  SoftPullReport,
} from '../types.ts';
import type { CrsWebhookConfig } from '../webhook.ts';

// ---------------------------------------------------------------------------------------------
// Member refs
// ---------------------------------------------------------------------------------------------

/**
 * The member-ref shape, and the only place it is defined.
 *
 * The persona is encoded INTO the ref rather than held in a lookup table, for two reasons that
 * both matter operationally. It survives across adapter instances, so a ref minted in one process
 * still pulls the right file in another — which is what lets the S1.7 seed write a ref straight
 * into a fixture row without this driver having been alive when it did. And the `mock_` prefix is
 * load-bearing on its own: plan 04-05's token endpoint requires all three of a non-production
 * `NODE_ENV`, the `mock` driver and a `mock_`-prefixed ref before it will honour a `?memberRef=`
 * from request input, so a ref that does not carry the prefix cannot reach that affordance.
 *
 * The persona alternatives are spelled out rather than matched as `\w+`, because `thin_file`
 * itself contains the `_` the ref uses as a separator and a greedy pattern would split it wrong.
 */
const MEMBER_REF_PATTERN = /^mock_(clean|derog|thin_file|no_hit)_(\d+)$/;

/** Zero-padded so refs sort lexically in the order they were minted, which reads better in a seed. */
const MEMBER_REF_SEQUENCE_WIDTH = 6;

function buildMemberRef(persona: CrsPersona, sequence: number): CrsMemberRef {
  const padded = String(sequence).padStart(MEMBER_REF_SEQUENCE_WIDTH, '0');
  return `mock_${persona}_${padded}` as CrsMemberRef;
}

/**
 * Recover the persona a ref was minted for.
 *
 * A ref this driver did not mint is a caller error and is refused, never defaulted. Defaulting to
 * `clean` would be the worst possible failure mode for the Milestone-2 demo: a broken or
 * mistyped ref would render a healthy file and nothing anywhere would look wrong.
 */
function personaFromMemberRef(memberRef: CrsMemberRef): CrsPersona {
  const match = MEMBER_REF_PATTERN.exec(memberRef);
  if (match === null) {
    // 404 is the structural shape of "CRS holds no such member". The message is the fixed
    // driver/operation/status template from `errors.ts` and carries no part of the ref.
    throw new CrsDriverError('mock', 'softPull', 404);
  }
  return match[1] as CrsPersona;
}

// ---------------------------------------------------------------------------------------------
// Report codes → bureaus
// ---------------------------------------------------------------------------------------------

/**
 * The reverse of `CRS_REPORT_CODE_BY_BUREAU`, derived from it rather than written out again.
 *
 * A second hand-written table is a second thing to keep in sync, and the failure it produces is
 * silent: a report code quietly mapping to the wrong bureau would show one bureau's file under
 * another's name with nothing failing. Deriving it means the constant stays the single source.
 */
const BUREAU_BY_REPORT_CODE: Readonly<Record<ReportCode, BureauCode>> = (() => {
  const table = {} as Record<ReportCode, BureauCode>;
  for (const bureau of CRS_BUREAU_CODES) {
    table[CRS_REPORT_CODE_BY_BUREAU[bureau]] = bureau;
  }
  return table;
})();

const SCORES_BY_PERSONA: Readonly<Record<CrsPersona, readonly number[]>> = {
  clean: [825, 761, 779],
  derog: [580, 565, 591],
  thin_file: [640, 625, 648],
  no_hit: [],
};

// ---------------------------------------------------------------------------------------------
// Time helpers — every one takes the instant as an argument
// ---------------------------------------------------------------------------------------------

function isoAfterSeconds(now: Date, seconds: number): string {
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

function isoAfterHours(now: Date, hours: number): string {
  return isoAfterSeconds(now, hours * 3600);
}

// ---------------------------------------------------------------------------------------------
// Identity verification state
// ---------------------------------------------------------------------------------------------

/**
 * One member's position in the identity flow.
 *
 * `verifiedAt` and `lockedUntil` are both terminal and both are checked before any attempt is
 * spent, so re-submitting after a pass is idempotent and re-submitting after a lockout keeps
 * reporting the same `lockedUntil` rather than sliding the window forward on every retry.
 */
interface MemberIdvState {
  challenge: IdvChallengeState;
  verifiedAt: string | null;
  lockedUntil: string | null;
}

/**
 * The first challenge every member gets.
 *
 * This legacy local flow is deliberately isolated from the CRS v3 sandbox driver. CRS v3 uses
 * DIT followed by SMFA and has no quiz fallback; the mock keeps the quiz only so the existing
 * enrollment state machine remains testable while mock is the default.
 */
function initialChallenge(now: Date): IdvChallengeState {
  return {
    kind: 'sms',
    attemptsRemaining: 2,
    expiresAt: isoAfterSeconds(now, CRS_MOBILE_VERIFICATION_TTL_SECONDS),
  };
}

function quizChallenge(now: Date): IdvChallengeState {
  return {
    kind: 'quiz',
    attemptsRemaining: CRS_IDV_QUIZ_MAX_ANSWERS,
    expiresAt: isoAfterSeconds(now, CRS_MOBILE_VERIFICATION_TTL_SECONDS),
    questionCount: MOCK_IDV_QUIZ.questionCount,
  };
}

/**
 * Does a quiz submission match the fixture exactly?
 *
 * Order-independent, because nothing says a client must answer in the order it was asked; but the
 * count must match and a question may not be answered twice, so a submission that repeats one
 * correct answer four times is a wrong answer rather than a pass.
 */
function quizAnswersMatch(answers: ReadonlyArray<{ questionId: string; answerId: string }>): boolean {
  if (answers.length !== MOCK_IDV_QUIZ.correctAnswers.length) return false;

  const expected = new Map(
    MOCK_IDV_QUIZ.correctAnswers.map((answer) => [answer.questionId, answer.answerId]),
  );
  const answered = new Set<string>();

  for (const answer of answers) {
    if (answered.has(answer.questionId)) return false;
    answered.add(answer.questionId);
    if (expected.get(answer.questionId) !== answer.answerId) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------------------------

export interface MockAdapterDeps {
  /** The single time source. Nothing in this file reads a wall clock of its own. */
  clock: Clock;
  /**
   * Threaded in rather than read here, so this module reads no environment variable at any scope
   * and the whole driver is constructible from literals in a test. The route wiring in plan 04-08
   * is what calls `readWebhookConfigFromEnv` — at the call site, never at module load.
   */
  webhookConfig: CrsWebhookConfig;
}

/**
 * Build a mock `CrsAdapter`.
 *
 * All mutable state lives in this closure: one identity-flow record per member, one close record
 * per member, and two counters. That makes each adapter an isolated world — two of them in the
 * same process cannot see each other's members — while the persona still survives between them,
 * because the persona rides in the ref rather than in the state.
 */
export function createMockAdapter(deps: MockAdapterDeps): CrsAdapter {
  const idvStateByMemberRef = new Map<string, MemberIdvState>();
  const closedAtByMemberRef = new Map<string, string>();

  let memberSequence = 0;
  let tokenSequence = 0;

  /**
   * The identity state for a ref, created on first sight.
   *
   * Lazy creation is what makes a ref minted by another adapter instance — the S1.7 seed's, say —
   * work here instead of throwing. The ref carries everything that must survive; the attempt
   * budget legitimately starts fresh in a new process.
   */
  function idvStateFor(memberRef: CrsMemberRef, now: Date): MemberIdvState {
    const existing = idvStateByMemberRef.get(memberRef);
    if (existing !== undefined) return existing;

    const created: MemberIdvState = {
      challenge: initialChallenge(now),
      verifiedAt: null,
      lockedUntil: null,
    };
    idvStateByMemberRef.set(memberRef, created);
    return created;
  }

  return {
    driver: 'mock',
    pullBilling: 'cached-read',

    async createMember(
      identity: CrsIdentity,
      options?: CreateMemberOptions,
    ): Promise<CreateMemberResult> {
      // CRS's member creation requires exactly these three fields and nothing else; full identity
      // is a separate call. Checking them here rather than accepting anything means lane B cannot
      // ship a caller that only fails once sandbox credentials land. Nothing read is retained:
      // the ref is built from the persona and a counter, and the identity argument is not stored,
      // copied or referenced after this block.
      const hasRequiredFields =
        identity.email.trim() !== '' &&
        identity.firstName.trim() !== '' &&
        identity.lastName.trim() !== '';

      if (!hasRequiredFields) {
        throw new CrsDriverError('mock', 'createMember', 400);
      }

      const now = deps.clock.now();
      memberSequence += 1;

      const persona = options?.personaHint ?? 'clean';
      const memberRef = buildMemberRef(persona, memberSequence);
      const challenge = initialChallenge(now);

      idvStateByMemberRef.set(memberRef, { challenge, verifiedAt: null, lockedUntil: null });

      return {
        memberRef,
        // A value CRS RETURNS, never one we send (pre-flight A8). A member created this instant
        // has not verified, so it is false; a returning member is what carries true.
        idpass: false,
        challenge,
      };
    },

    async submitIdvStep(
      memberRef: CrsMemberRef,
      submission: IdvSubmission,
    ): Promise<IdvResult> {
      const now = deps.clock.now();
      const state = idvStateFor(memberRef, now);

      // Both terminal states answer before any attempt is spent, so a repeated submission is
      // idempotent and a locked member's window does not slide forward every time it is retried.
      if (state.lockedUntil !== null) return { outcome: 'locked', lockedUntil: state.lockedUntil };
      if (state.verifiedAt !== null) return { outcome: 'pass', verifiedAt: state.verifiedAt };

      // A step of the wrong kind is a caller mistake, not a wrong answer — answering the SMS
      // challenge with quiz answers should not burn one of two SMS attempts. Re-state the
      // challenge the member is actually on and spend nothing.
      if (submission.kind !== state.challenge.kind) {
        return { outcome: 'retry', challenge: state.challenge };
      }

      if (submission.kind === 'sms') {
        if (submission.code === MOCK_IDV_SMS_PASS_CODE) {
          state.verifiedAt = now.toISOString();
          return { outcome: 'pass', verifiedAt: state.verifiedAt };
        }

        const attemptsRemaining = state.challenge.attemptsRemaining - 1;

        // Out of SMS attempts moves the member to the quiz rather than locking. Only the quiz
        // allowance running out is a lockout; SMS exhaustion is the ordinary path for the ~40% of
        // users the real SMS step never qualifies in the first place.
        state.challenge =
          attemptsRemaining > 0
            ? {
                kind: 'sms',
                attemptsRemaining,
                // The window restarts because a retry re-sends a code, which is what the real
                // renew-code step does.
                expiresAt: isoAfterSeconds(now, CRS_MOBILE_VERIFICATION_TTL_SECONDS),
              }
            : quizChallenge(now);

        return { outcome: 'retry', challenge: state.challenge };
      }

      if (quizAnswersMatch(submission.answers)) {
        state.verifiedAt = now.toISOString();
        return { outcome: 'pass', verifiedAt: state.verifiedAt };
      }

      const attemptsRemaining = state.challenge.attemptsRemaining - 1;

      if (attemptsRemaining <= 0) {
        state.challenge = {
          kind: 'quiz',
          attemptsRemaining: 0,
          expiresAt: state.challenge.expiresAt,
          questionCount: MOCK_IDV_QUIZ.questionCount,
        };
        state.lockedUntil = isoAfterHours(now, CRS_IDV_LOCKOUT_HOURS);
        // Lane B owns what a lockout means commercially — the enrollment parks and NOTHING is
        // charged. This driver reports the outcome and takes no other action.
        return { outcome: 'locked', lockedUntil: state.lockedUntil };
      }

      state.challenge = {
        kind: 'quiz',
        attemptsRemaining,
        expiresAt: state.challenge.expiresAt,
        questionCount: MOCK_IDV_QUIZ.questionCount,
      };
      return { outcome: 'retry', challenge: state.challenge };
    },

    async getPreauthToken(memberRef: CrsMemberRef): Promise<PreauthToken> {
      const now = deps.clock.now();
      tokenSequence += 1;

      // Two calls never return the same string. CRS does not state whether a preauth token is
      // single-use, so the mock takes the stricter reading: a caller that reuses a token it
      // already redeemed should not be able to get away with it here and then fail against
      // sandbox. The string is transparently synthetic — it names the driver, the member and the
      // issue number in plain text — so it could not be mistaken for a real token in a log,
      // a screenshot or a support ticket.
      return {
        token: `mock-preauth-token-${memberRef}-${tokenSequence}`,
        expiresAt: isoAfterSeconds(now, CRS_PREAUTH_TOKEN_TTL_SECONDS),
        ttlSeconds: CRS_PREAUTH_TOKEN_TTL_SECONDS,
      };
    },

    async getLatestScores(memberRef: CrsMemberRef): Promise<readonly ObservedCreditScore[]> {
      const persona = personaFromMemberRef(memberRef);
      const observedAt = deps.clock.now().toISOString();
      return SCORES_BY_PERSONA[persona].map((score, index) => ({
        bureau: CRS_BUREAU_CODES[index],
        model: 'VANTAGE',
        observedAt,
        score,
      }));
    },

    async closeMember(memberRef: CrsMemberRef): Promise<{ closedAt: string }> {
      // Idempotent per the frozen contract: closing a closed member resolves with the ORIGINAL
      // instant rather than throwing or restamping. The cancel flow can be retried, and a retry
      // that moved `closedAt` forward would move the derived-data purge deadline with it.
      const existing = closedAtByMemberRef.get(memberRef);
      if (existing !== undefined) return { closedAt: existing };

      const closedAt = deps.clock.now().toISOString();
      closedAtByMemberRef.set(memberRef, closedAt);
      return { closedAt };
    },

    async pauseMember(): Promise<{ pausedAt: string }> {
      return { pausedAt: deps.clock.now().toISOString() };
    },

    async resumeMember(): Promise<{ resumedAt: string }> {
      return { resumedAt: deps.clock.now().toISOString() };
    },

    async softPull(
      memberRef: CrsMemberRef,
      reportCodes: ReportCode[],
    ): Promise<SoftPullReport> {
      const persona = personaFromMemberRef(memberRef);
      const now = deps.clock.now();

      // Build the same normalized per-bureau envelope the sandbox boundary derives from CRS v3
      // `providerViews`; callers never depend on the provider's raw report shape.
      const requestedBureaus = reportCodes.map((code) => BUREAU_BY_REPORT_CODE[code]);
      const body = buildMockReportBody(persona, requestedBureaus, now);

      return sealReport({
        // The bureaus that actually produced a record, which is empty for `no_hit` — a caller
        // must be able to tell "asked three, got nothing" from "asked none".
        bureaus: body.perBureau.map((record) => record.bureau),
        reportCodes: [...reportCodes],
        pulledAt: now.toISOString(),
        body,
      });
    },

    verifyAndParseWebhook(input: { headers: Headers; rawBody: string }): CrsWebhookParse {
      // Delegated, never reimplemented. Both drivers reject a forged request for the same reason
      // through the same code, which is the only thing that makes plan 04-07's cross-driver
      // contract suite mean anything. The two fields are named rather than spread so nothing else
      // a caller attached can ride into the verifier.
      return verifyAndParseWebhookImpl({
        headers: input.headers,
        rawBody: input.rawBody,
        config: deps.webhookConfig,
      });
    },
  };
}
