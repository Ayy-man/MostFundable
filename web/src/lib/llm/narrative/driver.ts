/**
 * Narrative driver selection and the two arms behind it.
 *
 * `NARRATIVE_DRIVER` is this lane's own selector, resolved through `resolveDriverFromSpec` exactly
 * as `PLAN_DRIVER` is. `llm/driver.ts` sets out at length why a service does not borrow another
 * service's key: on 2026-08-22 one shared `AI_DRIVER` flip moved the plan engine onto a path that
 * failed every production run. The narrative is a third consumer of the same resolver and a fourth
 * would be a fourth key; sharing the semantics is the point, sharing the variable is the bug.
 *
 * Two things differ from the plan engine's arm and both are about the model rather than the wiring.
 * The default is `openai/gpt-5.6-luna` at high reasoning effort, because that is what won the
 * 2026-09-05 comparison for this job — accurate founder-voice prose from a facts pack at a tenth of
 * the cost of the larger model. And the token and time budgets are large: OpenRouter bills a
 * reasoning model's thinking against `max_tokens`, so a budget sized for the answer alone buys a
 * model that never reaches the answer, which is the failure `chat-transport.ts` records having
 * already paid for once.
 *
 * The mock arm is not a stub. It writes a real, grounded narrative out of the pack's own numbers,
 * so the default deployment — `NARRATIVE_DRIVER` unset — produces something the checker approves
 * and the consumer surface can render, rather than a null that silently degrades to template copy.
 */

import { resolveDriverFromSpec } from '../../env.ts';
import { createZdrChatTransport } from '../chat-transport.ts';
import {
  NARRATIVE_DRAFT_SCHEMA_V1,
  NARRATIVE_EMBEDDED_PROMPT,
  NARRATIVE_SCHEMA_NAME,
  NARRATIVE_STEP_ITEM_NONE,
} from './prompt.ts';
import { PERSONAL_ITEM_TITLES_V2 } from './contract.ts';
import {
  MOCK_NARRATIVE_MODEL,
  NARRATIVE_DEFAULT_MODEL,
  NARRATIVE_DRIVER_SPEC,
  narrativeModelFrom,
  narrativeReasoningFor,
} from './models.ts';

import type { EnvSource } from '../../env.ts';
import type { ResolvedPrompt } from '../../admin/prompt-types.ts';
import type {
  FactsPackV2,
  NarrativeStepV1,
  NarrativeTimelineBandV1,
  NarrativeV1,
  PersonalItemKeyV2,
} from './contract.ts';

export {
  MOCK_NARRATIVE_MODEL,
  NARRATIVE_DEFAULT_MODEL,
  NARRATIVE_DRIVER_SPEC,
  narrativeModelFrom,
  narrativeReasoningFor,
};

/**
 * Answer budget and wall clock for one narrative.
 *
 * 8,000 tokens because the transport adds its own reasoning headroom on top of what a caller asks
 * for, and high effort on this model spends thousands of tokens before it writes a word. 120
 * seconds because the generation happens inside the body read, not before the headers, so a limit
 * sized for a verdict would abort every narrative mid-sentence.
 */
export const NARRATIVE_MAX_TOKENS = 8_000;
export const NARRATIVE_TIME_LIMIT_MS = 120_000;

export interface NarrativeDriver {
  readonly driver: 'mock' | 'openrouter';
  readonly model: string;
  write(pack: FactsPackV2, prompt: ResolvedPrompt): Promise<NarrativeV1>;
}

interface NarrativeDraftStep {
  title: string;
  detail: string;
  itemKey: string;
}

interface NarrativeDraft {
  verdict: string;
  whereYouStand: string;
  nextSteps: NarrativeDraftStep[];
  itemNotes: { itemKey: string; note: string }[];
  businessSide: string;
  timeline: { band: NarrativeTimelineBandV1; reason: string };
}

/**
 * The draft the strict schema can express, folded into the shape the contract declares.
 *
 * Two conversions, both forced by OpenAI's strict mode requiring every declared property to be
 * required: the optional-keys `itemNotes` record arrives as an array of pairs, and a step with no
 * item arrives with the sentinel `'none'` rather than a null.
 */
