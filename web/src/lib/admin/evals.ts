import type { EvalRepository, EvalRunRow, PromptKey, RecordEvalRunInput } from "./prompt-types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVALUATOR = /^[a-z][a-z0-9._-]{0,63}$/;
const KEYS = new Set<PromptKey>(["funding-readiness-plan", "support-draft"]);
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function parseEvalRunRow(value: unknown): EvalRunRow {
  if (!record(value)) throw new Error("ADMIN_EVAL_RESULT_INVALID");
  const promptKey = "prompt_key" in value ? value.prompt_key : value.promptKey;
  const promptVersion = "prompt_version" in value ? value.prompt_version : value.promptVersion;
  const evaluatorKey = "evaluator_key" in value ? value.evaluator_key : value.evaluatorKey;
  const policyVersion = "policy_version" in value ? value.policy_version : value.policyVersion;
  const referenceDatasetHash = "reference_dataset_hash" in value ? value.reference_dataset_hash : value.referenceDatasetHash;
  const ranBy = "ran_by" in value ? value.ran_by : value.ranBy;
  const ranAt = "ran_at" in value ? value.ran_at : value.ranAt;
  if (
    typeof value.id !== "string" || !UUID.test(value.id) ||
    typeof promptKey !== "string" || !KEYS.has(promptKey as PromptKey) ||
    !Number.isSafeInteger(promptVersion) || (promptVersion as number) < 1 ||
    typeof evaluatorKey !== "string" || !EVALUATOR.test(evaluatorKey) ||
    typeof value.passed !== "boolean" || typeof policyVersion !== "string" || !EVALUATOR.test(policyVersion) ||
    typeof referenceDatasetHash !== "string" || !/^sha256:[0-9a-f]{64}$/.test(referenceDatasetHash) ||
    (value.driver !== "mock" && value.driver !== "openrouter") ||
    typeof value.model !== "string" || value.model.length < 1 || value.model.length > 128 ||
    typeof value.eligible !== "boolean" ||
    !record(value.result) || JSON.stringify(value.result).length > 16_384 ||
    !(ranBy === null || (typeof ranBy === "string" && UUID.test(ranBy))) ||
    typeof ranAt !== "string" || !Number.isFinite(Date.parse(ranAt))
  ) throw new Error("ADMIN_EVAL_RESULT_INVALID");
  return Object.freeze({
    id: value.id,
    promptKey: promptKey as PromptKey,
    promptVersion: promptVersion as number,
    evaluatorKey,
    passed: value.passed,
    policyVersion,
    referenceDatasetHash,
    driver: value.driver,
    model: value.model,
    eligible: value.eligible,
    result: Object.freeze({ ...value.result }),
    ranBy,
    ranAt,
  });
}

async function productionRepository(): Promise<EvalRepository> {
  const { createEvalRepository } = await import("./prompt-repository.ts");
  return createEvalRepository();
}

export async function recordEvalRun(input: RecordEvalRunInput, repository?: EvalRepository): Promise<EvalRunRow> {
  if (!KEYS.has(input.promptKey) || !Number.isSafeInteger(input.promptVersion) || input.promptVersion < 1 || !EVALUATOR.test(input.evaluatorKey) || !EVALUATOR.test(input.policyVersion) || !/^sha256:[0-9a-f]{64}$/.test(input.referenceDatasetHash) || !["mock", "openrouter"].includes(input.driver) || !input.model || input.model.length > 128 || typeof input.eligible !== "boolean" || !record(input.result)) {
    throw new Error("ADMIN_EVAL_INPUT_INVALID");
  }
  return (repository ?? await productionRepository()).record(input);
}

export async function listEvalRuns(
  filters: { promptKey?: PromptKey; promptVersion?: number; limit?: number } = {},
  repository?: EvalRepository,
): Promise<readonly EvalRunRow[]> {
  const limit = filters.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error("ADMIN_EVAL_FILTER_INVALID");
  return (repository ?? await productionRepository()).list({ ...filters, limit });
}

export async function readEvalRun(id: string, repository?: EvalRepository): Promise<EvalRunRow | null> {
  if (!UUID.test(id)) throw new Error("ADMIN_EVAL_ID_INVALID");
  return (repository ?? await productionRepository()).read(id);
}

export type { EvalRepository, EvalRunRow, RecordEvalRunInput } from "./prompt-types.ts";
