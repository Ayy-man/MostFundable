import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { cleanFeatures } from './__fixtures__/features.ts';
import { evaluatePlan } from './evaluator.ts';
import { deriveReadinessPlan } from './mock-driver.ts';
import {
  createOpenRouterPlanDriver,
  OPENROUTER_MODEL,
  OpenRouterDriverError,
} from './openrouter-driver.ts';
import { PLAN_PROMPT_V1 } from './prompts/plan-v1.ts';

import type { DerivedFeatures } from '../analysis/features.ts';

const FAKE_KEY = 'not-a-real-openrouter-key';
const SENT_CANARY = 'SOURCE-REQUEST-CANARY-53ac';
const RECEIVED_CANARY = 'PROVIDER-RESPONSE-CANARY-53ac';
const HEADER_CANARY = 'PROVIDER HEADER CANARY 53ac';

function candidate() {
  const plan = deriveReadinessPlan(cleanFeatures());
  return {
    ...plan,
    generation: {
      driver: 'openrouter' as const,
      model: OPENROUTER_MODEL,
      promptVersion: 1 as const,
    },
  };
}

function success(content: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(content) } }],
  }), { status: 200, headers });
}

interface CapturedCall {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

function scriptedFetch(steps: Array<Response | Error>) {
  const calls: CapturedCall[] = [];
  const transport = (async (url: string | URL | Request, init?: RequestInit) => {
    assert.ok(init);
    calls.push({
      url: String(url),
      init,
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    });
    const step = steps.shift();
    if (step instanceof Error) throw step;
    if (step === undefined) throw new Error('script exhausted');
    return step;
  }) as typeof fetch;
  return { transport, calls };
}

function requestMessages(call: CapturedCall) {
  return call.body.messages as Array<{ role: string; content: string }>;
}

function assertEveryObjectSchemaIsClosed(schema: unknown): void {
  if (typeof schema !== 'object' || schema === null) return;
  if (Array.isArray(schema)) {
    for (const item of schema) assertEveryObjectSchemaIsClosed(item);
    return;
  }
  const record = schema as Record<string, unknown>;
  if (record.type === 'object') assert.equal(record.additionalProperties, false);
  for (const value of Object.values(record)) assertEveryObjectSchemaIsClosed(value);
}

function errorSnapshot(error: OpenRouterDriverError) {
  return {
    name: error.name,
    message: error.message,
    code: error.code,
    operation: error.operation,
    status: error.status,
    attempt: error.attempt,
    requestId: error.requestId,
  };
}

/**
 * The reasoning headroom the transport adds on top of a caller's budget, read out
 * of the module that declares it. OPENROUTER_MODEL bills reasoning tokens against
 * max_tokens, so the number a caller writes is the answer budget and the transport
 * supplies the thinking budget; transcribing the sum here would leave these
 * assertions passing against a headroom the transport had stopped using.
 */
function reasoningHeadroom(): number {
  const source = readFileSync(fileURLToPath(new URL('./chat-transport.ts', import.meta.url)), 'utf8');
  const declared = /const REASONING_HEADROOM_TOKENS = (\d+);/.exec(source);
  assert.ok(declared, 'the transport no longer declares a reasoning headroom');
  return Number(declared[1]);
}

describe('OpenRouter request contract', () => {
  it('rejects missing and blank keys before constructing a transport', () => {
    for (const apiKey of [undefined, '', '   ']) {
      assert.throws(
        () => createOpenRouterPlanDriver({ apiKey }),
        (error: unknown) => {
          assert.ok(error instanceof OpenRouterDriverError);
          assert.deepEqual(errorSnapshot(error), {
            name: 'OpenRouterDriverError',
            message: 'OPENROUTER_API_KEY_MISSING',
            code: 'OPENROUTER_API_KEY_MISSING',
            operation: 'candidate',
            status: null,
            attempt: 0,
            requestId: null,
          });
          return true;
        },
      );
    }
  });

  it('sends a strict derived-only candidate request with every privacy control', async () => {
    const scripted = scriptedFetch([success(candidate())]);
    const driver = createOpenRouterPlanDriver({ apiKey: FAKE_KEY, fetch: scripted.transport });
    const features = { ...cleanFeatures(), sourceCanary: SENT_CANARY } as DerivedFeatures;

    const generated = await driver.generateCandidate(features);
    assert.deepEqual(generated, candidate());
    assert.deepEqual(evaluatePlan(generated, cleanFeatures()), { approved: true, codes: [] });
    assert.equal(generated.readinessScore, deriveReadinessPlan(cleanFeatures()).readinessScore);
    assert.equal(scripted.calls.length, 1);
    const call = scripted.calls[0];
    assert.equal(call.url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(call.init.method, 'POST');
    assert.deepEqual(call.init.headers, {
      authorization: `Bearer ${FAKE_KEY}`,
      'content-type': 'application/json',
    });
    assert.deepEqual(Object.keys(call.body).sort(), [
      'max_tokens',
      'messages',
      'model',
      'provider',
      'reasoning',
      'response_format',
      'stream',
      'temperature',
    ]);
    assert.equal(call.body.model, OPENROUTER_MODEL);
    assert.equal(call.body.temperature, 0);
    assert.equal(call.body.max_tokens, 4096 + reasoningHeadroom());
    assert.equal(call.body.stream, false);
    assert.deepEqual(call.body.provider, {
      zdr: true,
      data_collection: 'deny',
      require_parameters: true,
    });
    assert.deepEqual(call.body.response_format, {
      type: 'json_schema',
      json_schema: {
        name: PLAN_PROMPT_V1.candidateSchemaName,
        strict: true,
        schema: PLAN_PROMPT_V1.candidateSchema,
      },
    });
    assertEveryObjectSchemaIsClosed(PLAN_PROMPT_V1.candidateSchema);
    const messages = requestMessages(call);
    assert.deepEqual(messages.map((message) => message.role), ['system', 'user']);
    const user = JSON.parse(messages[1].content) as Record<string, unknown>;
    assert.deepEqual(Object.keys(user).sort(), ['derived', 'prompt']);
    assert.deepEqual(user.derived, PLAN_PROMPT_V1.serializeDerived(cleanFeatures()));
    assert.equal(JSON.stringify(call.body).includes(SENT_CANARY), false);
    // `reasoning` used to be asserted absent as a blanket string check. The
    // transport now sends it as a control knob — an effort level, because
    // OPENROUTER_MODEL bills its thinking against max_tokens — so the blanket
    // check would fail on our own field while still proving nothing about the
    // property it was guarding. What it was guarding is that no free-text
    // reasoning ever leaves this process, and that is asserted directly: the key
    // exists, it is exactly the effort control, and it carries no prose.
    assert.deepEqual(call.body.reasoning, { effort: 'low' });
    const withoutControl = { ...call.body };
    delete (withoutControl as Record<string, unknown>).reasoning;
    assert.equal(JSON.stringify(withoutControl).includes('reasoning'), false);
  });

  it('uses the separate strict supervisor schema and only typed candidate context', async () => {
    const verdict = { approved: true, codes: [] };
    const scripted = scriptedFetch([success(verdict)]);
    const driver = createOpenRouterPlanDriver({ apiKey: FAKE_KEY, fetch: scripted.transport });
    assert.deepEqual(await driver.supervise(cleanFeatures(), candidate()), verdict);

    const call = scripted.calls[0];
    assert.equal(call.body.max_tokens, 512 + reasoningHeadroom());
    assert.deepEqual(call.body.response_format, {
      type: 'json_schema',
      json_schema: {
        name: PLAN_PROMPT_V1.supervisorSchemaName,
        strict: true,
        schema: PLAN_PROMPT_V1.supervisorSchema,
      },
    });
    assertEveryObjectSchemaIsClosed(PLAN_PROMPT_V1.supervisorSchema);
    const user = JSON.parse(requestMessages(call)[1].content) as Record<string, unknown>;
    assert.deepEqual(Object.keys(user).sort(), ['candidate', 'derived', 'prompt']);
    assert.deepEqual(user.candidate, candidate());
    assert.deepEqual(user.derived, PLAN_PROMPT_V1.serializeDerived(cleanFeatures()));
  });
});

describe('OpenRouter retry and bounds', () => {
  for (const status of [429, 500, 503]) {
    it(`retries status ${status} once with identical privacy controls`, async () => {
      const scripted = scriptedFetch([
        new Response(RECEIVED_CANARY, { status }),
        success(candidate()),
      ]);
      const driver = createOpenRouterPlanDriver({
        apiKey: FAKE_KEY,
        fetch: scripted.transport,
        sleep: async () => {},
      });
      await driver.generateCandidate(cleanFeatures());
      assert.equal(scripted.calls.length, 2);
      for (const call of scripted.calls) {
        assert.deepEqual(call.body.provider, {
          zdr: true,
          data_collection: 'deny',
          require_parameters: true,
        });
      }
    });
  }

  for (const status of [400, 401, 403, 404]) {
    it(`does not retry status ${status}`, async () => {
      const scripted = scriptedFetch([new Response(RECEIVED_CANARY, { status })]);
      const driver = createOpenRouterPlanDriver({ apiKey: FAKE_KEY, fetch: scripted.transport });
      await assert.rejects(driver.generateCandidate(cleanFeatures()), {
        code: 'OPENROUTER_HTTP',
        status,
        attempt: 1,
      });
      assert.equal(scripted.calls.length, 1);
    });
  }

  it('retries one network interruption and stops at two attempts', async () => {
    const recovered = scriptedFetch([new Error(RECEIVED_CANARY), success(candidate())]);
    await createOpenRouterPlanDriver({
      apiKey: FAKE_KEY,
      fetch: recovered.transport,
    }).generateCandidate(cleanFeatures());
    assert.equal(recovered.calls.length, 2);

    const failed = scriptedFetch([new Error(RECEIVED_CANARY), new Error(RECEIVED_CANARY)]);
    await assert.rejects(
      createOpenRouterPlanDriver({ apiKey: FAKE_KEY, fetch: failed.transport })
        .generateCandidate(cleanFeatures()),
      { code: 'OPENROUTER_NETWORK', attempt: 2, status: null },
    );
    assert.equal(failed.calls.length, 2);
  });

  it('caps numeric and date Retry-After delays at two seconds', async () => {
    for (const retryAfter of ['99', 'Sun, 16 Aug 2026 04:00:10 GMT']) {
      const sleeps: number[] = [];
      const scripted = scriptedFetch([
        new Response('', { status: 429, headers: { 'retry-after': retryAfter } }),
        success(candidate()),
      ]);
      const driver = createOpenRouterPlanDriver({
        apiKey: FAKE_KEY,
        fetch: scripted.transport,
        sleep: async (milliseconds) => { sleeps.push(milliseconds); },
        now: () => Date.parse('2026-08-16T04:00:00.000Z'),
      });
      await driver.generateCandidate(cleanFeatures());
      assert.deepEqual(sleeps, [2000]);
    }
  });

  it('aborts each timed-out attempt and returns fixed timeout metadata', async (context) => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    let calls = 0;
    const transport = ((_url: string | URL | Request, init?: RequestInit) => {
      calls += 1;
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        assert.ok(signal);
        signal.addEventListener('abort', () => reject(new Error(RECEIVED_CANARY)), { once: true });
      });
    }) as typeof fetch;
    // The candidate's attempt budget is the driver's own declaration, read out
    // of the source rather than transcribed — it moved once already (20s → a
    // generation-sized budget) and a hard-coded tick makes this test hang
    // forever instead of fail when it moves again.
    const driverSource = readFileSync(fileURLToPath(new URL('./openrouter-driver.ts', import.meta.url)), 'utf8');
    const declaredBudget = /timeLimitMs: (\d[\d_]*),/.exec(driverSource);
    assert.ok(declaredBudget, 'the candidate call no longer declares a time budget');
    const budgetMs = Number(declaredBudget[1].replaceAll('_', ''));
    const pending = createOpenRouterPlanDriver({ apiKey: FAKE_KEY, fetch: transport })
      .generateCandidate(cleanFeatures());
    context.mock.timers.tick(budgetMs);
    await Promise.resolve();
    context.mock.timers.tick(budgetMs);
    await assert.rejects(pending, { code: 'OPENROUTER_TIMEOUT', attempt: 2 });
    assert.equal(calls, 2);
  });

