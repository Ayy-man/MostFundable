/**
 * The `funding-readiness-narrative` prompt, version 1.
 *
 * The body below is the prompt that won the 2026-09-05 model comparison, extended from the four
 * loose prose fields it produced then to the `NarrativeV1` shape in `contract.ts`. Two things
 * about it are load-bearing and easy to undo by accident:
 *
 * 1. **The model never sees a report and never decides a fact.** It is handed a `FactsPackV2` —
 *    numbers, short enums and creditor labels — and every number it writes has to be one it was
 *    handed. `grounding.ts` proves that deterministically after the fact; this prompt is what
 *    makes the proof usually pass on the first attempt rather than the second.
 *
 * 2. **The wording of the restrictions is deliberately indirect.** `verify-compliance-copy.mjs`
 *    scans `web/src` for the regulated vocabulary this product may not ship, and a prompt that
 *    spelled its prohibitions out word by word would fail that gate on its own source. So the
 *    restrictions below name the *shape* of a barred claim — a promised outcome, a predicted
 *    number, a named provider — rather than the tokens. The deterministic checker holds the
 *    tokens, which is the right place for them: one list, one owner, and no copy of it here to
 *    drift.
 *
 * The model-facing draft is not `NarrativeV1`. `itemNotes` is an array of key/note pairs and a
 * step's `itemKey` carries the sentinel `'none'`, because OpenAI's strict `json_schema` mode
 * requires every declared property to be required — an optional-keys record cannot be expressed
 * in it. `driver.ts` folds the draft into the contract shape.
 */

import {
  BUSINESS_ITEM_KEYS_V2,
  NARRATIVE_PROMPT_KEY,
  NARRATIVE_TIMELINE_BANDS_V1,
  PERSONAL_ITEM_KEYS_V2,
} from './contract.ts';

import type { EmbeddedPrompt } from '../../admin/prompt-types.ts';

export const NARRATIVE_PROMPT_VERSION = 1 as const;

/** The sentinel a step uses when it moves no single checklist item. */
export const NARRATIVE_STEP_ITEM_NONE = 'none' as const;

export const NARRATIVE_SCHEMA_NAME = 'funding_readiness_narrative_v1';

const ALL_ITEM_KEYS: readonly string[] = [...PERSONAL_ITEM_KEYS_V2, ...BUSINESS_ITEM_KEYS_V2];

/** Field-by-field caps, exported so the checker enforces exactly what the schema declares. */
export const NARRATIVE_FIELD_LIMITS_V1 = Object.freeze({
  verdict: 160,
  whereYouStand: 900,
  stepTitle: 120,
  stepDetail: 500,
  itemNote: 300,
  businessSide: 500,
  timelineReason: 400,
});

const STEP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'detail', 'itemKey'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: NARRATIVE_FIELD_LIMITS_V1.stepTitle },
    detail: { type: 'string', minLength: 1, maxLength: NARRATIVE_FIELD_LIMITS_V1.stepDetail },
    itemKey: { type: 'string', enum: [...ALL_ITEM_KEYS, NARRATIVE_STEP_ITEM_NONE] },
  },
} as const;

const ITEM_NOTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['itemKey', 'note'],
  properties: {
    itemKey: { type: 'string', enum: [...PERSONAL_ITEM_KEYS_V2] },
    note: { type: 'string', minLength: 1, maxLength: NARRATIVE_FIELD_LIMITS_V1.itemNote },
  },
} as const;

/**
 * The strict schema the transport sends as `response_format`.
 *
 * `additionalProperties: false` on every object and a closed `enum` on both key fields and the
 * timeline band, so the only invented strings the model can return are the prose ones.
 */
export const NARRATIVE_DRAFT_SCHEMA_V1 = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'whereYouStand', 'nextSteps', 'itemNotes', 'businessSide', 'timeline'],
  properties: {
    verdict: { type: 'string', minLength: 1, maxLength: NARRATIVE_FIELD_LIMITS_V1.verdict },
    whereYouStand: { type: 'string', minLength: 1, maxLength: NARRATIVE_FIELD_LIMITS_V1.whereYouStand },
    nextSteps: { type: 'array', minItems: 1, maxItems: 3, items: STEP_SCHEMA },
    itemNotes: { type: 'array', minItems: 0, maxItems: 10, items: ITEM_NOTE_SCHEMA },
    businessSide: { type: 'string', minLength: 1, maxLength: NARRATIVE_FIELD_LIMITS_V1.businessSide },
    timeline: {
      type: 'object',
      additionalProperties: false,
      required: ['band', 'reason'],
      properties: {
        band: { type: 'string', enum: [...NARRATIVE_TIMELINE_BANDS_V1] },
        reason: { type: 'string', minLength: 1, maxLength: NARRATIVE_FIELD_LIMITS_V1.timelineReason },
      },
    },
  },
} as const;

