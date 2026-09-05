import { itemsToFix, personalVerifiedCount } from '../evaluator.ts';
import { BUSINESS_CHECKLIST_V1, PERSONAL_CHECKLIST_V1 } from '../checklist-seeds.ts';
import { PERSONAL_ITEM_TITLES_V2 } from './contract.ts';
import type { DerivedFeatures } from '../../analysis/features.ts';
import type { FundingReadinessPlanV1 } from '../types.ts';
import type { FactStateV2, FactV2, FactsPackV2, PersonalItemKeyV2 } from './contract.ts';

// Each target spells its number as a digit, because `grounding.ts` grounds prose against the
// numbers the pack carries and a verified item carries no gap line: with "two years or more" the
// 24 in "against a 24-month target" was ungrounded on every fully-verified file (measured
// 2026-09-05, Sonnet 5 on two of twenty scenarios), while the prompt's own house style writes it.
const TARGET: Readonly<Record<PersonalItemKeyV2, string>> = {
  credit_score_700: '700 or higher',
  personal_information_confirmed: 'consumer confirmation of correct name and addresses',
  clean_report: 'no employers and no more than 1 address',
  utilization_under_30: 'under 30% on every card',
  four_personal_accounts_open: '4 or more open personal accounts',
  average_age_two_years: '24 months (two years) or more',
  no_late_payments: 'no late payments reported',
  no_negative_items_reported: 'no negative items, collections, or public records',
  personal_card_ten_k_limit: 'at least one $10,000 or higher card limit',
  inquiries_within_bureau_limit: '2 or fewer inquiries on each bureau',
};
function dollars(cents: number): string { return `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`; }
function personalState(features: DerivedFeatures, key: PersonalItemKeyV2, plan: FundingReadinessPlanV1): FactStateV2 {
  const seed = PERSONAL_CHECKLIST_V1.find((item) => item.key === key);
  if (seed?.evidenceFlag !== null && seed?.evidenceFlag !== undefined && typeof features.flags[seed.evidenceFlag] !== 'boolean') return 'not_checkable';
  return plan.personalChecklist.find((item) => item.key === key)?.state === 'verified' ? 'verified' : 'unverified';
}
function gap(features: DerivedFeatures, key: PersonalItemKeyV2): string | null {
  const accounts = features.accounts;
  switch (key) {
    case 'credit_score_700': { const lowest = features.scores?.length ? Math.min(...features.scores.map((score) => score.score)) : null; return lowest === null ? 'No bureau score was reported; the target is 700 or higher.' : `Lowest pulled bureau score is ${lowest}, below the 700 target.`; }
    case 'personal_information_confirmed': return 'Personal information needs consumer confirmation against the report.';
    case 'clean_report': return `${features.identity?.addressesOnFile ?? 0} addresses and ${features.identity?.employersOnFile ?? 0} employers are reported; the target is one address and no employers.`;
    case 'utilization_under_30': { const account = accounts.find((item) => item.isOpen && item.kind === 'revolving' && item.limitCents !== null && (item.utilizationPct ?? 100) >= 30); if (account === undefined || account.limitCents === null) return 'No open revolving account with a limit was reported; the target is under 30% on every card.'; const name = account.label ?? account.accountRef; return `${name} is ${dollars(account.balanceCents)} on a ${dollars(account.limitCents)} limit = ${account.utilizationPct}%, above the 30% target.`; }
    case 'four_personal_accounts_open': return `${accounts.filter((item) => item.isOpen).length} personal accounts are open, below the target of 4.`;
    case 'average_age_two_years': return `Average account age is ${features.averageAgeMonths ?? 0} months, below the 24-month target.`;
    case 'no_late_payments': return `${features.lateAccountsCount ?? 0} accounts have a late payment within 24 months; the target is 0.`;
    case 'no_negative_items_reported': return `${features.negativesCount} negative accounts, ${features.collectionsCount ?? 0} collections, and ${features.publicRecordsCount ?? 0} public records are reported; the target is 0.`;
    case 'personal_card_ten_k_limit': return `Highest revolving limit is ${dollars(features.highestRevolvingLimitCents ?? 0)}, below the ${dollars(1_000_000)} target.`;
    case 'inquiries_within_bureau_limit': return `${Math.max(0, ...Object.values(features.inquiriesByBureau))} inquiries are reported at the highest bureau, above the target of 2.`;
  }
}
function personalFact(features: DerivedFeatures, key: PersonalItemKeyV2, plan: FundingReadinessPlanV1): FactV2 {
  const state = personalState(features, key, plan);
  const observed: Record<string, number | string | boolean | null> = { title: PERSONAL_ITEM_TITLES_V2[key] };
  if (key === 'credit_score_700') observed.lowestScore = features.scores?.length ? Math.min(...features.scores.map((score) => score.score)) : null;
  if (key === 'clean_report') { observed.addressesOnFile = features.identity?.addressesOnFile ?? null; observed.employersOnFile = features.identity?.employersOnFile ?? null; }
  if (key === 'average_age_two_years') observed.averageAgeMonths = features.averageAgeMonths;
  if (key === 'four_personal_accounts_open') observed.openAccountsCount = features.accounts.filter((item) => item.isOpen).length;
  if (key === 'no_late_payments') observed.lateAccountsCount = features.lateAccountsCount ?? null;
  if (key === 'no_negative_items_reported') { observed.negativesCount = features.negativesCount; observed.collectionsCount = features.collectionsCount ?? null; observed.publicRecordsCount = features.publicRecordsCount ?? null; }
  return { key, state, observed, target: TARGET[key], gap: state === 'unverified' ? gap(features, key) : null };
}

