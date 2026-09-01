/**
 * VAULT-05 at the value level.
 *
 * The exclusion is usually described as a column rule — `banks_cache` has no
 * `fico_*` or `tib_*` column, and a pgTAP test reads the live catalog to prove
 * it. That protects the schema and nothing else. VAULT's free-text fields are
 * written by the client's own team, and the ones this sync reads
 * (`brm_notes`, `how_to_get_handoff`, the two requirement strategies,
 * `timing_notes`) routinely state score floors and time-in-business minimums in
 * prose. Every one of them lands in a column the operator detail page renders,
 * so without this filter the excluded criteria reach the page in sentence form
 * having never touched an excluded column.
 *
 * The platform copy rules do not catch this class — `vault05-text.test.ts`
 * proves that against the shared rule module rather than assuming it — so the
 * check is its own module, applied in `toCacheRow` before the copy rules, on
 * every free-text field both drivers feed.
 *
 * It errs toward refusal. A refused string is dropped whole and the field
 * renders as unrecorded, which costs the operator a line of context; a leaked
 * floor is a criterion this product is not allowed to publish. Those are not
 * comparable, so the patterns below are deliberately broad and the false
 * positives are acceptable.
 */

/** Spelled-out durations VAULT writes as often as digits. */
const SPELLED_NUMBER =
  "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|eighteen|twenty|twenty[-\\s]?four|thirty|thirty[-\\s]?six";

const DURATION = new RegExp(
  `\\b(?:\\d{1,3}|${SPELLED_NUMBER})\\s*\\+?\\s*(?:\\+\\s*)?(?:years?|yrs?|months?|mos?)\\b`,
  "i",
);

/**
 * Words that make a duration a statement about how long the business has
 * existed rather than about anything else. A checking-account seasoning of
 * "About 6 months" carries none of them and survives, which is the distinction
 * that keeps this filter from emptying §6's checking block.
 */
const TENURE_CONTEXT = /\b(business|biz|trading|traded|operating|operation|entity|company|incorporated|established|doors\s+open|in\s+existence)\b/i;

/** Named ways of saying time in business, which need no duration beside them. */
const TENURE_TERMS: readonly RegExp[] = [
  /\btib\b/i,
  /\btime[-\s]?in[-\s]?business\b/i,
  /\b(?:months?|years?|yrs?|mos?)\s+in\s+(?:business|biz|operation)\b/i,
  /\boperating\s+history\b/i,
  /\bbusiness\s+age\b/i,
  /\bage\s+of\s+(?:the\s+)?business\b/i,
  /\byears?\s+established\b/i,
];

/** Named ways of saying a credit-score value, floor or cutoff. */
const SCORE_TERMS: readonly RegExp[] = [
  /\bfico\b/i,
  /\bvantage(?:\s*score)?\b/i,
  /\bbeacon\s*score\b/i,
  /\bcredit\s+score\b/i,
  /\bcredit\s+(?:floor|cutoff|cut[-\s]?off|minimum|min\b|threshold|requirement)/i,
  /\bscore\s+(?:floor|cutoff|cut[-\s]?off|minimum|min\b|threshold|requirement|of\b)/i,
  /\b(?:minimum|min|floor|cutoff|cut[-\s]?off|threshold)\s+(?:credit\s+)?score\b/i,
  /\b\d{3}\s*\+?\s*(?:credit\s+)?score\b/i,
  /\bscore\s*(?:of|:|is|at)?\s*\d{3}\b/i,
  /\bmid[-\s](?:four|five|six|seven|eight)\s+hundreds\b/i,
  /\bpersonal\s+credit\s+(?:floor|minimum|cutoff|requirement)/i,
];

/**
 * True when the string states, or plainly implies, a credit-score criterion or
 * a time-in-business criterion. Callers null the field on a true.
 */
export function mentionsExcludedCriteria(value: string | null | undefined): boolean {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  const text = value.trim();

  for (const pattern of SCORE_TERMS) if (pattern.test(text)) return true;
  for (const pattern of TENURE_TERMS) if (pattern.test(text)) return true;

  // The general case: a duration standing next to something that makes it a
  // statement about the business itself. "Business must be trading 3+ years"
  // names no term above but says exactly the excluded thing.
  return DURATION.test(text) && TENURE_CONTEXT.test(text);
}
