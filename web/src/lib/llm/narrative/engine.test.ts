import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { tinyPack } from './__fixtures__/packs.ts';
import { createMockNarrativeDriver, deriveMockNarrative } from './driver.ts';
import { factsPackHash, runNarrativeEngine } from './engine.ts';
import { NARRATIVE_EMBEDDED_PROMPT } from './prompt.ts';

import type { NarrativeDriver } from './driver.ts';
import type { NarrativeEngineDependencies } from './engine.ts';
import type { NarrativeV1 } from './contract.ts';
import type { RecordEvalRunInput, ResolvedPrompt } from '../../admin/prompt-types.ts';

const EMBEDDED: ResolvedPrompt = Object.freeze({ ...NARRATIVE_EMBEDDED_PROMPT, source: 'embedded' as const });

function harness(overrides: Partial<NarrativeEngineDependencies> = {}) {
  const records: RecordEvalRunInput[] = [];
  const lines: Record<string, unknown>[] = [];
  const deps: Partial<NarrativeEngineDependencies> = {
    env: {},
    async resolvePrompt() { return EMBEDDED; },
    async recordEvaluation(input) { records.push(input); return input; },
    log(line) { lines.push(line); },
    ...overrides,
  };
  return { deps, records, lines };
}

/** A driver that returns whatever it is handed, counting the attempts. */
function scriptedDriver(narratives: (NarrativeV1 | Error)[]): NarrativeDriver & { calls: number } {
  let calls = 0;
  const driver = {
    driver: 'mock' as const,
    model: 'scripted',
    get calls() { return calls; },
    async write(): Promise<NarrativeV1> {
      const next = narratives[Math.min(calls, narratives.length - 1)];
      calls += 1;
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return driver as NarrativeDriver & { calls: number };
}

function ungrounded(): NarrativeV1 {
  return { ...deriveMockNarrative(tinyPack(), 1), verdict: 'Near Ready. 77 items to fix.' } as NarrativeV1;
}

describe('narrative engine', () => {
  it('returns the narrative on the first approved attempt', async () => {
    const pack = tinyPack();
    const driver = scriptedDriver([deriveMockNarrative(pack, 1)]);
    const { deps } = harness();
    const narrative = await runNarrativeEngine(driver, pack, deps);
    assert.notEqual(narrative, null);
    assert.equal(driver.calls, 1, 'one approved attempt is one call');
  });

  it('retries once when the checker refuses, and takes the second', async () => {
    const pack = tinyPack();
    const driver = scriptedDriver([ungrounded(), deriveMockNarrative(pack, 1)]);
    const { deps, lines } = harness();
    const narrative = await runNarrativeEngine(driver, pack, deps);
    assert.notEqual(narrative, null);
    assert.equal(driver.calls, 2);
    assert.deepEqual(lines, [], 'a recovered attempt is not a failure to log');
  });

  it('returns null after two refusals and logs exactly one line', async () => {
    const pack = tinyPack();
    const driver = scriptedDriver([ungrounded()]);
    const { deps, lines } = harness();
    assert.equal(await runNarrativeEngine(driver, pack, deps), null);
    assert.equal(driver.calls, 2, 'two attempts, no more');
    assert.equal(lines.length, 1);
    assert.equal(lines[0].code, 'NARRATIVE_REJECTED');
    assert.deepEqual(lines[0].codes, ['NUMBER_UNGROUNDED']);
  });

  it('never throws when the driver throws, and says the driver is why', async () => {
    const pack = tinyPack();
    const driver = scriptedDriver([new Error('OPENROUTER_TIMEOUT')]);
    const { deps, lines } = harness();
    assert.equal(await runNarrativeEngine(driver, pack, deps), null);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].code, 'NARRATIVE_DRIVER_FAILED');
  });

  it('returns null rather than throwing when the prompt cannot be resolved', async () => {
    const { deps, lines } = harness({
      env: { FEATURE_ADMIN: 'true' },
      async resolvePrompt() { throw new Error('ADMIN_PROMPTS_RESULT_INVALID'); },
    });
    const pack = tinyPack();
    assert.equal(await runNarrativeEngine(createMockNarrativeDriver(), pack, deps), null);
    assert.equal(lines[0].code, 'NARRATIVE_PROMPT_UNRESOLVED');
  });

  it('uses the embedded prompt and records nothing when FEATURE_ADMIN is off', async () => {
    const pack = tinyPack();
    let resolved = 0;
    const { deps, records } = harness({
      env: {},
      async resolvePrompt() { resolved += 1; return EMBEDDED; },
    });
    await runNarrativeEngine(createMockNarrativeDriver(), pack, deps);
    assert.equal(resolved, 0, 'ungoverned deployments do not read the database');
    assert.deepEqual(records, []);
  });

  it('resolves the governed prompt and records both evaluators when FEATURE_ADMIN is on', async () => {
    const pack = tinyPack();
    const staged: ResolvedPrompt = Object.freeze({ ...EMBEDDED, version: 4, source: 'database' as const });
    const { deps, records } = harness({
      env: { FEATURE_ADMIN: 'true' },
      async resolvePrompt() { return staged; },
    });
    const narrative = await runNarrativeEngine(createMockNarrativeDriver(), pack, deps);
    assert.equal(narrative?.generation.promptVersion, 4);
    assert.deepEqual(records.map((record) => record.evaluatorKey), ['narrative.grounding', 'narrative.language']);
    for (const record of records) {
      assert.equal(record.promptKey, 'funding-readiness-narrative');
      assert.equal(record.promptVersion, 4);
      assert.equal(record.passed, true);
      assert.equal(record.eligible, false, 'a production run is never activation evidence');
      assert.equal(record.referenceDatasetHash, await factsPackHash(pack));
    }
  });

  it('splits the codes so a copy failure and a grounding failure are told apart', async () => {
    const pack = tinyPack();
    const named = {
      ...deriveMockNarrative(pack, 1),
      nextSteps: [{ title: 'Pay the Chase card', detail: 'Take it under 30%.', itemKey: 'utilization_under_30' }],
    } as NarrativeV1;
    const { deps, records } = harness({ env: { FEATURE_ADMIN: 'true' } });
    assert.equal(await runNarrativeEngine(scriptedDriver([named]), pack, deps), null);
    const grounding = records.filter((record) => record.evaluatorKey === 'narrative.grounding');
    const language = records.filter((record) => record.evaluatorKey === 'narrative.language');
    assert.ok(grounding.every((record) => record.passed), 'the numbers were fine');
    assert.ok(language.every((record) => !record.passed), 'the brand name was not');
    assert.deepEqual(language[0].result, { codes: ['LENDER_NAMED'] });
  });

  it('still returns an approved narrative when recording the evidence fails', async () => {
    const pack = tinyPack();
    const { deps } = harness({
      env: { FEATURE_ADMIN: 'true' },
      async recordEvaluation() { throw new Error('ADMIN_EVAL_RECORD_FAILED'); },
    });
    assert.notEqual(await runNarrativeEngine(createMockNarrativeDriver(), pack, deps), null);
  });

  it('hashes the pack it actually ran against, in the format the activation gate requires', async () => {
    const hash = await factsPackHash(tinyPack());
    assert.match(hash, /^sha256:[0-9a-f]{64}$/);
    assert.notEqual(hash, await factsPackHash({ ...tinyPack(), readinessScore: 63 }));
  });
});
