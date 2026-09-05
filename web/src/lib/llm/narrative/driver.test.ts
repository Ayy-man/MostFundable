import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { packWith, tinyPack } from './__fixtures__/packs.ts';
import {
  MOCK_NARRATIVE_MODEL,
  NARRATIVE_DEFAULT_MODEL,
  NARRATIVE_MAX_TOKENS,
  NARRATIVE_TIME_LIMIT_MS,
  createMockNarrativeDriver,
  createNarrativeDriver,
  createOpenRouterNarrativeDriver,
  deriveMockNarrative,
  narrativeFromDraft,
  narrativeModelFrom,
  narrativeReasoningFor,
  serializeFactsPack,
} from './driver.ts';
import { allowedNumbers, checkNarrative } from './grounding.ts';
import { NARRATIVE_EMBEDDED_PROMPT } from './prompt.ts';

import type { NarrativeDriver, NarrativeDriverFactories } from './driver.ts';
import type { ResolvedPrompt } from '../../admin/prompt-types.ts';

const PROMPT: ResolvedPrompt = Object.freeze({ ...NARRATIVE_EMBEDDED_PROMPT, source: 'embedded' as const });

function stubFactories(): NarrativeDriverFactories & { openRouterCalls: { apiKey: string; model: string }[] } {
  const openRouterCalls: { apiKey: string; model: string }[] = [];
  return {
    openRouterCalls,
    createMock: createMockNarrativeDriver,
    createOpenRouter(apiKey, model): NarrativeDriver {
      openRouterCalls.push({ apiKey, model });
      return { driver: 'openrouter', model, async write() { throw new Error('not called'); } };
    },
  };
}

describe('narrative driver selection', () => {
  it('falls back to mock when NARRATIVE_DRIVER is unset or blank', () => {
    for (const env of [{}, { NARRATIVE_DRIVER: '' }, { NARRATIVE_DRIVER: '   ' }]) {
      assert.equal(createNarrativeDriver(env, stubFactories()).driver, 'mock');
    }
  });

  it('does not follow another service\'s selector', () => {
    // The 2026-08-22 defect in one line: flipping the assistants must not move this lane.
    const driver = createNarrativeDriver({ AI_DRIVER: 'openrouter', PLAN_DRIVER: 'openrouter' }, stubFactories());
    assert.equal(driver.driver, 'mock');
  });

  it('selects openrouter and passes the key and the resolved model', () => {
    const factories = stubFactories();
    const driver = createNarrativeDriver(
      { NARRATIVE_DRIVER: 'openrouter', OPENROUTER_API_KEY: 'key-value', NARRATIVE_MODEL: 'anthropic/claude-sonnet-5' },
      factories,
    );
    assert.equal(driver.driver, 'openrouter');
    assert.deepEqual(factories.openRouterCalls, [{ apiKey: 'key-value', model: 'anthropic/claude-sonnet-5' }]);
  });

  it('refuses openrouter without the key it requires, naming the key', () => {
    assert.throws(
      () => createNarrativeDriver({ NARRATIVE_DRIVER: 'openrouter' }, stubFactories()),
      (error: Error) => error.message.includes('OPENROUTER_API_KEY'),
    );
  });

  it('refuses a driver name that is not in the table', () => {
    assert.throws(() => createNarrativeDriver({ NARRATIVE_DRIVER: 'anthropic' }, stubFactories()));
  });

  it('normalizes case and surrounding space the way every other selector does', () => {
    const factories = stubFactories();
    const driver = createNarrativeDriver({ NARRATIVE_DRIVER: '  OpenRouter ', OPENROUTER_API_KEY: 'k' }, factories);
    assert.equal(driver.driver, 'openrouter');
  });
});

describe('narrative model resolution', () => {
  it('defaults to the model the comparison chose', () => {
    assert.equal(narrativeModelFrom({}), NARRATIVE_DEFAULT_MODEL);
    assert.equal(narrativeModelFrom({ NARRATIVE_MODEL: '  ' }), NARRATIVE_DEFAULT_MODEL);
  });

  it('takes NARRATIVE_MODEL when it is set, trimmed', () => {
    assert.equal(narrativeModelFrom({ NARRATIVE_MODEL: ' openai/gpt-5.6-terra ' }), 'openai/gpt-5.6-terra');
  });

  it('asks for high reasoning effort only on the OpenAI family', () => {
    assert.equal(narrativeReasoningFor('openai/gpt-5.6-luna'), 'high');
    assert.equal(narrativeReasoningFor('anthropic/claude-sonnet-5'), undefined);
    assert.equal(narrativeReasoningFor('openai-community/something'), undefined);
  });
});

