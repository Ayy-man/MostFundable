import { createHash } from "node:crypto";

import { cleanFeatures, derogFeatures } from "@/lib/llm/__fixtures__/features";
import { OPENROUTER_MODEL } from "@/lib/llm/openrouter-driver";
import { MOCK_PLAN_MODEL } from "@/lib/llm/mock-driver";
import { MOCK_SUPPORT_DRAFT_MODEL } from "@/lib/support/mock-driver";
import { MOCK_NARRATIVE_MODEL, narrativeModelFrom } from "@/lib/llm/narrative/models";
import { NARRATIVE_REFERENCE_DATASET } from "@/lib/llm/narrative/reference-pack";
import {
  resolveDriverFromSpecWithDeprecatedSelector,
  type DriverSpec,
  type EnvSource,
} from "@/lib/env";

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

export const EVAL_REFERENCE_DATASET_HASHES: Readonly<Record<PromptKey, string>> = Object.freeze({
  "funding-readiness-plan": evaluationDatasetHash(PLAN_REFERENCE_DATASET),
  "funding-readiness-narrative": evaluationDatasetHash(NARRATIVE_REFERENCE_DATASET),
  "support-draft": evaluationDatasetHash(SUPPORT_REFERENCE_DATASET),
});

/**
 * The eval policy's own driver table.
 *
 * The identity a recorded eval run carries — which driver and which model
 * produced it — used to come from `AI_DRIVER`, shared with the assistants and
 * the support draft engine. That made a prompt activation's eligibility a side
 * effect of a deployment decision about something else: flipping the assistants
 * onto a provider turned `launch_driver_unavailable` into a live evaluation run,
 * and flipping them back made every recorded run's identity a claim about a
 * driver the platform no longer ran. `EVAL_DRIVER` decides whether evaluation
 * runs count, and decides nothing else.
 *
 * `AI_DRIVER` is read as a fallback while this key is blank, for one release.
 */
export const EVAL_DRIVERS = {
  selector: "EVAL_DRIVER",
  values: ["mock", "openrouter"],
  fallback: "mock",
  requires: { openrouter: ["OPENROUTER_API_KEY"] },
} as const satisfies DriverSpec;

export type EvalDriverName = (typeof EVAL_DRIVERS)["values"][number];

export function resolveEvalDriver(env: EnvSource = process.env): EvalDriverName {
  return resolveDriverFromSpecWithDeprecatedSelector("eval", EVAL_DRIVERS, "AI_DRIVER", env);
}

export function promptEvaluationIdentity(key: PromptKey, env: EnvSource = process.env) {
  const driver = resolveEvalDriver(env);
  // The narrative lane runs its own model rather than the transport constant every other
  // operation shares, so its live identity is whatever `NARRATIVE_MODEL` selects. Recording
  // `OPENROUTER_MODEL` for it would bind the evidence to a model that never wrote the narrative,
  // and `admin_activate_prompt_version` compares the recorded model against the running one.
  const model = driver === "openrouter"
    ? (key === "funding-readiness-narrative" ? narrativeModelFrom(env) : OPENROUTER_MODEL)
    : key === "funding-readiness-plan"
      ? MOCK_PLAN_MODEL
      : key === "funding-readiness-narrative"
        ? MOCK_NARRATIVE_MODEL
        : MOCK_SUPPORT_DRAFT_MODEL;
  return Object.freeze({
    driver,
    model,
    policyVersion: EVAL_POLICY_VERSION,
    referenceDatasetHash: EVAL_REFERENCE_DATASET_HASHES[key],
  });
}