/** The narrative boundary: only this bounded, identifier-free projection reaches a model. */
/**
 * The under-30% target for one card, and the distance to it, both in whole dollars of cents.
 *
 * Whole dollars because that is the unit the narrative speaks in — `serializeFactsPack` divides
 * every `…Cents` key by 100 before the model sees it, and a target of $1,499.50 would render as
 * $1,500 and stop being the number that clears the item. Flooring to the dollar keeps the rendered
 * figure true: pay the amount the narrative names and the card is under the target, not on it.
 */
function paydown(balanceCents: number, limitCents: number | null): { targetBalanceCents: number | null; paydownCents: number | null } {
  if (limitCents === null || limitCents <= 0) return { targetBalanceCents: null, paydownCents: null };
  const targetBalanceCents = Math.floor((limitCents * 0.29) / 100) * 100;
  return { targetBalanceCents, paydownCents: Math.max(0, balanceCents - targetBalanceCents) };
}

export function buildFactsPack(features: DerivedFeatures, plan: FundingReadinessPlanV1): FactsPackV2 {
  const personal = PERSONAL_CHECKLIST_V1.map((seed) => personalFact(features, seed.key as PersonalItemKeyV2, plan));
  const business = BUSINESS_CHECKLIST_V1.map((seed) => ({ key: seed.key, state: 'not_checkable' as const, observed: {}, target: seed.title, gap: null }));
  return { schemaVersion: 2, computedAt: features.computedAt, bureausPulled: features.bureausPulled, readinessScore: plan.readinessScore, readinessLabel: plan.readinessLabel, itemsToFix: itemsToFix(features), personalVerifiedCount: personalVerifiedCount(features), personal, business, accounts: features.accounts.map((account) => ({ accountRef: account.accountRef, label: account.label ?? null, kind: account.kind, isOpen: account.isOpen, isNegative: account.isNegative, balanceCents: account.balanceCents, limitCents: account.limitCents, utilizationPct: account.utilizationPct, ageMonths: account.ageMonths, lateWithin24Months: account.lateWithin24Months ?? false, pastDueCents: account.pastDueCents ?? 0, ...paydown(account.balanceCents, account.limitCents) })), inquiries: features.inquiries ?? [], scores: features.scores ?? [], identity: features.identity ?? { namesOnFile: null, addressesOnFile: null, employersOnFile: null }, overallUtilizationPct: features.overallUtilizationPct, averageAgeMonths: features.averageAgeMonths, highestRevolvingLimitCents: features.highestRevolvingLimitCents, openAccountsCount: features.accounts.filter((item) => item.isOpen).length, negativesCount: features.negativesCount, inquiriesByBureau: features.inquiriesByBureau };
}
