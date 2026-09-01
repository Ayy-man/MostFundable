import "server-only";

import { parseEvalRunRow } from "./evals.ts";
import { parsePromptActivationDecision, parsePromptVersionRow } from "./prompts.ts";
import { promptEvaluationIdentity } from "./eval-policy.ts";

import type {
  EvalRepository,
  PromptRepository,
  RecordEvalRunInput,
} from "./prompt-types.ts";

type QueryPayload = { data: unknown[] | null; error: unknown };
interface QueryResult extends PromiseLike<QueryPayload> {
  eq(column: string, value: unknown): QueryResult;
  order(column: string, options: { ascending: boolean }): QueryResult;
  limit(value: number): QueryResult;
}
interface AdminPromptDb {
  from(table: "prompts" | "eval_runs"): {
    select(columns: string): QueryResult;
  };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<QueryPayload>;
}

async function defaultClient(): Promise<AdminPromptDb> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient() as unknown as AdminPromptDb;
}

export function createPromptRepository(
  createClient: () => unknown | Promise<unknown> = defaultClient,
): PromptRepository {
  let clientPromise: Promise<AdminPromptDb> | null = null;
  const client = () => (clientPromise ??= Promise.resolve(createClient()).then((value) => value as AdminPromptDb));
  const projection = "key,version,body,active,created_by,created_at";
  return {
    async readActive(key) {
      const query = (await client()).from("prompts").select(projection).eq("key", key);
      const { data, error } = await query.eq("active", true);
      if (error) throw new Error("ADMIN_PROMPTS_READ_FAILED");
      return Object.freeze((data ?? []).map(parsePromptVersionRow));
    },
    async listVersions(key) {
      const { data, error } = await (await client()).from("prompts").select(projection)
        .eq("key", key).order("version", { ascending: false });
      if (error) throw new Error("ADMIN_PROMPTS_READ_FAILED");
      return Object.freeze((data ?? []).map(parsePromptVersionRow));
    },
    async createVersion(key, body, fallbackBody, actorId) {
      const { data, error } = await (await client()).rpc("admin_create_prompt_version", {
        p_key: key, p_body: body, p_fallback_body: fallbackBody, p_actor: actorId,
      });
      if (error) throw new Error("ADMIN_PROMPTS_WRITE_FAILED");
      if (!data || data.length !== 1) throw new Error("ADMIN_PROMPTS_RESULT_INVALID");
      return parsePromptVersionRow(data[0]);
    },
    async activateVersion(key, version, actorId) {
      const identity = promptEvaluationIdentity(key);
      const { data, error } = await (await client()).rpc("admin_activate_prompt_version", {
        p_key: key, p_version: version, p_actor: actorId,
        p_policy_version: identity.policyVersion,
        p_reference_dataset_hash: identity.referenceDatasetHash,
        p_driver: identity.driver,
        p_model: identity.model,
      });
      if (error) throw new Error("ADMIN_PROMPTS_WRITE_FAILED");
      if (!data || data.length !== 1) throw new Error("ADMIN_PROMPTS_RESULT_INVALID");
      return parsePromptActivationDecision(data[0]);
    },
  };
}

export function createEvalRepository(
  createClient: () => unknown | Promise<unknown> = defaultClient,
): EvalRepository {
  let clientPromise: Promise<AdminPromptDb> | null = null;
  const client = () => (clientPromise ??= Promise.resolve(createClient()).then((value) => value as AdminPromptDb));
  const projection = "id,prompt_key,prompt_version,evaluator_key,passed,result,policy_version,reference_dataset_hash,driver,model,eligible,ran_by,ran_at";
  return {
    async record(input: RecordEvalRunInput) {
      const { data, error } = await (await client()).rpc("admin_record_eval_run", {
        p_prompt_key: input.promptKey,
        p_prompt_version: input.promptVersion,
        p_evaluator_key: input.evaluatorKey,
        p_passed: input.passed,
        p_result: input.result,
        p_policy_version: input.policyVersion,
        p_reference_dataset_hash: input.referenceDatasetHash,
        p_driver: input.driver,
        p_model: input.model,
        p_eligible: input.eligible,
        p_actor: input.actorId ?? null,
      });
      if (error) throw new Error("ADMIN_EVAL_WRITE_FAILED");
      if (!data || data.length !== 1) throw new Error("ADMIN_EVAL_RESULT_INVALID");
      return parseEvalRunRow(data[0]);
    },
    async list(filters = {}) {
      let query: QueryResult = (await client()).from("eval_runs").select(projection);
      if (filters.promptKey) query = query.eq("prompt_key", filters.promptKey);
      if (filters.promptVersion) query = query.eq("prompt_version", filters.promptVersion);
      query = query.order("ran_at", { ascending: false }).limit(filters.limit ?? 100);
      const { data, error } = await query;
      if (error) throw new Error("ADMIN_EVAL_READ_FAILED");
      return Object.freeze((data ?? []).map(parseEvalRunRow));
    },
    async read(id) {
      const { data, error } = await (await client()).from("eval_runs").select(projection).eq("id", id).limit(2);
      if (error) throw new Error("ADMIN_EVAL_READ_FAILED");
      if (!data || data.length === 0) return null;
      if (data.length !== 1) throw new Error("ADMIN_EVAL_RESULT_INVALID");
      return parseEvalRunRow(data[0]);
    },
  };
}