  it('stops after one response that declares or streams more than 64 KiB', async () => {
    for (const response of [
      new Response('', { status: 200, headers: { 'content-length': '65537' } }),
      new Response('x'.repeat(65_537), { status: 200 }),
    ]) {
      const scripted = scriptedFetch([response]);
      await assert.rejects(
        createOpenRouterPlanDriver({ apiKey: FAKE_KEY, fetch: scripted.transport })
          .generateCandidate(cleanFeatures()),
        { code: 'OPENROUTER_RESPONSE_TOO_LARGE', attempt: 1 },
      );
      assert.equal(scripted.calls.length, 1);
    }
  });
});

describe('OpenRouter response trust boundary', () => {
  for (const scenario of [
    { name: 'invalid envelope JSON', body: 'not-json', code: 'OPENROUTER_ENVELOPE_INVALID' },
    { name: 'missing choices', body: '{}', code: 'OPENROUTER_ENVELOPE_INVALID' },
    {
      name: 'invalid content JSON',
      body: JSON.stringify({ choices: [{ message: { content: 'not-json' } }] }),
      code: 'OPENROUTER_CONTENT_INVALID',
    },
    {
      name: 'schema drift',
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...candidate(), extra: true }) } }] }),
      code: 'OPENROUTER_SCHEMA_INVALID',
    },
  ]) {
    it(`retries ${scenario.name} once, then rejects it`, async () => {
      const scripted = scriptedFetch([
        new Response(scenario.body, { status: 200 }),
        new Response(scenario.body, { status: 200 }),
      ]);
      await assert.rejects(
        createOpenRouterPlanDriver({ apiKey: FAKE_KEY, fetch: scripted.transport })
          .generateCandidate(cleanFeatures()),
        { code: scenario.code, attempt: 2, status: 200 },
      );
      assert.equal(scripted.calls.length, 2);
    });
  }

  it('exposes only fixed operation/status/attempt/safe-request-id metadata', async () => {
    const scripted = scriptedFetch([
      new Response(RECEIVED_CANARY, {
        status: 400,
        headers: {
          'x-request-id': 'req_safe_123',
          'x-provider-detail': HEADER_CANARY,
        },
      }),
    ]);
    try {
      await createOpenRouterPlanDriver({ apiKey: FAKE_KEY, fetch: scripted.transport })
        .generateCandidate({ ...cleanFeatures(), sourceCanary: SENT_CANARY } as DerivedFeatures);
      assert.fail('expected fixed provider error');
    } catch (error) {
      assert.ok(error instanceof OpenRouterDriverError);
      assert.deepEqual(errorSnapshot(error), {
        name: 'OpenRouterDriverError',
        message: 'OPENROUTER_HTTP',
        code: 'OPENROUTER_HTTP',
        operation: 'candidate',
        status: 400,
        attempt: 1,
        requestId: 'req_safe_123',
      });
      const serialized = JSON.stringify(errorSnapshot(error));
      for (const canary of [SENT_CANARY, RECEIVED_CANARY, HEADER_CANARY, FAKE_KEY]) {
        assert.equal(serialized.includes(canary), false);
      }
    }
  });

  it('drops an unsafe provider request-id header instead of reflecting it', async () => {
    const scripted = scriptedFetch([
      new Response('', { status: 400, headers: { 'x-request-id': HEADER_CANARY } }),
    ]);
    await assert.rejects(
      createOpenRouterPlanDriver({ apiKey: FAKE_KEY, fetch: scripted.transport })
        .generateCandidate(cleanFeatures()),
      { requestId: null },
    );
  });
});
