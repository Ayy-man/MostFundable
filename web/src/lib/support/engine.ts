// SUPP-04: three gates, and a draft is sendable only when all three clear.
//
// Nothing here persists, and nothing here takes a database client — the engine
// is a pure function so it can be walked exhaustively in milliseconds, and so
// migration 100's `held_drafts_gates_for_approval` can re-derive the same
// verdict in SQL without either side trusting the other. A bug on this side
// therefore produces a draft nobody can send rather than one anybody can.
//
// There is no retry loop, which is the one place this deliberately departs from
// `runPlanEngine`'s MAX_ATTEMPTS. A rejected plan has nowhere to go, so
// regenerating it is free. A rejected *draft* is a legitimate persisted
// artifact that a person reads and decides about, and quietly regenerating over
// it would hide the rejection from the audit record.

import { evaluateDraftLanguage } from './language-gate.ts';
import { SUPPORT_DRAFT_EMBEDDED_PROMPT } from './prompt.ts';
import { featureFlag, type EnvSource } from '../env.ts';
import { recordEvalRun } from '../admin/evals.ts';
import { resolveActivePrompt } from '../admin/prompts.ts';
import { EVAL_POLICY_VERSION, evaluationDatasetHash } from '../admin/eval-policy.ts';

import type {
  SupportDraftContext,
  SupportDraftDecision,
  SupportDraftDriver,
  SupportDraftReasonCode,
} from './types.ts';
import type { RecordEvalRunInput, ResolvedPrompt } from '../admin/prompt-types.ts';

export interface DraftEngineDependencies {
  readonly env: EnvSource;
  readonly resolvePrompt: (
    fallback: typeof SUPPORT_DRAFT_EMBEDDED_PROMPT,
    env: EnvSource,
  ) => Promise<ResolvedPrompt>;
  readonly recordEvaluation: (input: RecordEvalRunInput) => Promise<unknown>;
}

const productionDependencies: DraftEngineDependencies = {
  env: process.env,
  resolvePrompt: (fallback, env) => resolveActivePrompt(fallback, undefined, env),
  recordEvaluation: (input) => recordEvalRun(input),
};

function reasonFor(
  supervisorApproved: boolean,
  guardrailFlags: readonly string[],
  confidence: number,
  confidenceThreshold: number,
): SupportDraftReasonCode {
  if (!supervisorApproved) return 'supervisor_rejected';
  if (guardrailFlags.length > 0) return 'guardrail_flagged';
  if (confidence < confidenceThreshold) return 'confidence_below_threshold';
  return 'gates_passed';
}

/**
 * Generate, supervise, screen, and derive the verdict.
 *
 * The driver is called exactly once per invocation — once for the candidate and
 * once for the supervisor pass over that same candidate.
 */
export async function runDraftEngine(
  driver: SupportDraftDriver,
  context: SupportDraftContext,
  confidenceThreshold: number,
  overrides: Partial<DraftEngineDependencies> = {},
): Promise<SupportDraftDecision> {
  const deps = { ...productionDependencies, ...overrides };
  const governed = featureFlag('FEATURE_ADMIN', deps.env);
  const prompt: ResolvedPrompt = governed
    ? await deps.resolvePrompt(SUPPORT_DRAFT_EMBEDDED_PROMPT, deps.env)
    : Object.freeze({ ...SUPPORT_DRAFT_EMBEDDED_PROMPT, source: 'embedded' as const });
  const candidate = await driver.generateDraft(context, prompt);
  const verdict = await driver.superviseDraft(context, candidate, prompt);
  const guardrailFlags = evaluateDraftLanguage(candidate.body);

  const reasonCode = reasonFor(
    verdict.approved,
    guardrailFlags,
    candidate.confidence,
    confidenceThreshold,
  );

  if (governed) {
    const evaluationIdentity = {
      referenceDatasetHash: evaluationDatasetHash([context]),
      driver: driver.driver,
      model: candidate.model,
      eligible: false,
    } as const;
    await deps.recordEvaluation({
      promptKey: prompt.key,
      promptVersion: prompt.version,
      evaluatorKey: 'support.supervisor',
      passed: verdict.approved,
      policyVersion: EVAL_POLICY_VERSION,
      ...evaluationIdentity,
      result: { codes: verdict.codes },
    });
    await deps.recordEvaluation({
      promptKey: prompt.key,
      promptVersion: prompt.version,
      evaluatorKey: 'support.language',
      passed: guardrailFlags.length === 0,
      policyVersion: EVAL_POLICY_VERSION,
      ...evaluationIdentity,
      result: { codes: guardrailFlags },
    });
    await deps.recordEvaluation({
      promptKey: prompt.key,
      promptVersion: prompt.version,
      evaluatorKey: 'support.confidence',
      passed: candidate.confidence >= confidenceThreshold,
      policyVersion: EVAL_POLICY_VERSION,
      ...evaluationIdentity,
      result: { confidence: candidate.confidence, threshold: confidenceThreshold },
    });
  }

  return {
    body: candidate.body,
    confidence: candidate.confidence,
    confidenceThreshold,
    supervisorApproved: verdict.approved,
    guardrailFlags,
    driver: driver.driver,
    model: candidate.model,
    promptKey: prompt.key,
    promptVersion: prompt.version,
    status: reasonCode === 'gates_passed' ? 'approved' : 'draft',
    reasonCode,
  };
}
