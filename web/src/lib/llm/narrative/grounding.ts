/**
 * The deterministic gate every narrative passes before it reaches a consumer.
 *
 * A model wrote the prose, so nothing in it is trusted. `checkNarrative` re-derives, from the
 * facts pack alone, what the narrative was allowed to say, and refuses anything else. It is pure:
 * same narrative and same pack, same codes, no clock, no network, no environment. That is what
 * lets it run twice — once inside the engine as the gate, once as recorded evaluator evidence —
 * and mean the same thing both times.
 *
 * The six codes, and the failure each one exists for:
 *
 *   NARRATIVE_SCHEMA     the object is not a `NarrativeV1` — a missing field, a band outside the
 *                        vocabulary, a step count outside 1-3, a field over its cap.
 *   NUMBER_UNGROUNDED    a number in the prose is not in the pack. This is the code that stops the
 *                        interesting failure: a model that computes "you need $2,700 more" from two
 *                        pack numbers has written a fact the rules never decided, and a fact the
 *                        rules never decided is exactly what this layer is not allowed to produce.
 *   LANGUAGE             the shared compliance vocabulary fired. The rules live in
 *                        `compliance/language-rules.mjs` and are reused rather than restated, so a
 *                        term added there reaches this gate the same day.
 *   LENDER_NAMED         a bank or card brand appears that the pack's own account labels do not
 *                        carry. A creditor label the pack supplies is fine — the founder names the
 *                        account on the file; a brand the model reached for from its own weights is
 *                        not, because nothing on the file said it.
 *   ITEM_NOTE_MISMATCH   the per-item notes do not correspond exactly to the unverified personal
 *                        items. A note on a verified item contradicts the rules, and a missing note
 *                        leaves a factor row with nothing to say.
 *   STEP_ITEM_UNKNOWN    a step points at a checklist item the pack does not carry, so the surface
 *                        cannot link the step to a factor.
 *   VERDICT_LABEL        the verdict does not open with the pack's own `readinessLabel`. The label
 *                        is a rules decision — three fixed strings, chosen from the score — and the
 *                        verdict is the one line where the consumer reads it back. A model that
 *                        opens with "Not ready yet" where the rules said "Building Readiness" has
 *                        quietly restated a verdict it was not asked to reach, and the surface's
 *                        headline then disagrees with the status shown beside it.
 *
 * Codes come back sorted and deduplicated; `approved` is simply "no codes".
 */

import { complianceLanguageCodes } from '../../compliance/language-rules.mjs';
import { NARRATIVE_FIELD_LIMITS_V1 } from './prompt.ts';
import { NARRATIVE_TIMELINE_BANDS_V1, PERSONAL_ITEM_KEYS_V2 } from './contract.ts';

import type { FactsPackV2, NarrativeV1 } from './contract.ts';

export const NARRATIVE_CHECK_CODES = Object.freeze([
  'NARRATIVE_SCHEMA',
  'NUMBER_UNGROUNDED',
  'LANGUAGE',
  'LENDER_NAMED',
  'ITEM_NOTE_MISMATCH',
  'STEP_ITEM_UNKNOWN',
  'VERDICT_LABEL',
] as const);
export type NarrativeCheckCode = (typeof NARRATIVE_CHECK_CODES)[number];

export interface NarrativeCheckResult {
  approved: boolean;
  codes: string[];
}

/**
 * Brand words that may only appear when the pack's own account labels carry them.
 *
 * Short and lower-cased on purpose: this is a refusal list for the names a model reaches for
 * unprompted, not an attempt at a registry of every institution in the country. A brand nobody's
 * model volunteers costs nothing to leave out, and the pack-label exemption below is what keeps
 * the list from censoring the consumer's own file.
 */
export const LENDER_DENYLIST = Object.freeze([
  'american express',
  'amex',
  'bank of america',
  'barclays',
  'capital one',
  'chase',
  'citi',
  'citibank',
  'credit one',
  'discover',
  'fifth third',
  'jpmorgan',
  'mastercard',
  'navy federal',
  'pnc',
  'synchrony',
  'truist',
  'us bank',
  'usaa',
  'visa',
  'wells fargo',
] as const);

const TIMELINE_BANDS: ReadonlySet<string> = new Set(NARRATIVE_TIMELINE_BANDS_V1);
const PERSONAL_KEYS: ReadonlySet<string> = new Set(PERSONAL_ITEM_KEYS_V2);

/** Digits with optional thousands separators and an optional fractional part. */
const NUMBER_TOKEN = /\d[\d,]*(?:\.\d+)?/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= limit;
}

/**
 * One number, one canonical string.
 *
 * Thousands separators are stripped and a trailing `.0` is dropped, so `4,200`, `4200` and
 * `4200.00` all reduce to `4200` and the comparison never turns on how the model chose to punctuate.
 */
function canonicalNumber(raw: string): string | null {
  const stripped = raw.replace(/,/g, '');
  const value = Number(stripped);
  if (!Number.isFinite(value)) return null;
  return Number.isInteger(value) ? String(value) : String(value);
}