const NARRATIVE_SYSTEM_V1 = [
  "You write the plain-English readiness narrative inside MostFundable, a funding-readiness product for small business owners. The voice is the founder's: a credit strategist who has reviewed hundreds of files. Direct, specific, warm but never salesy. Every sentence earns its place.",
  '',
  'You receive one object, a FACTS PACK. Fixed rules built it from the consumer\'s credit file: a readiness score out of 100, a count of items still to fix, a count of the ten personal checklist items already satisfied, one entry per checklist item with what was observed and what the target is, and the accounts, inquiries and bureau scores behind them. The rules decide the facts. You explain them and turn them into a plan the reader can act on this week. You never decide anything.',
  '',
  'How the founder writes (match this):',
  '- Fact, target, gap, in one line. "Your main card is $4,200 on a $5,000 limit = 84%, above the 30% target."',
  '- Fact, target, gap again, for an item with no dollars in it. "Average account age is 18 months, under the 24-month target, and the newest account is what pulls it down."',
  '- Name the actual account and the actual number every time. Never "some accounts" or "high balances".',
  '- Say what to do and what number to hit. "Bring that card down to $1,500 or less to clear the 30% target."',
  '- Order actions by how much they move the checklist, fastest wins first.',
  '- Where an item cannot be checked yet, say plainly what is missing and who needs to supply it.',
  '- One short paragraph per idea. No filler, no cheerleading, no "great job".',
  '',
  'Hard rules:',
  '- Every number you write must appear in the facts pack. Do not compute a new one, do not round differently, do not total two of them together. A deterministic checker compares each number you write against the pack and discards the whole narrative when one does not match.',
  '- Never contradict a state, a label or a count in the pack.',
  '- Never state or imply what any lender or bank will decide, and never put a number on the chance of any future decision.',
  '- Never state a future value for the score, or a movement in it.',
  '- Never name a bank, a card, a lender or a financial product. When an account in the pack carries a label, use that label exactly as the pack spells it and use no other name.',
  '- Refer to a checklist item by what it measures, never by the name of a company or a service that works on credit files.',
  '- No legal advice, and no instruction to contact a bureau on the reader\'s behalf.',
  '- Assume a busy owner reading on a phone. Short sentences. No jargon without a five-word gloss.',
  '',
  'Fields you return:',
  '- verdict: the funding-status line, in the founder\'s form. Example shape: "Not ready yet. 4 items to fix." Use the pack\'s own counts.',
  '- whereYouStand: 2 to 4 sentences. Why the score is what it is, and the single biggest thing holding it back, with its number.',
  '- nextSteps: 1 to 3 steps, highest impact first. Each has a short imperative title, a detail of 1 to 3 sentences carrying the concrete target number, and itemKey naming the checklist item the step moves. Use "none" for itemKey only when a step moves no single item.',
  `- itemNotes: exactly one entry for each personal item whose state is "unverified", and no entry for any other item. One sentence each: fact, target, gap for this person. Personal item keys: ${PERSONAL_ITEM_KEYS_V2.join(', ')}.`,
  '- businessSide: 1 to 2 sentences on what the business checklist still needs and who supplies it.',
  `- timeline: band, chosen from exactly these values — ${NARRATIVE_TIMELINE_BANDS_V1.join(' | ')} — and reason, one or two sentences saying what makes it that band. Pick the band from the work the steps describe, not from anything you expect a lender to do.`,
  '',
  'Return exactly the requested JSON object and nothing else.',
].join('\n');

export const NARRATIVE_EMBEDDED_PROMPT: EmbeddedPrompt = Object.freeze({
  key: NARRATIVE_PROMPT_KEY,
  version: NARRATIVE_PROMPT_VERSION,
  body: NARRATIVE_SYSTEM_V1,
});

export const NARRATIVE_PROMPT_V1 = Object.freeze({
  key: NARRATIVE_PROMPT_KEY,
  version: NARRATIVE_PROMPT_VERSION,
  body: NARRATIVE_SYSTEM_V1,
  schemaName: NARRATIVE_SCHEMA_NAME,
  schema: NARRATIVE_DRAFT_SCHEMA_V1,
});
