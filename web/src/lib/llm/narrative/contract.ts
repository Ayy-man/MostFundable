/**
 * Plan-engine v2 contract: rules compute facts, a model writes prose.
 *
 * This file is the seam between the two halves and is deliberately dependency-free. The rules
 * layer (`analysis/features.ts`, `llm/checklist-seeds.ts`, `llm/evaluator.ts`) produces a
 * `FactsPackV2` from a `DerivedFeatures` and a `FundingReadinessPlanV1`. The narrative layer
 * (`llm/narrative/*`) turns a `FactsPackV2` into a `NarrativeV1` and proves, deterministically,
 * that every number in the prose came from the pack. Nothing in the narrative may change a fact.
 *
 * The ten personal items are the founder's "Final Funding Checklist" (Personal Credit section),
 * in his order. The seven business items are unchanged from v1.
 */

export const PERSONAL_ITEM_KEYS_V2 = [
  'credit_score_700',
  'personal_information_confirmed',
  'clean_report',
  'utilization_under_30',
  'four_personal_accounts_open',
  'average_age_two_years',
  'no_late_payments',
  'no_negative_items_reported',
  'personal_card_ten_k_limit',
  'inquiries_within_bureau_limit',
] as const;
export type PersonalItemKeyV2 = (typeof PERSONAL_ITEM_KEYS_V2)[number];

export const BUSINESS_ITEM_KEYS_V2 = [
  'business_name_confirmed',
  'industry_classification_confirmed',
  'business_entity_age_confirmed',
  'net_asset_value_confirmed',
  'business_identifier_present',
  'business_email_present',
  'business_website_present',
] as const;
export type BusinessItemKeyV2 = (typeof BUSINESS_ITEM_KEYS_V2)[number];

/** Consumer-facing titles, one per item. State language only, never a repair instruction. */
export const PERSONAL_ITEM_TITLES_V2: Readonly<Record<PersonalItemKeyV2, string>> = Object.freeze({
  credit_score_700: 'Credit score is 700 or higher',
  personal_information_confirmed: 'Personal information is correct (name and addresses)',
  clean_report: 'Report is clean (no extra addresses or employers listed)',
  utilization_under_30: 'Every personal credit card is under 30% utilization',
  four_personal_accounts_open: 'Four or more personal credit accounts are open',
  average_age_two_years: 'Average account age is two years or more',
  no_late_payments: 'No late payments reported',
  no_negative_items_reported: 'No negative items (bankruptcy, collections, charge-offs)',
  personal_card_ten_k_limit: 'At least one personal card has a $10,000 or higher limit',
  inquiries_within_bureau_limit: 'No more than two inquiries on each bureau',
});

/**
 * `verified`      the latest evidence satisfies the item.
 * `unverified`    the latest evidence does not satisfy it, and `gap` says why.
 * `not_checkable` no evidence source covers it yet (for example, a single-bureau pull cannot
 *                 cross-check addresses); the consumer's own confirmation is the only path.
 */
export type FactStateV2 = 'verified' | 'unverified' | 'not_checkable';

/**
 * One checklist item as a fact: what was observed, what the target is, and the gap in words.
 * `observed` holds only numbers, short enum strings, and nulls; never a name or a raw identifier.
 * Every number the narrative is allowed to mention must appear somewhere in a fact's `observed`,
 * in `accounts`, `inquiries`, `scores`, or the pack's top-level counts.
 */
export interface FactV2 {
  readonly key: PersonalItemKeyV2 | BusinessItemKeyV2;
  readonly state: FactStateV2;
  readonly observed: Readonly<Record<string, number | string | boolean | null>>;
  /** The target in the founder's words, e.g. "under 30% on every card". */
  readonly target: string;
  /** Null when verified or not checkable. Otherwise a one-line factual gap with the numbers. */
  readonly gap: string | null;
}

export interface AccountFactV2 {
  /** Stable within one run only, e.g. "account-3". Never a real account number. */
  readonly accountRef: string;
  /** Creditor display name as reported (e.g. "DISCOVER"), or null when not present. */
  readonly label: string | null;
  readonly kind: 'revolving' | 'installment' | 'mortgage' | 'other';
  readonly isOpen: boolean;
  readonly isNegative: boolean;
  readonly balanceCents: number;
  readonly limitCents: number | null;
  readonly utilizationPct: number | null;
  readonly ageMonths: number | null;
  /** True when a 30/60/90-day late is reported in the last 24 months. */
  readonly lateWithin24Months: boolean;
  readonly pastDueCents: number;
}