function addNumber(allowed: Set<string>, value: number): void {
  if (!Number.isFinite(value)) return;
  allowed.add(String(value));
  // Both spellings, so a set built from the pack still matches prose that punctuated the same
  // number, even though `canonicalNumber` would have stripped the separators anyway. Cheap, and it
  // keeps the set readable when a failure has to be diagnosed from a log line.
  if (Number.isInteger(value)) allowed.add(value.toLocaleString('en-US'));
  const rounded = Math.round(value);
  if (rounded !== value) allowed.add(String(rounded));
}

function addStringNumbers(allowed: Set<string>, value: string): void {
  for (const match of value.matchAll(NUMBER_TOKEN)) {
    const canonical = canonicalNumber(match[0]);
    if (canonical !== null) allowed.add(canonical);
  }
}

/**
 * Every number the narrative is allowed to mention.
 *
 * The pack is walked whole rather than field by field, because a field-by-field list is a list that
 * goes stale the first time the rules half adds an observed value — and a stale list here reads as
 * the model hallucinating a number it was actually handed.
 *
 * Three things happen beyond the plain walk:
 *
 *   - a `…Cents` key contributes its whole-dollar value as well as its raw one, because the pack
 *     stores cents and the founder writes dollars;
 *   - numbers inside strings count, which is what makes a creditor label like "CHASE FREEDOM 2020"
 *     ground the 2020 the model repeats back, and what makes the targets ("under 30% on every
 *     card", "two years or more") ground the numbers the reader is being pointed at;
 *   - `computedAt` is skipped, because an ISO timestamp would otherwise ground a year, a month and
 *     a minute that mean nothing in this narrative.
 */
export function allowedNumbers(pack: FactsPackV2): ReadonlySet<string> {
  const allowed = new Set<string>();

  const walk = (value: unknown, key: string | null): void => {
    if (key === 'computedAt') return;
    if (typeof value === 'number') {
      addNumber(allowed, value);
      if (key !== null && /Cents$/.test(key)) addNumber(allowed, Math.round(value / 100));
      return;
    }
    if (typeof value === 'string') {
      addStringNumbers(allowed, value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, key);
      return;
    }
    if (isRecord(value)) {
      for (const [childKey, child] of Object.entries(value)) walk(child, childKey);
    }
  };

  walk(pack as unknown, null);

  // The founder's "X/10" is a count against the ten personal items, and the ten is a property of
  // the checklist rather than of any one consumer's file, so it is not in the pack to be walked.
  addNumber(allowed, PERSONAL_ITEM_KEYS_V2.length);
  // The readiness score's own scale. "62 out of 100" is the sentence the founder writes, and the
  // 100 in it is a property of the scoring rule rather than a number any one file carries.
  addNumber(allowed, 100);
  // How many of a thing the pack holds. "3 of the 7 business items are still open" counts rows the
  // pack supplied, so the count is as grounded as the rows; it is only absent from the walk above
  // because a length is not a field.
  for (const list of [pack.personal, pack.business, pack.accounts, pack.inquiries, pack.scores]) {
    addNumber(allowed, list.length);
  }
  // "First", "second", "third" written as digits in a step. At most three steps exist, so this
  // grounds an ordinal and nothing larger.
  for (const ordinal of [1, 2, 3]) addNumber(allowed, ordinal);
  // The founder's 45-day rule is the reason `matchedNewAccountWithin45Days` is on every inquiry.
  // The window is only mentionable when there is an inquiry to mention it about.
  if (pack.inquiries.length > 0) addNumber(allowed, 45);

  return allowed;
}

/** The prose fields, in the order a reader meets them. Nothing else is checked for numbers. */
function proseFields(narrative: NarrativeV1): string[] {
  return [
    narrative.verdict,
    narrative.whereYouStand,
    ...narrative.nextSteps.flatMap((step) => [step.title, step.detail]),
    ...Object.values(narrative.itemNotes).filter((note): note is string => typeof note === 'string'),
    narrative.businessSide,
    narrative.timeline.reason,
  ];
}

