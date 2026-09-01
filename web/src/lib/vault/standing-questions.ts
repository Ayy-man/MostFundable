import type { BankApplicationQuestion } from "./types.ts";

/**
 * §6: the per-bank application table's rows vary by bank but *always* include
 * these four. They are prepended by the sync core rather than by each driver,
 * so a driver cannot omit them and a lender cannot displace them.
 *
 * The wording is copied character for character from
 * `web/src/lib/demo/co-fixtures.ts` `STANDING_APPLICATION_QUESTIONS`, which
 * shipped with the frontend freeze on 2026-08-18 and has been through the
 * compliance gate there. `standing-questions.test.ts` asserts the two stay
 * identical, so the durable path and the fixture path can never drift into
 * showing a reader two different sentences for the same question.
 */
export const STANDING_APPLICATION_QUESTIONS: readonly BankApplicationQuestion[] = Object.freeze([
  {
    id: "projected-revenue",
    label: "Projected revenue",
    responseBasis: "Use the business's own current revenue projection and supporting records.",
  },
  {
    id: "projected-personal-income",
    label: "Projected personal income",
    responseBasis: "Use the applicant's own current income projection and supporting records.",
  },
  {
    id: "projected-monthly-spend",
    label: "Projected monthly spend",
    responseBasis: "Use the business's own current operating-budget projection.",
  },
  {
    id: "projected-employees",
    label: "Projected # employees",
    responseBasis: "Use the business's own current staffing projection.",
  },
]);

export const STANDING_QUESTION_IDS: readonly string[] = Object.freeze(
  STANDING_APPLICATION_QUESTIONS.map((question) => question.id),
);

/**
 * The four standing questions, then whatever the lender adds — with anything
 * that would collide with a standing id dropped, because the surface keys its
 * rows on the id and a duplicate would render two rows under one key.
 */
export function withStandingQuestions(
  extras: readonly BankApplicationQuestion[],
): BankApplicationQuestion[] {
  const seen = new Set<string>(STANDING_QUESTION_IDS);
  const composed = [...STANDING_APPLICATION_QUESTIONS];
  for (const question of extras) {
    if (seen.has(question.id)) continue;
    seen.add(question.id);
    composed.push(question);
  }
  return composed;
}
