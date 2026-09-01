import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  SUPPORT_DRAFT_DRIVER_UNAVAILABLE,
  createSupportDraftDriver,
  createUnavailableOpenRouterDraftDriver,
} from './driver.ts';
import { MOCK_SUPPORT_DRAFT_MODEL } from './mock-driver.ts';

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

  it('selects the mock driver when the selector names it', () => {
    assert.equal(createSupportDraftDriver({ AI_DRIVER: 'mock' }).driver, 'mock');
    assert.equal(createSupportDraftDriver({ AI_DRIVER: ' MOCK ' }).driver, 'mock');
  });

  // The construction half of this is the point. `llm/driver.ts` resolves the
  // shared `ai` selector at module load, so the day lane C flips
  // AI_DRIVER=openrouter this arm is constructed for every consumer. If it
  // threw here, support would break at import in production for a change that
  // has nothing to do with support.
  it('constructs the openrouter arm without throwing', () => {
    const driver = createSupportDraftDriver({
      AI_DRIVER: 'openrouter',
      OPENROUTER_API_KEY: 'not-a-real-key',
    });
    assert.equal(driver.driver, 'openrouter');
    assert.ok(driver.model.length > 0);
  });

  it('rejects on use with the fixed code, on both methods', async () => {
    const driver = createSupportDraftDriver({
      AI_DRIVER: 'openrouter',
      OPENROUTER_API_KEY: 'not-a-real-key',
    });

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

  it('rejects the same way when the arm is constructed directly', async () => {
    const driver = createUnavailableOpenRouterDraftDriver();
    await assert.rejects(() => driver.generateDraft(CONTEXT), isUnavailable);
  });

  // This behaviour belongs to `resolveDriver` in the integration-owned env
  // module. It is asserted, not re-implemented: support adds no key of its own
  // and no second opinion about a missing one.
  it('leaves the missing-key error to the shared selector', () => {
    assert.throws(
      () => createSupportDraftDriver({ AI_DRIVER: 'openrouter' }),
      /OPENROUTER_API_KEY/,
    );
  });

  it('leaves an unknown selector value to the shared selector', () => {
    assert.throws(() => createSupportDraftDriver({ AI_DRIVER: 'anthropic' }), /AI_DRIVER/);
  });

  it('resolves per call rather than caching a module-level singleton', () => {
    const env: Record<string, string | undefined> = {};
    assert.equal(createSupportDraftDriver(env).driver, 'mock');
    env.AI_DRIVER = 'openrouter';
    env.OPENROUTER_API_KEY = 'not-a-real-key';
    assert.equal(createSupportDraftDriver(env).driver, 'openrouter');
  });

  it('accepts injected factories so a test needs no environment at all', () => {
    let mockCalls = 0;
    const driver = createSupportDraftDriver(
      {},
      {
        createMock() {
          mockCalls += 1;
          return createUnavailableOpenRouterDraftDriver();
        },
        createOpenRouter: createUnavailableOpenRouterDraftDriver,
      },
    );
    assert.equal(mockCalls, 1);
    assert.equal(driver.driver, 'openrouter');
  });
});
