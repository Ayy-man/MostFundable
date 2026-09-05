/**
 * The narrative engine: resolve the governed prompt, write, check, record, return or give up.
 *
 * It mirrors `llm/engine.ts` deliberately — same prompt resolution when `FEATURE_ADMIN` is on, same
 * two attempts, same `recordEvaluation` dependency writing the evidence a prompt version needs
 * before it can be activated — with one difference that is the whole reason this module exists
 * separately: **it never throws and never fails an analysis.**
 *
 * `runPlanEngine` raises `PLAN_REJECTED` and the worker turns that into a failed, retryable job,
 * which is correct for the plan: the plan is the analysis. The narrative is prose about an analysis
 * that is already computed, already scored and already durable by the time this runs. A model
 * timeout, a schema miss, a hallucinated dollar figure — none of them is a reason to throw away a
 * consumer's credit pull and make them wait for a retry. So every failure path here returns `null`
 * and writes exactly one structured line, and the surface falls back to template copy.
 *
 * Two evaluators are recorded per attempt because the two failure kinds are diagnosed differently
 * and a single pass/fail would hide which one fired:
 *
 *   `narrative.grounding` — the shape, the numbers, the item notes, the step links.
 *   `narrative.language`  — the compliance vocabulary and the lender denylist.
 *
 * Both come out of one `checkNarrative` call, so they can never disagree about the same narrative.
 */

import { featureFlag, type EnvSource } from '../../env.ts';
import { recordEvalRun } from '../../admin/evals.ts';
import { resolveActivePrompt } from '../../admin/prompts.ts';
import { EVAL_POLICY_VERSION } from '../../admin/eval-policy.ts';
import { checkNarrative } from './grounding.ts';
import { NARRATIVE_EMBEDDED_PROMPT } from './prompt.ts';

import type { FactsPackV2, NarrativeV1 } from './contract.ts';
import type { NarrativeDriver } from './driver.ts';
import type { EmbeddedPrompt, RecordEvalRunInput, ResolvedPrompt } from '../../admin/prompt-types.ts';

const MAX_ATTEMPTS = 2;

/** Codes owned by this module, as against the checker's. One per way an attempt can end early. */
export const NARRATIVE_ENGINE_CODES = Object.freeze([
  'NARRATIVE_DRIVER_FAILED',
  'NARRATIVE_PROMPT_UNRESOLVED',
  'NARRATIVE_REJECTED',
] as const);

export interface NarrativeEngineDependencies {
  env: EnvSource;
  resolvePrompt(fallback: EmbeddedPrompt, env: EnvSource): Promise<ResolvedPrompt>;
  recordEvaluation(input: RecordEvalRunInput): Promise<unknown>;
  log(line: Record<string, unknown>): void;
}

const productionDependencies: NarrativeEngineDependencies = {
  env: process.env,
  resolvePrompt: (fallback, env) => resolveActivePrompt(fallback, undefined, env),
  recordEvaluation: (input) => recordEvalRun(input),
  log: (line) => {
    console.warn(JSON.stringify(line));
  },
};

/**
 * The reference-dataset hash the recorded evidence is bound to.
 *
 * `evaluationDatasetHash` in `admin/eval-policy.ts` hashes `DerivedFeatures`, which the narrative
 * lane does not hold; the facts pack is what this evaluator actually ran against. Hashing the pack
 * keeps the binding honest — the evidence names the input that produced it — and keeps the format
 * `admin_activate_prompt_version` requires, which is a `sha256:` prefix and 64 hex characters.
 */
export async function factsPackHash(pack: FactsPackV2): Promise<string> {
  const { createHash } = await import('node:crypto');
  return `sha256:${createHash('sha256').update(JSON.stringify(pack)).digest('hex')}`;
}

export async function runNarrativeEngine(
  driver: NarrativeDriver,
  pack: FactsPackV2,
  overrides: Partial<NarrativeEngineDependencies> = {},
): Promise<NarrativeV1 | null> {
  const deps = { ...productionDependencies, ...overrides };
  const governed = featureFlag('FEATURE_ADMIN', deps.env);

  let prompt: ResolvedPrompt;
  try {
    prompt = governed
      ? await deps.resolvePrompt(NARRATIVE_EMBEDDED_PROMPT, deps.env)
      : Object.freeze({ ...NARRATIVE_EMBEDDED_PROMPT, source: 'embedded' as const });
  } catch {
    deps.log({ event: 'narrative.unavailable', code: 'NARRATIVE_PROMPT_UNRESOLVED', driver: driver.driver });
    return null;
  }

  const datasetHash = governed ? await factsPackHash(pack) : null;
  let lastCodes: readonly string[] = [];

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let candidate: NarrativeV1;
    try {
      candidate = await driver.write(pack, prompt);
    } catch {
      // A transport fault, a truncated body, a schema miss at the provider. Nothing was written, so
      // there is nothing to evaluate; the next attempt is the only remedy and after that, none.
      lastCodes = ['NARRATIVE_DRIVER_FAILED'];
      continue;
    }

    const verdict = checkNarrative(candidate, pack);
    lastCodes = verdict.codes;

    if (governed && datasetHash !== null) {
      const languageCodes = verdict.codes.filter((code) => code === 'LANGUAGE' || code === 'LENDER_NAMED');
      const groundingCodes = verdict.codes.filter((code) => code !== 'LANGUAGE' && code !== 'LENDER_NAMED');
      const identity = {
        referenceDatasetHash: datasetHash,
        driver: driver.driver,
        model: candidate.generation.model,
        eligible: false,
      } as const;
      try {
        await deps.recordEvaluation({
          promptKey: prompt.key,
          promptVersion: prompt.version,
          evaluatorKey: 'narrative.grounding',
          passed: groundingCodes.length === 0,
          policyVersion: EVAL_POLICY_VERSION,
          ...identity,
          result: { codes: groundingCodes },
        });
        await deps.recordEvaluation({
          promptKey: prompt.key,
          promptVersion: prompt.version,
          evaluatorKey: 'narrative.language',
          passed: languageCodes.length === 0,
          policyVersion: EVAL_POLICY_VERSION,
          ...identity,
          result: { codes: languageCodes },
        });
      } catch {
        // Evidence is for the activation gate, not for this consumer's page. Losing it holds the
        // next prompt activation, which is the conservative outcome; it must not cost a narrative
        // that the checker has already approved.
      }
    }

    if (verdict.approved) return candidate;
  }

  deps.log({
    event: 'narrative.unavailable',
    code: lastCodes.includes('NARRATIVE_DRIVER_FAILED') ? 'NARRATIVE_DRIVER_FAILED' : 'NARRATIVE_REJECTED',
    driver: driver.driver,
    model: driver.model,
    promptKey: prompt.key,
    promptVersion: prompt.version,
    attempts: MAX_ATTEMPTS,
    codes: lastCodes,
  });
  return null;
}
