import {
  IDV_LOCK_DURATION_HOURS,
  MAX_IDV_ATTEMPTS,
  MOCK_QUIZ_ALTERNATE_ANSWER,
  MOCK_SMS_CODE,
  mockQuizAnswer,
} from "@/lib/idv/config";
import type {
  CrsMemberRef,
  IdvAdapter,
  IdvChallengeState,
  IdvSubmission,
  IdvSubmitRequest,
} from "@/lib/idv/types";

const HOUR_MS = 60 * 60 * 1000;
const CHALLENGE_TTL_MS = 15 * 60 * 1000;
const ALTERNATE_QUIZ_ANSWER = MOCK_QUIZ_ALTERNATE_ANSWER;

function challenge(
  kind: IdvChallengeState["kind"],
  attemptsRemaining: number,
): IdvChallengeState {
  return {
    kind,
    attemptsRemaining,
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
    ...(kind === "quiz" ? { questionCount: 1 } : {}),
  };
}

function submittedQuizAnswer(submission: IdvSubmission): string | undefined {
  if (submission.kind !== "quiz") return undefined;
  return submission.answers[0]?.answerId;
}

/**
 * The option that grades as correct for this submission.
 *
 * The client's own `business_name` when the caller supplies one — the same
 * `mockQuizAnswer` derivation the browser builds its option list from, so the
 * two agree without either transcribing a string. Only when no row is supplied
 * does the deterministic-persona arm apply: `IDV_MOCK_PERSONA=alternate` still
 * selects the second fixture, exactly as before.
 */
function expectedQuizAnswer(req: IdvSubmitRequest): string {
  const named = req.businessName?.trim();
  if (named) return mockQuizAnswer(named);
  return process.env.IDV_MOCK_PERSONA?.trim().toLowerCase() === "alternate"
    ? ALTERNATE_QUIZ_ANSWER
    : mockQuizAnswer(null);
}

export function createMockIdvAdapter(): IdvAdapter {
  return {
    async close() {},
    async pause() {},
    async resume() {},
    async start(req) {
      return {
        memberRef: `mock_clean_${parseInt(req.enrollmentId.replace(/-/g, "").slice(0, 8), 16)}` as CrsMemberRef,
        idpass: false,
        challenge: challenge("sms", MAX_IDV_ATTEMPTS),
      };
    },

    async submit(req) {
      if (req.submission.kind === "sms") {
        if (req.submission.code === MOCK_SMS_CODE) {
          return { outcome: "pass", verifiedAt: new Date().toISOString() };
        }

        return {
          outcome: "retry",
          challenge: challenge("quiz", req.maxAttempts - req.attemptsUsed),
        };
      }

      if (submittedQuizAnswer(req.submission) === expectedQuizAnswer(req)) {
        return { outcome: "pass", verifiedAt: new Date().toISOString() };
      }

      const attemptsUsed = req.attemptsUsed + 1;
      if (attemptsUsed < req.maxAttempts) {
        return {
          outcome: "retry",
          challenge: challenge("quiz", req.maxAttempts - attemptsUsed),
        };
      }

      return {
        outcome: "locked",
        lockedUntil: new Date(
          Date.now() + IDV_LOCK_DURATION_HOURS * HOUR_MS,
        ).toISOString(),
      };
    },
  };
}
