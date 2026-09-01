import { KPI_METRIC_KEYS } from "./analytics-types.ts";
import { PROMPT_KEYS } from "./prompt-types.ts";
import { GOVERNED_SETTING_KEYS } from "./settings-types.ts";

import type { AdminLayoutRow, KpiMetricKey, KpiMetrics, KpiRollupRow } from "./analytics-types.ts";
import type { EvalRunRow, PromptActivationDecision, PromptKey, PromptVersionRow } from "./prompt-types.ts";
import type { GovernedSettingKey, SettingRow } from "./settings-types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const EVALUATOR = /^[a-z][a-z0-9._-]{0,63}$/;
const KPI_KEYS = new Set<string>(KPI_METRIC_KEYS);
const PROMPTS = new Set<string>(PROMPT_KEYS);
const SETTINGS = new Set<string>(GOVERNED_SETTING_KEYS);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validDay(day: string): boolean {
  if (!DAY.test(day)) return false;
  const date = new Date(`${day}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === day;
}

function parseMetrics(value: unknown): KpiMetrics {
  if (!record(value) || Object.keys(value).length !== KPI_METRIC_KEYS.length) {
    throw new Error("ADMIN_KPI_RESULT_INVALID");
  }
  const output = {} as Record<KpiMetricKey, number | null>;
  for (const key of KPI_METRIC_KEYS) {
    const metric = value[key];
    if (!(metric === null || (typeof metric === "number" && Number.isFinite(metric)))) {
      throw new Error("ADMIN_KPI_RESULT_INVALID");
    }
    output[key] = metric;
  }
  return Object.freeze(output);
}

export function parseClientKpiRollup(value: unknown): KpiRollupRow {
  if (!record(value)) throw new Error("ADMIN_KPI_RESULT_INVALID");
  const subjectId = "subject_id" in value ? value.subject_id : value.subjectId;
  const updatedAt = "updated_at" in value ? value.updated_at : value.updatedAt;
  if (
    (value.scope !== "org" && value.scope !== "member" && value.scope !== "platform") ||
    typeof subjectId !== "string" || !subjectId.trim() ||
    typeof value.day !== "string" || !validDay(value.day) ||
    typeof updatedAt !== "string" || !Number.isFinite(Date.parse(updatedAt))
  ) throw new Error("ADMIN_KPI_RESULT_INVALID");
  const expectedScope = subjectId === "platform" ? "platform" : subjectId.startsWith("org:") ? "org" : "member";
  if (value.scope !== expectedScope) throw new Error("ADMIN_KPI_RESULT_INVALID");
  return Object.freeze({ scope: value.scope, subjectId, day: value.day, metrics: parseMetrics(value.metrics), updatedAt });
}

export function parseClientAdminLayout(value: unknown): AdminLayoutRow {
  if (!record(value)) throw new Error("ADMIN_LAYOUT_RESULT_INVALID");
  const profileId = "profile_id" in value ? value.profile_id : value.profileId;
  const updatedAt = "updated_at" in value ? value.updated_at : value.updatedAt;
  if (
    typeof profileId !== "string" || !UUID.test(profileId) ||
    !Array.isArray(value.layout) || value.layout.length < 1 || value.layout.length > 8 ||
    new Set(value.layout).size !== value.layout.length ||
    !value.layout.every((key) => typeof key === "string" && KPI_KEYS.has(key)) ||
    typeof updatedAt !== "string" || !Number.isFinite(Date.parse(updatedAt))
  ) throw new Error("ADMIN_LAYOUT_RESULT_INVALID");
  return Object.freeze({ profileId, layout: Object.freeze([...(value.layout as KpiMetricKey[])]), updatedAt });
}

function validSettingValue(key: GovernedSettingKey, value: unknown): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (key === "SUPPORT_DRAFT_CONFIDENCE_THRESHOLD") return value > 0 && value <= 1;
  if (!Number.isSafeInteger(value)) return false;
  if (key === "TRIAL_DAYS" || key === "OPERATOR_GRACE_DAYS") return value >= 1 && value <= 365;
  return value >= 1 && value <= 100_000_000;
}

export function parseClientSettingRow(value: unknown): SettingRow {
  if (!record(value) || typeof value.key !== "string" || !SETTINGS.has(value.key)) {
    throw new Error("ADMIN_SETTINGS_RESULT_INVALID");
  }
  const key = value.key as GovernedSettingKey;
  const updatedBy = "updated_by" in value ? value.updated_by : value.updatedBy;
  const updatedAt = "updated_at" in value ? value.updated_at : value.updatedAt;
  if (
    !validSettingValue(key, value.value) ||
    !(updatedBy === null || (typeof updatedBy === "string" && UUID.test(updatedBy))) ||
    typeof updatedAt !== "string" || !Number.isFinite(Date.parse(updatedAt))
  ) throw new Error("ADMIN_SETTINGS_RESULT_INVALID");
  return Object.freeze({ key, value: value.value, updatedBy, updatedAt });
}

export function parseClientPromptVersionRow(value: unknown): PromptVersionRow {
  if (!record(value)) throw new Error("ADMIN_PROMPTS_RESULT_INVALID");
  const createdBy = "created_by" in value ? value.created_by : value.createdBy;
  const createdAt = "created_at" in value ? value.created_at : value.createdAt;
  if (
    typeof value.key !== "string" || !PROMPTS.has(value.key) ||
    !Number.isSafeInteger(value.version) || (value.version as number) < 1 ||
    typeof value.body !== "string" || !value.body.trim() || value.body.length > 50_000 ||
    typeof value.active !== "boolean" ||
    !(createdBy === null || (typeof createdBy === "string" && UUID.test(createdBy))) ||
    typeof createdAt !== "string" || !Number.isFinite(Date.parse(createdAt))
  ) throw new Error("ADMIN_PROMPTS_RESULT_INVALID");
  return Object.freeze({ key: value.key as PromptKey, version: value.version as number, body: value.body, active: value.active, createdBy, createdAt });
}

export function parseClientPromptActivationDecision(value: unknown): PromptActivationDecision {
  if (!record(value) || Object.keys(value).sort().join(",") !== "prompt,reason,status") {
    throw new Error("ADMIN_PROMPTS_RESULT_INVALID");
  }
  if (
    (value.status !== "activated" && value.status !== "held") ||
    !(value.reason === null || value.reason === "evaluation_evidence_missing") ||
    (value.status === "activated" && value.reason !== null) ||
    (value.status === "held" && value.reason !== "evaluation_evidence_missing")
  ) throw new Error("ADMIN_PROMPTS_RESULT_INVALID");
  return Object.freeze({ status: value.status, reason: value.reason, prompt: parseClientPromptVersionRow(value.prompt) });
}

export function parseClientEvalRunRow(value: unknown): EvalRunRow {
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
    typeof promptKey !== "string" || !PROMPTS.has(promptKey) ||
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
