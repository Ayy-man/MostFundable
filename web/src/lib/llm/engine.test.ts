import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cleanFeatures, noHitFeatures } from './__fixtures__/features.ts';
import { runPlanEngine } from './engine.ts';
import { createMockPlanDriver, deriveReadinessPlan } from './mock-driver.ts';

import type { PlanDriver } from './types.ts';
import type { RecordEvalRunInput, ResolvedPrompt } from '../admin/prompt-types.ts';

describe('plan engine', () => {
  it('uses one candidate and one supervisor on the normal path', async () => {
    const base = createMockPlanDriver();
    let generated = 0;
    let supervised = 0;
    const driver: PlanDriver = {
      driver: 'mock',
      async generateCandidate(features) {
        generated += 1;
        return base.generateCandidate(features);
      },
      async supervise(features, candidate) {
        supervised += 1;
        return base.supervise(features, candidate);
      },
    };

    assert.equal((await runPlanEngine(driver, cleanFeatures()))?.readinessScore, 99);
    assert.deepEqual({ generated, supervised }, { generated: 1, supervised: 1 });
  });

  it('does no driver work for a no-hit derived result', async () => {
    let calls = 0;
    const driver: PlanDriver = {
      driver: 'mock',
      async generateCandidate() {
        calls += 1;
        return deriveReadinessPlan(cleanFeatures());
      },
      async supervise() {
        calls += 1;
        return { approved: true, codes: [] };
      },
    };
    assert.equal(await runPlanEngine(driver, noHitFeatures()), null);
    assert.equal(calls, 0);
  });

  it('regenerates once after a local rejection', async () => {
    const features = cleanFeatures();
    let generated = 0;
    let supervised = 0;
    const driver: PlanDriver = {
      driver: 'mock',
      async generateCandidate() {
        generated += 1;
        const plan = deriveReadinessPlan(features);
        if (generated === 1) plan.readinessScore = 0;
        return plan;
      },
      async supervise() {
        supervised += 1;
        return { approved: true, codes: [] };
      },
    };
    assert.equal((await runPlanEngine(driver, features))?.readinessScore, 99);
    assert.deepEqual({ generated, supervised }, { generated: 2, supervised: 2 });
  });

  it('rejects after the bounded second failure', async () => {
    const features = cleanFeatures();
    let generated = 0;
    let supervised = 0;
    const driver: PlanDriver = {
      driver: 'mock',
      async generateCandidate() {
        generated += 1;
        return deriveReadinessPlan(features);
      },
      async supervise() {
        supervised += 1;
        return { approved: false, codes: ['SUPERVISOR_REJECTED'] };
      },
    };
    await assert.rejects(runPlanEngine(driver, features), { message: 'PLAN_REJECTED' });
    assert.deepEqual({ generated, supervised }, { generated: 2, supervised: 2 });
  });

  it('propagates one governed prompt version and persists both gate results', async () => {
    const prompt: ResolvedPrompt = Object.freeze({
      key: 'funding-readiness-plan',
      version: 2,
      body: 'Governed prompt body',
      source: 'database',
    });
    const base = createMockPlanDriver();
    const seen: ResolvedPrompt[] = [];
    const records: RecordEvalRunInput[] = [];
    const driver: PlanDriver = {
      driver: 'mock',
      async generateCandidate(features, supplied) {
        assert.deepEqual(supplied, prompt);
        seen.push(supplied);
        return base.generateCandidate(features, supplied);
      },
      async supervise(features, candidate, supplied) {
        assert.deepEqual(supplied, prompt);
        seen.push(supplied);
        return base.supervise(features, candidate, supplied);
      },
    };

    const plan = await runPlanEngine(driver, cleanFeatures(), {
      env: { FEATURE_ADMIN: 'true' },
      resolvePrompt: async () => prompt,
      recordEvaluation: async (input) => { records.push(input); },
    });

    assert.equal(seen.length, 2);
    assert.equal(plan?.prompt.version, 2);
    assert.equal(plan?.generation.promptVersion, 2);
    assert.deepEqual(records.map((record) => ({
      promptKey: record.promptKey,
      promptVersion: record.promptVersion,
      evaluatorKey: record.evaluatorKey,
      passed: record.passed,
      policyVersion: record.policyVersion,
      result: record.result,
    })), [
      {
        promptKey: 'funding-readiness-plan',
        promptVersion: 2,
        evaluatorKey: 'plan.supervisor',
        passed: true,
        policyVersion: 'eval-policy-2026-08-17-r2',
        result: { codes: [] },
      },
      {
        promptKey: 'funding-readiness-plan',
        promptVersion: 2,
        evaluatorKey: 'plan.deterministic',
        passed: true,
        policyVersion: 'eval-policy-2026-08-17-r2',
        result: { codes: [] },
      },
    ]);
    assert.ok(records.every((record) => record.driver === 'mock' && record.model === 'template-v1'));
    assert.ok(records.every((record) => record.eligible === false && /^sha256:[0-9a-f]{64}$/.test(record.referenceDatasetHash)));
  });

  it('fails closed when a governed gate result cannot be persisted', async () => {
    const prompt: ResolvedPrompt = Object.freeze({
      key: 'funding-readiness-plan',
      version: 2,
      body: 'Governed prompt body',
      source: 'database',
    });
    await assert.rejects(
      runPlanEngine(createMockPlanDriver(), cleanFeatures(), {
        env: { FEATURE_ADMIN: 'true' },
        resolvePrompt: async () => prompt,
        recordEvaluation: async () => { throw new Error('ADMIN_EVAL_WRITE_FAILED'); },
      }),
      { message: 'ADMIN_EVAL_WRITE_FAILED' },
    );
  });
});
