import { createHash } from "node:crypto";

import { cleanFeatures, derogFeatures } from "@/lib/llm/__fixtures__/features";
import { OPENROUTER_MODEL } from "@/lib/llm/openrouter-driver";
import { MOCK_PLAN_MODEL } from "@/lib/llm/mock-driver";
import { MOCK_SUPPORT_DRAFT_MODEL } from "@/lib/support/mock-driver";
import { resolveDriver, type EnvSource } from "@/lib/env";

import type { DerivedFeatures } from "@/lib/analysis/features";
import type { SupportDraftContext } from "@/lib/support/types";
import type { PromptKey } from "./prompt-types.ts";

// Bump this value whenever evaluator rules or either fixed reference dataset changes.
export const EVAL_POLICY_VERSION = "eval-policy-2026-08-17-r2";

export const PLAN_REFERENCE_DATASET: readonly DerivedFeatures[] = Object.freeze([
  cleanFeatures(),
  derogFeatures(),
]);

export const SUPPORT_REFERENCE_DATASET: readonly SupportDraftContext[] = Object.freeze([
  Object.freeze({
    threadKind: "team_chat",
    threadSubject: "Status request",
    recentMessages: Object.freeze([{ authorKind: "consumer" as const, body: "Could I get a status update?" }]),
  }),
  Object.freeze({
    threadKind: "platform_support",
    threadSubject: "Document question",
    recentMessages: Object.freeze([{ authorKind: "operator" as const, body: "Where should I upload the statement?" }]),
  }),
]);

export function evaluationDatasetHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export const EVAL_REFERENCE_DATASET_HASHES = Object.freeze({
  "funding-readiness-plan": evaluationDatasetHash(PLAN_REFERENCE_DATASET),
  "support-draft": evaluationDatasetHash(SUPPORT_REFERENCE_DATASET),
});

export function promptEvaluationIdentity(key: PromptKey, env: EnvSource = process.env) {
  const driver = resolveDriver("ai", env);
  const model = driver === "openrouter"
    ? OPENROUTER_MODEL
    : key === "funding-readiness-plan"
      ? MOCK_PLAN_MODEL
      : MOCK_SUPPORT_DRAFT_MODEL;
  return Object.freeze({
    driver,
    model,
    policyVersion: EVAL_POLICY_VERSION,
    referenceDatasetHash: EVAL_REFERENCE_DATASET_HASHES[key],
  });
}