describe('mock narrative driver', () => {
  it('writes a narrative the checker approves', async () => {
    const driver = createMockNarrativeDriver();
    const pack = tinyPack();
    const narrative = await driver.write(pack, PROMPT);
    assert.deepEqual(checkNarrative(narrative, pack).codes, []);
    assert.deepEqual(narrative.generation, { driver: 'mock', model: MOCK_NARRATIVE_MODEL, promptVersion: 1 });
  });

  it('takes every number from the pack rather than from the template', () => {
    const narrative = deriveMockNarrative(tinyPack(), 1);
    assert.ok(narrative.whereYouStand.includes('62'), 'the readiness score');
    assert.ok(narrative.whereYouStand.includes('84%'), 'the utilization');
    assert.ok(narrative.verdict.startsWith('Near Ready.'), 'opens with the pack\'s own label');
    assert.ok(narrative.verdict.includes('1 items to fix') || narrative.verdict.includes('1 item'), 'the items-to-fix count');
  });

  it('writes one note per unverified personal item and no others', () => {
    const narrative = deriveMockNarrative(tinyPack(), 1);
    assert.deepEqual(Object.keys(narrative.itemNotes), ['utilization_under_30']);
  });

  it('says something different when nothing is left to fix', () => {
    const pack = { ...tinyPack(), itemsToFix: 0, personalVerifiedCount: 10, personal: [] };
    const narrative = deriveMockNarrative(pack, 1);
    assert.equal(narrative.timeline.band, '7-30 days');
    assert.deepEqual(Object.keys(narrative.itemNotes), []);
    assert.deepEqual(checkNarrative(narrative, pack).codes, []);
  });

  it('carries the resolved prompt version rather than a hard-coded one', async () => {
    const driver = createMockNarrativeDriver();
    const narrative = await driver.write(tinyPack(), { ...PROMPT, version: 7, source: 'database' });
    assert.equal(narrative.generation.promptVersion, 7);
  });
});

describe('the pack the model is shown', () => {
  it('renames every money key and divides it into whole dollars', () => {
    const shown = serializeFactsPack(tinyPack()) as Record<string, unknown>;
    assert.equal(shown.highestRevolvingLimitCents, undefined, 'no cents key survives');
    assert.equal(shown.highestRevolvingLimitDollars, 5_000);
    const account = (shown.accounts as Record<string, unknown>[])[0];
    assert.equal(account.balanceCents, undefined);
    assert.deepEqual(
      { balance: account.balanceDollars, limit: account.limitDollars, pastDue: account.pastDueDollars },
      { balance: 4_200, limit: 5_000, pastDue: 0 },
      'the eval\'s "$40,000 on a $1,200,000 limit" failure, in one assertion',
    );
  });

  it('leaves a null limit null rather than inventing a limit of zero', () => {
    const pack = packWith({
      accounts: [{ ...tinyPack().accounts[0], limitCents: null, utilizationPct: null }],
    });
    const account = (serializeFactsPack(pack) as { accounts: Record<string, unknown>[] }).accounts[0];
    assert.equal(account.limitDollars, null);
  });

  it('carries every other field through unchanged', () => {
    const pack = tinyPack();
    const shown = serializeFactsPack(pack) as Record<string, unknown>;
    assert.equal(shown.readinessScore, pack.readinessScore);
    assert.equal(shown.readinessLabel, pack.readinessLabel);
    assert.deepEqual(shown.personal, pack.personal);
    assert.equal((shown.accounts as Record<string, unknown>[])[0].label, pack.accounts[0].label);
  });

  it('shows the model only numbers the checker would already accept', () => {
    // The two halves have to agree by construction, or the model is being handed a figure it will
    // then be refused for repeating. Every number in the rendered pack has to be in the allowed set.
    const pack = tinyPack();
    const allowed = allowedNumbers(pack);
    const numbers: number[] = [];
    const walk = (value: unknown): void => {
      if (typeof value === 'number') { numbers.push(value); return; }
      if (Array.isArray(value)) { value.forEach(walk); return; }
      if (typeof value === 'object' && value !== null) Object.values(value).forEach(walk);
    };
    walk(serializeFactsPack(pack));
    assert.ok(numbers.length > 0);
    for (const value of numbers) {
      assert.ok(allowed.has(String(value)), `${value} is shown to the model and grounded`);
    }
  });
});

