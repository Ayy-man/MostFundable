// D-20 keeps the lockout policy in one module. D-47 keeps the mock-only code
// available for a driver-gated UI hint without duplicating it in a component.
export const MAX_IDV_ATTEMPTS = 2;
export const IDV_LOCK_DURATION_HOURS = 72;
export const MOCK_SMS_CODE = "246810";

// The knowledge-quiz catalog, here for the same reason MOCK_SMS_CODE is: the
// browser has to render the option list, the mock has to grade it, and when the
// two were written out separately they drifted.
//
// The remaining drift was the graded answer itself. It was the literal "Okafor
// Design Co" — the fixture persona's company — so the question "Which business
// is associated with this application?" put a stranger's company in front of a
// signed-in consumer and called it the right answer, on the one screen where the
// product is asking them to prove who they are. The answer is now derived from
// the client's own `business_name`, which `readEnrollmentState` reads from the
// same `clients` row it already joins, and the option list is built around that
// answer so both sides agree by construction.
//
// `mockQuizAnswer` is the single derivation: the browser calls it to build the
// options and the mock calls it to grade, on the same input. Nothing here
// touches the state machine — the pass/retry/lock transitions and the
// two-attempt budget are the mock's and are unchanged.
export const MOCK_QUIZ_QUESTION_ID = "business-association";
/**
 * The graded option when no business name is recorded on the client row.
 *
 * It has to be a real option a person can pick and pass with, and it has to be
 * true: a client with no business on file is exactly what it says.
 */
export const MOCK_QUIZ_NO_BUSINESS_ANSWER = "No business is recorded on this application";
/** Kept for `IDV_MOCK_PERSONA=alternate`, which selects a second deterministic fixture. */
export const MOCK_QUIZ_ALTERNATE_ANSWER = "Northstar Property Group";
/** Tied to no persona in any roster, so no option names a real person's neighbour. */
export const MOCK_QUIZ_DECOYS: readonly string[] = [
  "Cedarline Supply Co",
  "Harborline Trading Co",
];

/** The option that grades as correct for this client, derived from their own row. */
export function mockQuizAnswer(businessName?: string | null): string {
  const named = businessName?.trim();
  return named ? named : MOCK_QUIZ_NO_BUSINESS_ANSWER;
}

/** The option list the browser renders: this client's answer plus the fixed decoys. */
export function mockQuizOptions(businessName?: string | null): readonly string[] {
  const answer = mockQuizAnswer(businessName);
  return [answer, ...MOCK_QUIZ_DECOYS.filter((decoy) => decoy !== answer)];
}
