import { featureFlag, type EnvSource } from "@/lib/env";

import { PROMPT_KEYS } from "./prompt-types.ts";

import type {
  EmbeddedPrompt,
  PromptKey,
  PromptActivationDecision,
  PromptReadRepository,
  PromptRepository,
  PromptVersionRow,
  ResolvedPrompt,
} from "./prompt-types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_SET = new Set<string>(PROMPT_KEYS);
const exactObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function parsePromptVersionRow(value: unknown): PromptVersionRow {
  if (!exactObject(value)) throw new Error("ADMIN_PROMPTS_RESULT_INVALID");
  const createdBy = "created_by" in value ? value.created_by : value.createdBy;
  const createdAt = "created_at" in value ? value.created_at : value.createdAt;
  if (
    typeof value.key !== "string" || !KEY_SET.has(value.key) ||
    !Number.isSafeInteger(value.version) || (value.version as number) < 1 ||
    typeof value.body !== "string" || value.body.trim().length < 1 || value.body.length > 50_000 ||
    typeof value.active !== "boolean" ||
    !(createdBy === null || (typeof createdBy === "string" && UUID.test(createdBy))) ||
    typeof createdAt !== "string" || !Number.isFinite(Date.parse(createdAt))
  ) throw new Error("ADMIN_PROMPTS_RESULT_INVALID");
  return Object.freeze({
    key: value.key as PromptKey,
    version: value.version as number,
    body: value.body,
    active: value.active,
    createdBy,
    createdAt,
  });
}

export function parsePromptActivationDecision(value: unknown): PromptActivationDecision {
  if (!exactObject(value) || Object.keys(value).sort().join(",") !==
      "prompt_active,prompt_body,prompt_created_at,prompt_created_by,prompt_key,prompt_version,reason,status") {
    throw new Error("ADMIN_PROMPTS_RESULT_INVALID");
  }
  if (
    (value.status !== "activated" && value.status !== "held") ||
    !(value.reason === null || value.reason === "evaluation_evidence_missing") ||
    (value.status === "activated" && value.reason !== null) ||
    (value.status === "held" && value.reason !== "evaluation_evidence_missing")
  ) throw new Error("ADMIN_PROMPTS_RESULT_INVALID");
  return Object.freeze({
    status: value.status,
    reason: value.reason,
    prompt: parsePromptVersionRow({
      key: value.prompt_key,
      version: value.prompt_version,
      body: value.prompt_body,
      active: value.prompt_active,
      created_by: value.prompt_created_by,
      created_at: value.prompt_created_at,
    }),
  });
}

async function productionRepository(): Promise<PromptRepository> {
  const { createPromptRepository } = await import("./prompt-repository.ts");
  return createPromptRepository();
}

export async function resolveActivePrompt(
  fallback: EmbeddedPrompt,
  repository?: PromptReadRepository,
  env: EnvSource = process.env,
): Promise<ResolvedPrompt> {
  if (!KEY_SET.has(fallback.key) || fallback.version !== 1 || !fallback.body.trim()) {
    throw new Error("ADMIN_PROMPT_FALLBACK_INVALID");
  }
  if (!featureFlag("FEATURE_ADMIN", env)) {
    return Object.freeze({ ...fallback, source: "embedded" as const });
  }
  const rows = await (repository ?? await productionRepository()).readActive(fallback.key);
  if (rows.length === 0) return Object.freeze({ ...fallback, source: "embedded" as const });
  if (rows.length !== 1) throw new Error("ADMIN_PROMPTS_RESULT_INVALID");
  const row = parsePromptVersionRow(rows[0]);
  if (!row.active || row.key !== fallback.key) throw new Error("ADMIN_PROMPTS_RESULT_INVALID");
  return Object.freeze({ key: row.key, version: row.version, body: row.body, source: "database" as const });
}

export async function listPromptVersions(key: PromptKey, repository?: PromptReadRepository): Promise<readonly PromptVersionRow[]> {
  return (repository ?? await productionRepository()).listVersions(key);
}

export async function createPromptVersion(
  fallback: EmbeddedPrompt,
  body: string,
  actorId: string,
  repository?: PromptRepository,
): Promise<PromptVersionRow> {
  if (!UUID.test(actorId) || !body.trim() || body.length > 50_000) throw new Error("ADMIN_PROMPT_INPUT_INVALID");
  return (repository ?? await productionRepository()).createVersion(fallback.key, body, fallback.body, actorId);
}

export async function activatePromptVersion(
  key: PromptKey,
  version: number,
  actorId: string,
  repository?: PromptRepository,
): Promise<PromptActivationDecision> {
  if (!UUID.test(actorId) || !Number.isSafeInteger(version) || version < 1) throw new Error("ADMIN_PROMPT_INPUT_INVALID");
  return (repository ?? await productionRepository()).activateVersion(key, version, actorId);
}

export { PROMPT_KEYS } from "./prompt-types.ts";
export type { EmbeddedPrompt, PromptActivationDecision, PromptKey, PromptRepository, PromptVersionRow, ResolvedPrompt } from "./prompt-types.ts";
