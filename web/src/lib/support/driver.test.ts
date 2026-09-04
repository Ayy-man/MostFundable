import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { OPENROUTER_MODEL } from '../llm/chat-transport.ts';
import { createMockChatTransport } from '../llm/mock-chat-transport.ts';
import {
  SUPPORT_DRAFT_DRIVER_SPEC,
  SUPPORT_DRAFT_DRIVER_UNAVAILABLE,
  createSupportDraftDriver,
  createUnavailableOpenRouterDraftDriver,
} from './driver.ts';
import { MOCK_SUPPORT_DRAFT_MODEL } from './mock-driver.ts';
import { createOpenRouterSupportDraftDriver } from './openrouter-driver.ts';

import type { SupportDraftContext } from './types.ts';

const CONTEXT: SupportDraftContext = {
  threadKind: 'team_chat',
  threadSubject: 'Team chat',
  recentMessages: [{ authorKind: 'consumer', body: 'Any update on my file?' }],
};

function isUnavailable(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as { code?: string }).code === SUPPORT_DRAFT_DRIVER_UNAVAILABLE
  );
}

describe('support draft driver selection', () => {
  it('selects the mock driver with an empty environment', () => {
    const driver = createSupportDraftDriver({});
    assert.equal(driver.driver, 'mock');
    assert.equal(driver.model, MOCK_SUPPORT_DRAFT_MODEL);
  });

  it('selects the mock driver when its own selector names it', () => {
    assert.equal(createSupportDraftDriver({ SUPPORT_DRAFT_DRIVER: 'mock' }).driver, 'mock');
    assert.equal(createSupportDraftDriver({ SUPPORT_DRAFT_DRIVER: ' MOCK ' }).driver, 'mock');
  });

  // The whole point of the split: support's key is not the assistants' key and
  // not the eval policy's, so flipping one of those cannot move this one.
  it('reads only its own selector', () => {
    assert.equal(SUPPORT_DRAFT_DRIVER_SPEC.selector, 'SUPPORT_DRAFT_DRIVER');
    for (const foreign of ['ASSISTANT_DRIVER', 'EVAL_DRIVER', 'PLAN_DRIVER']) {
      assert.equal(
        createSupportDraftDriver({ [foreign]: 'openrouter', OPENROUTER_API_KEY: 'k' }).driver,
        'mock',
        `${foreign} must not select the support draft driver`,
      );
    }
  });

  // The deprecation window. A deployment already running on AI_DRIVER keeps the
  // driver it has for one release rather than silently dropping back to mock.
  it('accepts the deprecated AI_DRIVER while its own key is blank', () => {
    assert.equal(
      createSupportDraftDriver({
        SUPPORT_DRAFT_DRIVER: '',
        AI_DRIVER: 'openrouter',
        OPENROUTER_API_KEY: 'not-a-real-key',
      }).driver,
      'openrouter',
    );
  });

  it('lets its own key win over the deprecated one', () => {
    assert.equal(
      createSupportDraftDriver({
        SUPPORT_DRAFT_DRIVER: 'mock',
        AI_DRIVER: 'openrouter',
        OPENROUTER_API_KEY: 'not-a-real-key',
      }).driver,
      'mock',
    );
  });

  // Construction still cannot throw or reach the network: the transport is
  // built eagerly and only calls out when a person asks for a draft.
  it('constructs the real openrouter driver over the ZDR transport', () => {
    const driver = createSupportDraftDriver({
      SUPPORT_DRAFT_DRIVER: 'openrouter',
      OPENROUTER_API_KEY: 'not-a-real-key',
    });
    assert.equal(driver.driver, 'openrouter');
    assert.equal(driver.model, OPENROUTER_MODEL);
  });

  // Same driver code as the arm above, with the transport stubbed so the suite
  // makes no request: a draft comes back, and it is only a draft.
  it('drafts and supervises through the transport it was given', async () => {
    const driver = createOpenRouterSupportDraftDriver(
      createMockChatTransport(
        (request) =>
          request.operation === 'support.candidate'
            ? { body: 'The team is reviewing your file today.', confidence: 0.9 }
            : { approved: true, codes: [] },
        'support-test-model',
      ),
    );

    const candidate = await driver.generateDraft(CONTEXT);
    assert.equal(candidate.body, 'The team is reviewing your file today.');
    assert.equal(candidate.model, 'support-test-model');
    assert.deepEqual(await driver.superviseDraft(CONTEXT, candidate), {
      approved: true,
      codes: [],
    });
  });

  // The placeholder is no longer selected by anything in production, but
  // `errors.ts` still maps its code to a 503 and the service suites drive the
  // unavailable branch through it.
  it('keeps the unavailable arm constructible for the error contract', async () => {
    const driver = createUnavailableOpenRouterDraftDriver();
    await assert.rejects(() => driver.generateDraft(CONTEXT), isUnavailable);
    await assert.rejects(
      () =>
        driver.superviseDraft(CONTEXT, {
          body: 'A candidate reply.',
          confidence: 0.9,
          model: 'whatever',
        }),
      isUnavailable,
    );
  });

  // This behaviour belongs to the shared resolver in the integration-owned env
  // module. It is asserted, not re-implemented.
  it('leaves the missing-key error to the shared selector', () => {
    assert.throws(
      () => createSupportDraftDriver({ SUPPORT_DRAFT_DRIVER: 'openrouter' }),
      /OPENROUTER_API_KEY/,
    );
  });

  it('leaves an unknown selector value to the shared selector', () => {
    assert.throws(
      () => createSupportDraftDriver({ SUPPORT_DRAFT_DRIVER: 'anthropic' }),
      /SUPPORT_DRAFT_DRIVER/,
    );
  });

  it('resolves per call rather than caching a module-level singleton', () => {
    const env: Record<string, string | undefined> = {};
    assert.equal(createSupportDraftDriver(env).driver, 'mock');
    env.SUPPORT_DRAFT_DRIVER = 'openrouter';
    env.OPENROUTER_API_KEY = 'not-a-real-key';
    assert.equal(createSupportDraftDriver(env).driver, 'openrouter');
  });

  it('accepts injected factories so a test needs no environment at all', () => {
    const keys: string[] = [];
    let mockCalls = 0;
    const factories = {
      createMock() {
        mockCalls += 1;
        return createUnavailableOpenRouterDraftDriver();
      },
      createOpenRouter(apiKey: string) {
        keys.push(apiKey);
        return createUnavailableOpenRouterDraftDriver();
      },
    };

    assert.equal(createSupportDraftDriver({}, factories).driver, 'openrouter');
    assert.equal(mockCalls, 1);

    createSupportDraftDriver(
      { SUPPORT_DRAFT_DRIVER: 'openrouter', OPENROUTER_API_KEY: 'injected-key' },
      factories,
    );
    assert.deepEqual(keys, ['injected-key']);
  });
});