export interface InquiryFactV2 {
  readonly inquiryRef: string;
  readonly bureau: 'EQF' | 'EXP' | 'TUC';
  readonly monthsAgo: number;
  /** The founder's 45-day rule: an inquiry with no account opened within 45 days of it has no matching account and can be reviewed. */
  readonly matchedNewAccountWithin45Days: boolean;
}

export interface ScoreFactV2 {
  readonly bureau: 'EQF' | 'EXP' | 'TUC';
  /** Model family as reported, e.g. "VANTAGE". Consumers are told which it is; FICO 8 is what banks use. */
  readonly model: string;
  readonly score: number;
}

export interface FactsPackV2 {
  readonly schemaVersion: 2;
  readonly computedAt: string;
  readonly bureausPulled: readonly ('EQF' | 'EXP' | 'TUC')[];
  /** 0-100, the plan's readinessScore; unchanged by the narrative. */
  readonly readinessScore: number;
  readonly readinessLabel: 'Ready' | 'Near Ready' | 'Building Readiness';
  /** Founder-style "X items to fix": personal items whose state is `unverified`. */
  readonly itemsToFix: number;
  /** "X/10": personal items whose state is `verified`. */
  readonly personalVerifiedCount: number;
  readonly personal: readonly FactV2[];
  readonly business: readonly FactV2[];
  readonly accounts: readonly AccountFactV2[];
  readonly inquiries: readonly InquiryFactV2[];
  readonly scores: readonly ScoreFactV2[];
  readonly identity: {
    readonly namesOnFile: number | null;
    readonly addressesOnFile: number | null;
    readonly employersOnFile: number | null;
  };
  readonly overallUtilizationPct: number | null;
  readonly averageAgeMonths: number | null;
  readonly highestRevolvingLimitCents: number | null;
  readonly openAccountsCount: number;
  readonly negativesCount: number;
  readonly inquiriesByBureau: Readonly<Record<'EQF' | 'EXP' | 'TUC', number>>;
}

/** Bounded timeline vocabulary, the bands the founder actually uses. */
export const NARRATIVE_TIMELINE_BANDS_V1 = [
  '7-30 days',
  '30-60 days',
  '60-120 days',
  '3-6 months',
  '6-12 months',
] as const;
export type NarrativeTimelineBandV1 = (typeof NARRATIVE_TIMELINE_BANDS_V1)[number];

export interface NarrativeStepV1 {
  /** Short imperative title, e.g. "Pay the Discover down to $1,500". */
  readonly title: string;
  /** One to three sentences with the concrete target number. */
  readonly detail: string;
  /** The item this step moves; lets the surface link step to factor. */
  readonly itemKey: PersonalItemKeyV2 | BusinessItemKeyV2 | null;
}

/**
 * What the model writes. Every field is prose about the facts; none of them is a fact.
 * The grounding checker rejects a narrative whose numbers do not all appear in the pack,
 * whose text trips the compliance language rules, or that names a lender or product.
 */
export interface NarrativeV1 {
  readonly schemaVersion: 1;
  /** Mirrors the founder's "Funding Status" line, e.g. "Not ready yet. 4 items to fix." */
  readonly verdict: string;
  /** 2-4 sentences: why the score is what it is and the single biggest thing holding it back. */
  readonly whereYouStand: string;
  /** 1-3 steps, highest impact first. */
  readonly nextSteps: readonly NarrativeStepV1[];
  /** One sentence per personal item that is not verified: fact, target, gap for this person. */
  readonly itemNotes: Readonly<Partial<Record<PersonalItemKeyV2, string>>>;
  /** 1-2 sentences on what the business checklist still needs and who supplies it. */
  readonly businessSide: string;
  readonly timeline: { readonly band: NarrativeTimelineBandV1; readonly reason: string };
  readonly generation: { readonly driver: 'mock' | 'openrouter'; readonly model: string; readonly promptVersion: number };
}

export const NARRATIVE_PROMPT_KEY = 'funding-readiness-narrative' as const;