describe('narrative draft folding', () => {
  it('turns the pair array into the record the contract declares', () => {
    const narrative = narrativeFromDraft(
      {
        verdict: 'Not ready yet. 1 item to fix.',
        whereYouStand: 'A sentence.',
        nextSteps: [{ title: 'Do it', detail: 'A detail.', itemKey: 'utilization_under_30' }],
        itemNotes: [{ itemKey: 'utilization_under_30', note: 'A note.' }],
        businessSide: 'A sentence.',
        timeline: { band: '30-60 days', reason: 'A reason.' },
      },
      { driver: 'openrouter', model: NARRATIVE_DEFAULT_MODEL, promptVersion: 1 },
    );
    assert.deepEqual(narrative.itemNotes, { utilization_under_30: 'A note.' });
    assert.equal(narrative.nextSteps[0].itemKey, 'utilization_under_30');
    assert.equal(narrative.schemaVersion, 1);
  });

  it('turns the "none" sentinel into the null the contract declares', () => {
    const narrative = narrativeFromDraft(
      {
        verdict: 'v',
        whereYouStand: 'w',
        nextSteps: [{ title: 't', detail: 'd', itemKey: 'none' }],
        itemNotes: [],
        businessSide: 'b',
        timeline: { band: '7-30 days', reason: 'r' },
      },
      { driver: 'mock', model: MOCK_NARRATIVE_MODEL, promptVersion: 1 },
    );
    assert.equal(narrative.nextSteps[0].itemKey, null);
  });
});

describe('openrouter narrative driver', () => {
  it('sends the strict schema, the reasoning block and the budgets this job needs', async () => {
    let sent: Record<string, unknown> | null = null;
    const driver = createOpenRouterNarrativeDriver({
      apiKey: 'key-value',
      model: NARRATIVE_DEFAULT_MODEL,
      async fetch(_url, init) {
        sent = JSON.parse(String((init as RequestInit).body));
        const draft = {
          verdict: 'Not ready yet. 1 item to fix.',
          whereYouStand: 'A sentence.',
          nextSteps: [{ title: 'Do it', detail: 'A detail.', itemKey: 'utilization_under_30' }],
          itemNotes: [{ itemKey: 'utilization_under_30', note: 'A note.' }],
          businessSide: 'A sentence.',
          timeline: { band: '30-60 days', reason: 'A reason.' },
        };
        return new Response(
          JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(draft) } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });

    const narrative = await driver.write(tinyPack(), PROMPT);

    const body = sent as unknown as Record<string, unknown>;
    assert.equal(body.model, NARRATIVE_DEFAULT_MODEL);
    assert.deepEqual(body.reasoning, { effort: 'high' });
    // The transport adds its own reasoning headroom on top of the caller's answer budget.
    assert.ok((body.max_tokens as number) >= NARRATIVE_MAX_TOKENS, 'the answer budget survives');
    const format = body.response_format as { json_schema: { strict: boolean; schema: { additionalProperties: boolean } } };
    assert.equal(format.json_schema.strict, true);
    assert.equal(format.json_schema.schema.additionalProperties, false);
    assert.equal(narrative.generation.driver, 'openrouter');
    assert.equal(narrative.generation.model, NARRATIVE_DEFAULT_MODEL);
    assert.equal(NARRATIVE_TIME_LIMIT_MS, 120_000);
  });

  it('omits the reasoning block for a model outside the OpenAI family', async () => {
    let sent: Record<string, unknown> | null = null;
    const driver = createOpenRouterNarrativeDriver({
      apiKey: 'key-value',
      model: 'anthropic/claude-sonnet-5',
      async fetch(_url, init) {
        sent = JSON.parse(String((init as RequestInit).body));
        return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }] }), { status: 200 });
      },
    });
    await driver.write(tinyPack(), PROMPT).catch(() => undefined);
    // Absent the caller's setting the transport applies its own default, which is `low` — what must
    // not happen is this lane sending `high` to a model that was never measured at it.
    assert.deepEqual((sent as unknown as Record<string, unknown>).reasoning, { effort: 'low' });
  });

  it('refuses to exist without an API key', () => {
    assert.throws(() => createOpenRouterNarrativeDriver({ apiKey: undefined }));
  });
});