function schemaCodes(value: unknown): { codes: string[]; narrative: NarrativeV1 | null } {
  const fail = { codes: ['NARRATIVE_SCHEMA'], narrative: null };
  if (!isRecord(value)) return fail;
  if (value.schemaVersion !== 1) return fail;
  if (!boundedString(value.verdict, NARRATIVE_FIELD_LIMITS_V1.verdict)) return fail;
  if (!boundedString(value.whereYouStand, NARRATIVE_FIELD_LIMITS_V1.whereYouStand)) return fail;
  if (!boundedString(value.businessSide, NARRATIVE_FIELD_LIMITS_V1.businessSide)) return fail;

  if (!Array.isArray(value.nextSteps) || value.nextSteps.length < 1 || value.nextSteps.length > 3) return fail;
  for (const step of value.nextSteps) {
    if (!isRecord(step)) return fail;
    if (!boundedString(step.title, NARRATIVE_FIELD_LIMITS_V1.stepTitle)) return fail;
    if (!boundedString(step.detail, NARRATIVE_FIELD_LIMITS_V1.stepDetail)) return fail;
    if (!(step.itemKey === null || typeof step.itemKey === 'string')) return fail;
  }

  if (!isRecord(value.itemNotes)) return fail;
  for (const [key, note] of Object.entries(value.itemNotes)) {
    if (!PERSONAL_KEYS.has(key)) return fail;
    if (!boundedString(note, NARRATIVE_FIELD_LIMITS_V1.itemNote)) return fail;
  }

  if (!isRecord(value.timeline)) return fail;
  if (typeof value.timeline.band !== 'string' || !TIMELINE_BANDS.has(value.timeline.band)) return fail;
  if (!boundedString(value.timeline.reason, NARRATIVE_FIELD_LIMITS_V1.timelineReason)) return fail;

  if (!isRecord(value.generation)) return fail;
  if (value.generation.driver !== 'mock' && value.generation.driver !== 'openrouter') return fail;
  if (!boundedString(value.generation.model, 128)) return fail;
  if (!Number.isSafeInteger(value.generation.promptVersion) || (value.generation.promptVersion as number) < 1) return fail;

  return { codes: [], narrative: value as unknown as NarrativeV1 };
}

/**
 * A brand word is named when it appears in the prose and no account label on the file carries it.
 *
 * Matched on a word boundary against the lower-cased prose so "discovering" does not read as the
 * card, and matched against the labels the same way so a pack label of "DISCOVER IT CARD" licenses
 * "Discover" wherever the narrative uses it.
 */
function lenderCodes(narrative: NarrativeV1, pack: FactsPackV2): string[] {
  const labels = pack.accounts
    .map((account) => account.label)
    .filter((label): label is string => typeof label === 'string')
    .map((label) => label.toLowerCase());
  const prose = proseFields(narrative).join('\n').toLowerCase();
  for (const brand of LENDER_DENYLIST) {
    const pattern = new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    if (!pattern.test(prose)) continue;
    if (labels.some((label) => pattern.test(label))) continue;
    return ['LENDER_NAMED'];
  }
  return [];
}

function numberCodes(narrative: NarrativeV1, pack: FactsPackV2): string[] {
  const allowed = allowedNumbers(pack);
  for (const field of proseFields(narrative)) {
    for (const match of field.matchAll(NUMBER_TOKEN)) {
      const canonical = canonicalNumber(match[0]);
      if (canonical === null || !allowed.has(canonical)) return ['NUMBER_UNGROUNDED'];
    }
  }
  return [];
}

function itemNoteCodes(narrative: NarrativeV1, pack: FactsPackV2): string[] {
  const expected = new Set(
    pack.personal.filter((fact) => fact.state === 'unverified').map((fact) => fact.key as string),
  );
  const supplied = new Set(Object.keys(narrative.itemNotes));
  if (expected.size !== supplied.size) return ['ITEM_NOTE_MISMATCH'];
  for (const key of expected) if (!supplied.has(key)) return ['ITEM_NOTE_MISMATCH'];
  return [];
}

/**
 * The verdict opens with the pack's label, spelled the way the pack spells it.
 *
 * Compared after trimming leading space and case-insensitively, because "Ready." and "ready." are
 * the same claim and failing the second would be a checker enforcing typography. Everything after
 * the label is prose the model is free to write.
 */
function verdictLabelCodes(narrative: NarrativeV1, pack: FactsPackV2): string[] {
  const label = pack.readinessLabel.trim().toLowerCase();
  const verdict = narrative.verdict.trimStart().toLowerCase();
  return verdict.startsWith(label) ? [] : ['VERDICT_LABEL'];
}

function stepItemCodes(narrative: NarrativeV1, pack: FactsPackV2): string[] {
  const known = new Set<string>([...pack.personal, ...pack.business].map((fact) => fact.key as string));
  for (const step of narrative.nextSteps) {
    if (step.itemKey === null) continue;
    if (!known.has(step.itemKey)) return ['STEP_ITEM_UNKNOWN'];
  }
  return [];
}

export function checkNarrative(narrative: unknown, pack: FactsPackV2): NarrativeCheckResult {
  const shape = schemaCodes(narrative);
  if (shape.narrative === null) {
    return { approved: false, codes: shape.codes };
  }
  const value = shape.narrative;
  const codes = new Set<string>([
    ...numberCodes(value, pack),
    // The compliance rules walk object keys as well as values, so the whole prose set goes in as an
    // array rather than as the narrative object: an item key like `no_late_payments` is a schema
    // identifier, not copy a consumer reads, and it must not be able to trip a copy rule.
    ...(complianceLanguageCodes(proseFields(value)).length > 0 ? ['LANGUAGE'] : []),
    ...lenderCodes(value, pack),
    ...itemNoteCodes(value, pack),
    ...stepItemCodes(value, pack),
    ...verdictLabelCodes(value, pack),
  ]);
  const sorted = [...codes].sort();
  return { approved: sorted.length === 0, codes: sorted };
}
