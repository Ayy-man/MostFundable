import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cleanFeatures, derogFeatures, thinFileFeatures } from './__fixtures__/features.ts';
import { computeReadinessScore } from './evaluator.ts';
import { createMockPlanDriver, deriveReadinessPlan } from './mock-driver.ts';

describe('mock plan driver', () => {
  it('keeps the complete measurable persona below complete readiness', async () => {
    const features = cleanFeatures();
    const plan = await createMockPlanDriver().generateCandidate(features);

    assert.equal(plan.readinessScore, 99);
    assert.equal(plan.readinessLabel, 'Near Ready');
    assert.equal(plan.personalChecklist.filter((item) => item.state === 'unverified').length, 2);
    assert.equal(plan.businessChecklist.every((item) => item.state === 'unverified'), true);
  });

  it('emits one stable utilization state per qualifying derog account', () => {
    const plan = deriveReadinessPlan(derogFeatures());
    const utilization = plan.personalChecklist.find((item) => item.key === 'utilization_under_30');

    assert.equal(plan.readinessScore, 33);
    assert.equal(plan.readinessLabel, 'Building Readiness');
    assert.deepEqual(
      utilization?.children.map((item) => item.accountRef),
      ['mock-acct-dg1', 'mock-acct-dg2', 'mock-acct-dg3', 'mock-acct-dg4'],
    );
    assert.deepEqual(
      utilization?.children.map((item) => item.observedUtilizationPct),
      [92.9, 92.8, 64.7, 86.7],
    );
  });

  it('keeps thin-file limiting states unverified', () => {
    const plan = deriveReadinessPlan(thinFileFeatures());
    assert.equal(plan.readinessScore, 50);
    assert.equal(plan.personalChecklist[3].state, 'unverified');
    assert.equal(plan.personalChecklist[4].state, 'unverified');
    assert.equal(plan.personalChecklist[6].state, 'unverified');
  });

  it('is deeply deterministic for the same derived input', async () => {
    const driver = createMockPlanDriver();
    const features = derogFeatures();
    const first = await driver.generateCandidate(features);
    const second = await driver.generateCandidate(structuredClone(features));
    assert.deepEqual(first, second);
    assert.deepEqual(await driver.supervise(features, first), { approved: true, codes: [] });
  });

  it('rounds every measurable-score boundary and applies the incomplete cap', () => {
    const features = cleanFeatures();
    const keys = [
      'utilizationUnder30',
      'fourOrMorePersonalAccountsOpen',
      'averageAgeTwoYearsOrMore',
      'noNegativeItemsReported',
      'cardWithTenKLimit',
      'twoOrFewerInquiriesEveryBureau',
    ] as const;

    assert.deepEqual(
      Array.from({ length: 7 }, (_, enabled) => {
        for (const [index, key] of keys.entries()) features.flags[key] = index < enabled;
        return computeReadinessScore(features);
      }),
      [0, 17, 33, 50, 67, 83, 99],
    );
  });
});
