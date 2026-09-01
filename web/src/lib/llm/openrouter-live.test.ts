import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cleanFeatures } from './__fixtures__/features.ts';
import { evaluatePlan } from './evaluator.ts';
import {
  createOpenRouterPlanDriver,
  OPENROUTER_MODEL,
} from './openrouter-driver.ts';

const RUN_CATALOG = process.env.OPENROUTER_LIVE_CATALOG === '1';
const ACCOUNT_KEY = process.env.OPENROUTER_API_KEY;
const RUN_ACCOUNT =
  process.env.AI_DRIVER?.trim().toLowerCase() === 'openrouter' &&
  ACCOUNT_KEY !== undefined &&
  ACCOUNT_KEY.trim() !== '';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function endpointSupportsStructuredOutput(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const model = value.model_id ?? value.model ?? value.id;
  if (model !== OPENROUTER_MODEL || !Array.isArray(value.supported_parameters)) return false;
  return (
    value.supported_parameters.includes('response_format') ||
    value.supported_parameters.includes('structured_outputs')
  );
}

describe('OpenRouter live contracts', () => {
  it(
    'finds a structured-output endpoint for the exact model in the public ZDR catalog',
    { skip: RUN_CATALOG ? false : 'explicit public catalog probe not requested' },
    async () => {
      const response = await fetch('https://openrouter.ai/api/v1/endpoints/zdr');
      assert.equal(response.ok, true);
      const envelope: unknown = await response.json();
      assert.ok(isRecord(envelope));
      assert.ok(Array.isArray(envelope.data));
      assert.equal(envelope.data.some(endpointSupportsStructuredOutput), true);
    },
  );

  it(
    'routes the clean derived fixture through candidate, supervisor, and local evaluation',
    { skip: RUN_ACCOUNT ? false : 'account key or explicit openrouter selector absent' },
    async () => {
      const driver = createOpenRouterPlanDriver({ apiKey: ACCOUNT_KEY });
      const features = cleanFeatures();
      const candidate = await driver.generateCandidate(features);
      const verdict = await driver.supervise(features, candidate);
      const evaluation = evaluatePlan(candidate, features);
      assert.equal(driver.driver, 'openrouter');
      assert.equal(candidate.generation.model, OPENROUTER_MODEL);
      assert.equal(verdict.approved, true);
      assert.equal(evaluation.approved, true);
    },
  );
});