export function narrativeFromDraft(
  draft: NarrativeDraft,
  generation: NarrativeV1['generation'],
): NarrativeV1 {
  const itemNotes: Partial<Record<PersonalItemKeyV2, string>> = {};
  for (const entry of draft.itemNotes) {
    itemNotes[entry.itemKey as PersonalItemKeyV2] = entry.note;
  }
  const nextSteps: NarrativeStepV1[] = draft.nextSteps.map((step) => ({
    title: step.title,
    detail: step.detail,
    itemKey: step.itemKey === NARRATIVE_STEP_ITEM_NONE ? null : (step.itemKey as NarrativeStepV1['itemKey']),
  }));
  return Object.freeze({
    schemaVersion: 1,
    verdict: draft.verdict,
    whereYouStand: draft.whereYouStand,
    nextSteps: Object.freeze(nextSteps),
    itemNotes: Object.freeze(itemNotes),
    businessSide: draft.businessSide,
    timeline: Object.freeze({ band: draft.timeline.band, reason: draft.timeline.reason }),
    generation,
  }) as NarrativeV1;
}

/**
 * The pack, as the model sees it: identical to `FactsPackV2` except that money is whole dollars.
 *
 * The 2026-09-05 twenty-scenario eval on `luna-high` is what put this here. Handing the model cents
 * under keys named `…Cents` produced sentences like "$40,000 on a $1,200,000 limit" — the model
 * read the number and ignored the unit, which is what a model does with a number a hundred times
 * larger than the thing it is describing. Renaming the key to `…Dollars` and dividing is not a
 * formatting nicety: the key name is the only unit signal the model has, and it turns out to be the
 * one it actually reads.
 *
 * `FactsPackV2` itself stays in cents. Money is stored, compared and audited in integer cents
 * everywhere else in this codebase, and changing units at the storage boundary to suit a prompt
 * would be the wrong trade. The conversion lives here, at the one edge that needs it.
 *
 * The rewrite is recursive and driven by the key suffix rather than by a list of fields, for the
 * same reason `allowedNumbers` walks the pack rather than naming its fields: a `…Cents` value the
 * rules half adds next month is converted the day it appears, and nobody has to remember this file.
 * `grounding.ts` already admits the whole-dollar value of every `…Cents` key, so what the model is
 * shown and what the checker will accept stay the same set of numbers by construction.
 */
export function serializeFactsPack(pack: FactsPackV2): Record<string, unknown> {
  const convert = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(convert);
    if (typeof value !== 'object' || value === null) return value;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key.endsWith('Cents')) {
        // Null survives as null under the renamed key. "No limit on file" is a fact the narrative
        // needs to be able to state, and turning it into 0 would invent a limit of zero dollars.
        out[`${key.slice(0, -'Cents'.length)}Dollars`] =
          typeof child === 'number' ? Math.round(child / 100) : convert(child);
        continue;
      }
      out[key] = convert(child);
    }
    return out;
  };
  return convert(pack) as Record<string, unknown>;
}

export interface OpenRouterNarrativeDriverOptions {
  apiKey: string | undefined;
  model?: string;
  fetch?: typeof globalThis.fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}

export function createOpenRouterNarrativeDriver(
  options: OpenRouterNarrativeDriverOptions,
): NarrativeDriver {
  const model = options.model ?? NARRATIVE_DEFAULT_MODEL;
  const reasoning = narrativeReasoningFor(model);
  const transport = createZdrChatTransport({
    apiKey: options.apiKey,
    model,
    ...(reasoning === undefined ? {} : { reasoning }),
    fetch: options.fetch,
    sleep: options.sleep,
    now: options.now,
  });
  return {
    driver: 'openrouter',
    model,
    async write(pack: FactsPackV2, prompt: ResolvedPrompt): Promise<NarrativeV1> {
      const draft = (await transport.complete({
        operation: 'narrative',
        schemaName: NARRATIVE_SCHEMA_NAME,
        schema: NARRATIVE_DRAFT_SCHEMA_V1,
        maxTokens: NARRATIVE_MAX_TOKENS,
        timeLimitMs: NARRATIVE_TIME_LIMIT_MS,
        messages: [
          { role: 'system', content: prompt.body },
          {
            role: 'user',
            content: JSON.stringify({
              prompt: { key: prompt.key, version: prompt.version },
              pack: serializeFactsPack(pack),
            }),
          },
        ],
      })) as NarrativeDraft;
      return narrativeFromDraft(draft, {
        driver: 'openrouter',
        model: transport.model,
        promptVersion: prompt.version,
      });
    },
  };
}

function dollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString('en-US')}`;
}

/**
 * The mock narrative: real sentences, every number taken straight off the pack.
 *
 * It reads like a terse version of what the model writes, which is deliberate — the mock path is
 * the default deployment, so it has to be something a consumer could actually be shown, and it has
 * to survive `checkNarrative` unaided. Every clause below is assembled from a pack field, and the
 * item notes are generated from the pack's own `gap` and `target` strings rather than written here,
 * so the mock cannot drift away from the rules the way hand-written copy would.
 */
export function deriveMockNarrative(pack: FactsPackV2, promptVersion: number): NarrativeV1 {
  const unverified = pack.personal.filter((fact) => fact.state === 'unverified');
  const itemNotes: Partial<Record<PersonalItemKeyV2, string>> = {};
  for (const fact of unverified) {
    const key = fact.key as PersonalItemKeyV2;
    const title = PERSONAL_ITEM_TITLES_V2[key] ?? key;
    itemNotes[key] = fact.gap === null
      ? `${title}. Target: ${fact.target}.`
      : `${fact.gap} Target: ${fact.target}.`;
  }

  const lead = unverified[0] ?? null;
  const steps: NarrativeStepV1[] = lead === null
    ? [{
        title: 'Keep the file where it is',
        detail: 'Every personal checklist item is satisfied. Hold the balances and the accounts steady while the business side is completed.',
        itemKey: null,
      }]
    : [{
        title: 'Start with the biggest gap',
        detail: `${lead.gap ?? PERSONAL_ITEM_TITLES_V2[lead.key as PersonalItemKeyV2] ?? String(lead.key)} Target: ${lead.target}.`,
        itemKey: lead.key,
      }];

  const band: NarrativeTimelineBandV1 = pack.itemsToFix === 0
    ? '7-30 days'
    : pack.itemsToFix <= 2
      ? '30-60 days'
      : pack.itemsToFix <= 4
        ? '60-120 days'
        : '3-6 months';

  const utilizationClause = pack.overallUtilizationPct === null
    ? 'No revolving utilization is on file yet.'
    : `Revolving utilization across the file is ${pack.overallUtilizationPct}%.`;
  const limitClause = pack.highestRevolvingLimitCents === null
    ? ''
    : ` The largest revolving limit on the file is ${dollars(pack.highestRevolvingLimitCents)}.`;

  const businessUnverified = pack.business.filter((fact) => fact.state !== 'verified').length;
  const businessSide = businessUnverified === 0
    ? 'The business checklist is complete on the information supplied so far.'
    : `${businessUnverified} of the ${pack.business.length} business items are still open, and they are supplied by the owner rather than read from a credit file.`;

  return Object.freeze({
    schemaVersion: 1,
    verdict: pack.itemsToFix === 0
      ? `${pack.readinessLabel}. ${pack.personalVerifiedCount}/10 personal items are satisfied.`
      : `${pack.readinessLabel}. ${pack.itemsToFix} items to fix.`,
    whereYouStand: `Readiness is ${pack.readinessScore} out of 100, with ${pack.personalVerifiedCount} of the 10 personal items satisfied and ${pack.openAccountsCount} accounts open. ${utilizationClause}${limitClause}`,
    nextSteps: Object.freeze(steps),
    itemNotes: Object.freeze(itemNotes),
    businessSide,
    timeline: Object.freeze({
      band,
      reason: `${pack.itemsToFix} personal items are still open, and each one moves on its own reporting cycle.`,
    }),
    generation: Object.freeze({ driver: 'mock' as const, model: MOCK_NARRATIVE_MODEL, promptVersion }),
  }) as NarrativeV1;
}

export function createMockNarrativeDriver(): NarrativeDriver {
  return {
    driver: 'mock',
    model: MOCK_NARRATIVE_MODEL,
    async write(pack: FactsPackV2, prompt: ResolvedPrompt): Promise<NarrativeV1> {
      return deriveMockNarrative(pack, prompt?.version ?? NARRATIVE_EMBEDDED_PROMPT.version);
    },
  };
}

export interface NarrativeDriverFactories {
  createMock(): NarrativeDriver;
  createOpenRouter(apiKey: string, model: string): NarrativeDriver;
}

const productionFactories: NarrativeDriverFactories = {
  createMock: createMockNarrativeDriver,
  createOpenRouter(apiKey, model): NarrativeDriver {
    return createOpenRouterNarrativeDriver({ apiKey, model });
  },
};

export function createNarrativeDriver(
  env: EnvSource,
  factories: NarrativeDriverFactories = productionFactories,
): NarrativeDriver {
  const selected = resolveDriverFromSpec('narrative', NARRATIVE_DRIVER_SPEC, env);
  switch (selected) {
    case 'mock':
      return factories.createMock();
    case 'openrouter':
      return factories.createOpenRouter(env.OPENROUTER_API_KEY as string, narrativeModelFrom(env));
  }
}

// Chosen once at module load, like every other driver on the §10 table.
const SELECTED_NARRATIVE_DRIVER = createNarrativeDriver(process.env);

export function getNarrativeDriver(): NarrativeDriver {
  return SELECTED_NARRATIVE_DRIVER;
}
