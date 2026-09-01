import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

import { DRIVERS, MisconfiguredDriverError } from '../env.ts';
import { PLAN_DRIVER_SPEC, createPlanDriver, getPlanDriver } from './driver.ts';
import { createMockPlanDriver } from './mock-driver.ts';

import type { EnvSource } from '../env.ts';
import type { PlanDriverFactories } from './driver.ts';

const FAKE_KEY = 'not-a-real-openrouter-key';

function factories(calls: string[]): PlanDriverFactories {
  return {
    createMock() {
      calls.push('mock');
      return createMockPlanDriver();
    },
    createOpenRouter(apiKey) {
      assert.equal(apiKey, FAKE_KEY);
      calls.push('openrouter');
      return { ...createMockPlanDriver(), driver: 'openrouter' };
    },
  };
}

function importProbe(env: EnvSource) {
  return spawnSync(
    process.execPath,
    [
      '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
      '--input-type=module',
      '--eval',
      "import('./src/lib/llm/driver.ts').then((module) => process.stdout.write('BOOTED:' + module.getPlanDriver().driver)).catch((error) => { process.stderr.write(error.name + ':' + error.message); process.exitCode = 1; })",
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { PATH: process.env.PATH, ...env } as unknown as NodeJS.ProcessEnv,
    },
  );
}

describe('plan driver selection', () => {
  // Same reason as the boot probes below: the key is the plan engine's own and
  // is read from its spec, so a future rename moves these with it.
  const SELECTOR = PLAN_DRIVER_SPEC.selector;

  it('selects one mock implementation for empty and blank environments', () => {
    for (const env of [{}, { [SELECTOR]: '' }, { [SELECTOR]: '   ' }]) {
      const calls: string[] = [];
      assert.equal(createPlanDriver(env, factories(calls)).driver, 'mock');
      assert.deepEqual(calls, ['mock']);
    }
  });

  it('returns the same module-selected instance on every runtime read', () => {
    assert.equal(getPlanDriver(), getPlanDriver());
    assert.equal(getPlanDriver().driver, 'mock');
  });

  it('rejects an unknown selector through the shared resolver without echoing its value', () => {
    assert.throws(
      () => createPlanDriver({ [SELECTOR]: 'do-not-echo-this-value' }),
      (error: unknown) => {
        assert.ok(error instanceof MisconfiguredDriverError);
        assert.equal(error.selector, SELECTOR);
        assert.equal(error.message.includes('do-not-echo-this-value'), false);
        return true;
      },
    );
  });

  it('rejects explicit openrouter before its factory when the key is absent', () => {
    const calls: string[] = [];
    assert.throws(
      () => createPlanDriver({ [SELECTOR]: 'openrouter' }, factories(calls)),
      (error: unknown) => {
        assert.ok(error instanceof MisconfiguredDriverError);
        assert.deepEqual([...error.missingKeys], ['OPENROUTER_API_KEY']);
        return true;
      },
    );
    assert.deepEqual(calls, []);
  });

  it('reaches only the openrouter factory after a nonblank key is validated', () => {
    const calls: string[] = [];
    assert.equal(
      createPlanDriver(
        { [SELECTOR]: 'openrouter', OPENROUTER_API_KEY: FAKE_KEY },
        factories(calls),
      ).driver,
      'openrouter',
    );
    assert.deepEqual(calls, ['openrouter']);
  });

  it('constructs the production openrouter implementation only after key validation', () => {
    const driver = createPlanDriver({
      [SELECTOR]: 'openrouter',
      OPENROUTER_API_KEY: FAKE_KEY,
    });
    assert.equal(driver.driver, 'openrouter');
  });
});

describe('module-load boot contract', () => {
  // The selector is read out of the spec rather than written here. These probes
  // transcribed `AI_DRIVER`, so when the plan engine moved to its own key they
  // failed while asserting nothing about the thing they exist to check — the
  // enumeration standing in for the class, rotting exactly as the round-5
  // standard describes. Derived, they follow the next rename for free.
  const SELECTOR = PLAN_DRIVER_SPEC.selector;

  it('boots in a child process with a completely empty service environment', () => {
    const result = importProbe({});
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'BOOTED:mock');
  });

  it('fails during import when openrouter is selected without its key', () => {
    const result = importProbe({ [SELECTOR]: 'openrouter' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /MisconfiguredDriverError/);
    assert.match(result.stderr, /OPENROUTER_API_KEY/);
  });

  it('constructs one keyed openrouter singleton during a fresh module import', () => {
    const result = importProbe({ [SELECTOR]: 'openrouter', OPENROUTER_API_KEY: FAKE_KEY });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'BOOTED:openrouter');
    assert.equal(result.stdout.includes(FAKE_KEY), false);
    assert.equal(result.stderr.includes(FAKE_KEY), false);
  });
});

/**
 * The coupling that broke production on 2026-08-22, pinned so it cannot come back.
 *
 * The plan engine used to resolve `AI_DRIVER`, which the KB assistants, the support
 * draft driver and the admin eval policy also read. Setting `AI_DRIVER=openrouter`
 * to give the KB assistants a real model therefore moved the plan engine onto a
 * path that has never passed `evaluatePlan`, and every production analysis run
 * began failing `plan_rejected`.
 *
 * These assertions derive the key from `PLAN_DRIVER_SPEC` and the forbidden key
 * from the `ai` row of the frozen table in `env.ts`, rather than writing either
 * string here. Transcribing them would pin today's names and miss the actual
 * invariant, which is that the plan engine's selector is *its own* — whatever
 * either one is called next year.
 */
describe('the plan engine owns its selector', () => {
  it('does not read whatever key the shared ai row uses', () => {
    const shared = DRIVERS.ai.selector;
    assert.notEqual(
      PLAN_DRIVER_SPEC.selector,
      shared,
      `the plan engine is back on ${shared}, which other services also read`,
    );

    // Behavioural, not just nominal: setting the shared key to the arm that
    // breaks the plan path must leave the plan engine on its fallback. Asserted
    // through the real resolver so a future refactor that reintroduces the
    // coupling somewhere else still fails here.
    const calls: string[] = [];
    createPlanDriver({ [shared]: 'openrouter', OPENROUTER_API_KEY: FAKE_KEY }, factories(calls));
    assert.deepEqual(
      calls,
      ['mock'],
      'the shared selector still reconfigures the plan engine',
    );
  });

  it('falls back to mock when its own selector is unset, so the fix needs no environment change', () => {
    // This is the property that made the production fix deployable on its own:
    // PLAN_DRIVER is unset on production, so the plan engine returns to mock
    // while AI_DRIVER=openrouter keeps serving the KB assistants.
    assert.equal(PLAN_DRIVER_SPEC.fallback, 'mock');
    const calls: string[] = [];
    createPlanDriver({}, factories(calls));
    assert.deepEqual(calls, ['mock']);
  });

  it('still honours its own selector, so the split renames the key and keeps the arm', () => {
    const calls: string[] = [];
    createPlanDriver(
      { [PLAN_DRIVER_SPEC.selector]: 'openrouter', OPENROUTER_API_KEY: FAKE_KEY },
      factories(calls),
    );
    assert.deepEqual(calls, ['openrouter']);
  });
});
