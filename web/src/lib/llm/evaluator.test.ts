import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { NORMALIZED_ADVERSARIAL_LANGUAGE, ROUND_3_ADVERSARIAL_CASES } from '../compliance/__fixtures__/adversarial-language.mjs';
import { cleanFeatures, derogFeatures } from './__fixtures__/features.ts';
import { runPlanEngine } from './engine.ts';
import { evaluatePlan, evaluateText } from './evaluator.ts';
import { deriveReadinessPlan } from './mock-driver.ts';

import type { FundingReadinessPlanV1, PlanDriver } from './types.ts';

const CONTAINED_FIXTURE = JSON.parse(
  readFileSync(
    new URL('./__fixtures__/compliance/poisoned-plan.json', import.meta.url),
    'utf8',
  ),
) as FundingReadinessPlanV1;

function clonePlan(): FundingReadinessPlanV1 {
  return structuredClone(deriveReadinessPlan(derogFeatures()));
}

describe('plan evaluator', () => {
  it('accepts a locally derived plan', () => {
    assert.deepEqual(evaluatePlan(clonePlan(), derogFeatures()), { approved: true, codes: [] });
  });

  it('rejects score and completion-label overrides', () => {
    const plan = deriveReadinessPlan(cleanFeatures());
    plan.readinessScore = 100;
    plan.readinessLabel = 'Ready';
    const result = evaluatePlan(plan, cleanFeatures());
    assert.equal(result.approved, false);
    assert.equal(result.codes.includes('SCORE_VALUE'), true);
    assert.equal(result.codes.includes('READINESS_LABEL'), true);
  });

  it('rejects unknown keys at every recursive level', () => {
    const plan = clonePlan() as FundingReadinessPlanV1 & { extra?: boolean };
    plan.extra = true;
    assert.equal(evaluatePlan(plan, derogFeatures()).codes.includes('PLAN_SCHEMA'), true);

    delete plan.extra;
    const state = plan.personalChecklist[0] as FundingReadinessPlanV1['personalChecklist'][number] & {
      extra?: boolean;
    };
    state.extra = true;
    assert.equal(evaluatePlan(plan, derogFeatures()).codes.includes('STATE_SCHEMA'), true);
  });

  it('rejects seed, state, marker, and estimate drift', () => {
    const plan = clonePlan();
    [plan.personalChecklist[0], plan.personalChecklist[1]] = [
      plan.personalChecklist[1],
      plan.personalChecklist[0],
    ];
    plan.personalChecklist[2].state = 'verified';
    plan.businessChecklist[0].todo = 'TODO(#126)' as never;
    plan.estimatedCompletion = { label: 'TBD', days: 1 } as never;
    const result = evaluatePlan(plan, derogFeatures());
    assert.equal(result.approved, false);
    assert.equal(result.codes.includes('STATE_KEY_ORDER'), true);
    assert.equal(result.codes.includes('STATE_VALUE'), true);
    assert.equal(result.codes.includes('STATE_MARKER'), true);
    assert.equal(result.codes.includes('COMPLETION_ESTIMATE'), true);
  });

  it('rejects account provenance and observed-number drift', () => {
    const plan = clonePlan();
    const child = plan.personalChecklist[3].children[0];
    child.accountRef = 'opaque-unknown';
    child.observedUtilizationPct = 30;
    const result = evaluatePlan(plan, derogFeatures());
    assert.equal(result.codes.includes('CHILD_ACCOUNT_REF'), true);
    assert.equal(result.codes.includes('CHILD_NUMBER'), true);
  });

  it('rejects a missing qualifying account state', () => {
    const plan = clonePlan();
    plan.personalChecklist[3].children.pop();
    assert.equal(evaluatePlan(plan, derogFeatures()).codes.includes('CHILD_COUNT'), true);
  });

  it('blocks every canonical language family with fixed codes', () => {
    const encodedValues = [
      'VGhlIGRpc3B1dGUgd2luZG93IGNsb3Nlcy4=',
      'U2VjdGlvbiA2MDkgbGV0dGVyIHRlbXBsYXRl',
      'cGF5IGZvciBkZWxldGU=',
      'dGhlIHJlbW92YWwgcmVxdWVzdA==',
      'Y3JlZGl0IHJlcGFpciBzZXJ2aWNl',
      'Z29vZHdpbGwgbGV0dGVy',
      'KzQwIHB0cw==',
      'cmFpc2UgeW91ciBzY29yZSBieSA0MA==',
      'Z2FpbiAyNSBwb2ludHMgb24geW91ciBzY29yZQ==',
      'YXBwcm92YWwgb2RkcyBzaG93bg==',
      'YXBwcm92YWwgb2RkcyA4MiU=',
      'Q3JlZGl0IFNlcnZpY2VzIEFncmVlbWVudA==',
      'QSA0MC1wb2ludCBzY29yZSBpbmNyZWFzZSBpcyBleHBlY3RlZC4=',
      'WW91IGFyZSA4MiUgbGlrZWx5IHRvIGJlIGFwcHJvdmVkLg==',
    ];

    for (const [index, encoded] of encodedValues.entries()) {
      const plan = clonePlan();
      plan.businessChecklist[0].title = atob(encoded);
      const result = evaluatePlan(plan, derogFeatures());
      assert.equal(result.codes.includes(`LANGUAGE_C${String(index + 1).padStart(2, '0')}`), true);
    }
  });

  it('rejects the new adversarial forms through the complete plan engine', async () => {
    for (const candidate of NORMALIZED_ADVERSARIAL_LANGUAGE) {
      const driver: PlanDriver = {
        driver: 'mock',
        async generateCandidate() {
          const plan = clonePlan();
          plan.businessChecklist[0].title = candidate;
          return plan;
        },
        async supervise() { return { approved: true, codes: [] }; },
      };
      await assert.rejects(runPlanEngine(driver, derogFeatures()), { message: 'PLAN_REJECTED' });
    }
  });

  it('rejects every round-three reproduced form through evaluateText', () => {
    for (const testCase of ROUND_3_ADVERSARIAL_CASES) {
      const evaluation = evaluateText(testCase.text);
      assert.equal(evaluation.approved, false, testCase.text);
      assert.ok(evaluation.codes.includes(testCase.expectedCode), testCase.text);
    }
  });

  it('blocks contained negative data before the caller can persist it', async () => {
    const features = cleanFeatures();
    const evaluation = evaluatePlan(CONTAINED_FIXTURE, features);
    assert.equal(evaluation.approved, false);
    // R5D-04. The widened C21 reaches the fixture's C09 line too — the same movement of the
    // restricted metric, written with an adverb instead of a verb. Named here rather than filtered
    // away, so the assertion stays exact and an undecided new code still fails it.
    assert.deepEqual(
      evaluation.codes.filter((code) => code.startsWith('LANGUAGE_')),
      [
        ...Array.from({ length: 11 }, (_, index) =>
          `LANGUAGE_C${String(index + 1).padStart(2, '0')}`,
        ),
        'LANGUAGE_C21',
      ],
    );

    let persisted = 0;
    const persist = () => {
      persisted += 1;
    };
    const driver: PlanDriver = {
      driver: 'mock',
      async generateCandidate() {
        return structuredClone(CONTAINED_FIXTURE);
      },
      async supervise() {
        return { approved: true, codes: [] };
      },
    };
    const runAtCallerBoundary = async () => {
      const plan = await runPlanEngine(driver, features);
      if (plan !== null) persist();
    };

    await assert.rejects(runAtCallerBoundary(), { message: 'PLAN_REJECTED' });
    assert.equal(persisted, 0);
  });
});
