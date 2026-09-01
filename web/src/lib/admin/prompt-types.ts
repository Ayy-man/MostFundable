import type { EnvSource } from "@/lib/env";

export const PROMPT_KEYS = ["funding-readiness-plan", "support-draft"] as const;
export type PromptKey = (typeof PROMPT_KEYS)[number];

/**
 * The evaluators every prompt family must pass before a version may activate.
 *
 * It lives here rather than in `prompt-evaluator.ts` because that module is
 * `server-only` and the admin surface has to name the gate it is describing.
 * The surface derives its wording from this object at render time instead of
 * transcribing a count, which is the failure the release-threshold slider used
 * to produce: it read "75% · 4 enabled" off four illustrative evaluator rows
 * while activation was decided here, by this list, and by nothing else.
 */
export const MANDATORY_PROMPT_EVALUATORS = Object.freeze({
  "funding-readiness-plan": Object.freeze(["plan.supervisor", "plan.deterministic"]),
  "support-draft": Object.freeze(["support.supervisor", "support.language", "support.confidence"]),
} as const);

export type EmbeddedPrompt = Readonly<{
  key: PromptKey;
  version: 1;
  body: string;
}>;

export type ResolvedPrompt = Readonly<{
  key: PromptKey;
  version: number;
  body: string;
  source: "database" | "embedded";
}>;

export type PromptVersionRow = Readonly<{
  key: PromptKey;
  version: number;
  body: string;
  active: boolean;
  createdBy: string | null;
  createdAt: string;
}>;

export type PromptActivationDecision = Readonly<{
  status: "activated" | "held";
  reason: "evaluation_evidence_missing" | null;
  prompt: PromptVersionRow;
}>;

export type PromptEvaluationSummary = Readonly<{
  key: PromptKey;
  version: number;
  passed: boolean;
  status: "completed" | "held";
  reason: "launch_driver_unavailable" | null;
  runs: readonly EvalRunRow[];
}>;

export type EvalRunRow = Readonly<{
  id: string;
  promptKey: PromptKey;
  promptVersion: number;
  evaluatorKey: string;
  passed: boolean;
  policyVersion: string;
  referenceDatasetHash: string;
  driver: "mock" | "openrouter";
  model: string;
  eligible: boolean;
  result: Readonly<Record<string, unknown>>;
  ranBy: string | null;
  ranAt: string;
}>;

export type RecordEvalRunInput = Readonly<{
  promptKey: PromptKey;
  promptVersion: number;
  evaluatorKey: string;
  passed: boolean;
  policyVersion: string;
  referenceDatasetHash: string;
  driver: "mock" | "openrouter";
  model: string;
  eligible: boolean;
  result: Readonly<Record<string, unknown>>;
  actorId?: string | null;
}>;

export interface PromptReadRepository {
  readActive(key: PromptKey): Promise<readonly PromptVersionRow[]>;
  listVersions(key: PromptKey): Promise<readonly PromptVersionRow[]>;
}

export interface PromptWriteRepository {
  createVersion(key: PromptKey, body: string, fallbackBody: string, actorId: string): Promise<PromptVersionRow>;
  activateVersion(key: PromptKey, version: number, actorId: string): Promise<PromptActivationDecision>;
}

export type PromptRepository = PromptReadRepository & PromptWriteRepository;

export interface EvalRepository {
  record(input: RecordEvalRunInput): Promise<EvalRunRow>;
  list(filters?: { promptKey?: PromptKey; promptVersion?: number; limit?: number }): Promise<readonly EvalRunRow[]>;
  read(id: string): Promise<EvalRunRow | null>;
}

export type PromptResolver = (
  fallback: EmbeddedPrompt,
  repository?: PromptReadRepository,
  env?: EnvSource,
) => Promise<ResolvedPrompt>;
