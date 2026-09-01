import "server-only";

import type { EnvSource } from "@/lib/env";

import { PROVIDER_SORTS, type ProviderSort } from "../llm/chat-transport.ts";

/**
 * Which model the KB assistants talk to (F-10).
 *
 * The owner measured roughly thirty seconds for one consumer answer on
 * production. The model is not env-driven today and never has been: it is the
 * `OPENROUTER_MODEL` **constant** in `llm/chat-transport.ts`, currently
 * `openai/gpt-oss-120b`. The environment variable of the same name is carried in
 * `.env.example` because `verify-env-contract.mjs` requires the name, and it is
 * read by nothing — so "change the model on production" is not a lever anybody
 * has, which is why this key exists.
 *
 * **It defaults to the constant, so nothing changes until someone sets it.**
 * That is deliberate and it is the same discipline the embeddings arm was
 * refused under: the only OpenRouter key that exists is the owner's personal
 * one, it is not in this environment, and no candidate model's latency,
 * `json_schema` strictness or ZDR availability could be measured from here.
 * Shipping a new default nobody has run would be trading a slow assistant for an
 * unverified one, and the truncation guard in the transport exists because that
 * trade was made once already.
 *
 * What the shape of the problem says, for whoever does the measuring: the
 * consumer answer is **two sequential supervised calls** (candidate then
 * supervisor), and `gpt-oss-120b` is a reasoning model whose reasoning tokens
 * are billed and generated against the same budget. The transport already asks
 * for the floor — `reasoning: { effort: "low" }`, which is as close to off as
 * this family goes — so the remaining levers are the model and the number of
 * round trips, not the settings. The table at the top of `chat-transport.ts`
 * holds the only latency measurements anyone has taken on this account with this
 * exact request shape, and `google/gemini-2.5-flash` (2.8s, non-reasoning,
 * strict `json_schema`) is the candidate that table most supports.
 */
export const KB_MODEL_KEY = "KB_ANSWER_MODEL";

/**
 * The scoring call's own model, separate from the answer's.
 *
 * These are different jobs and one key for both was a design mistake in this
 * branch's earlier commit. Answering is supervised generation a reader waits on
 * and reads; scoring is a constrained classification that returns a handful of
 * integers and is never shown to anyone. A 120B reasoning model is defensible
 * for the first and hard to justify for the second.
 *
 * Their failure modes differ too, which is what makes it safe to move one
 * without the other. A scoring model that misbehaves degrades to the hash
 * ranking and logs `KB_RETRIEVAL_DEGRADED` — the assistant keeps working, in the
 * state it is in today. An answer model that misbehaves means no answer at all,
 * on a surface that is live behind `FEATURE_KB` right now. So this key is the
 * one to experiment with first.
 */
export const KB_SCORING_MODEL_KEY = "KB_SCORING_MODEL";

/**
 * Whether KB calls send a reasoning block.
 *
 * `low` (default) is right for `OPENROUTER_MODEL` and is the floor for that
 * family. `off` omits the block, and it exists to make the model keys above
 * usable rather than to save time: `provider.require_parameters` is `true`, so
 * sending `reasoning` to a model that does not reason can empty the provider set
 * and fail the request outright. Set it only alongside a non-reasoning model —
 * on a reasoning model, omitting the block hands the effort choice to the
 * provider's default, which is *higher* than `low`.
 */
export const KB_REASONING_KEY = "KB_REASONING";

/**
 * A provider-qualified model id, and nothing looser.
 *
 * A malformed value throws rather than degrading to the default, for the reason
 * `env.ts` gives about every other selector: a typo that silently keeps the old
 * behaviour is a misconfiguration nobody can see, and "we set the model and
 * nothing got faster" is exactly the report that would follow.
 */
const MODEL_PATTERN = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i;

export class KbModelInvalidError extends Error {
  readonly key: string;
  constructor(key: string) {
    // The key is named because that is what a reader has to fix. The value is
    // not, because this is read on a server whose logs are not the place to echo
    // configuration back — the rule `env.ts` states about its own errors.
    super(`${key} is not a provider-qualified model id such as "vendor/model". Clear it to use the transport default.`);
    this.name = "KbModelInvalidError";
    this.key = key;
  }
}

function readModel(env: EnvSource, key: string): string | undefined {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return undefined;
  const model = raw.trim();
  if (!MODEL_PATTERN.test(model)) throw new KbModelInvalidError(key);
  return model;
}

/** The answer model override, or `undefined` for the transport's own default. */
export function resolveKbModel(env: EnvSource = process.env): string | undefined {
  return readModel(env, KB_MODEL_KEY);
}

/**
 * The scoring model override.
 *
 * Falls back to the answer model's key before the transport default, so an
 * operator who sets one model for the KB gets it everywhere, and only has to
 * name a second when the two should differ. That ordering matters because the
 * common case is "make the KB faster", not "make retrieval and answering differ".
 */
export function resolveKbScoringModel(env: EnvSource = process.env): string | undefined {
  return readModel(env, KB_SCORING_MODEL_KEY) ?? resolveKbModel(env);
}

/** The reasoning setting for KB calls. Anything but an exact `off` is `low`, so a typo cannot silently hand the effort choice to the provider. */
export function resolveKbReasoning(env: EnvSource = process.env): "low" | "off" {
  return (env[KB_REASONING_KEY] ?? "").trim().toLowerCase() === "off" ? "off" : "low";
}

/**
 * Which ZDR provider OpenRouter tries first for a KB call.
 *
 * This one has a default that is not "whatever the transport did before",
 * because it was measured where it runs: the 2026-08-24 deployment profile put
 * every stage of a consumer answer on the price-ordered routing at 1.5–8s per
 * call, while the same model is served under ZDR with strict `json_schema` by
 * providers that generate it an order of magnitude faster. `throughput` is the
 * default and `price` restores the old behaviour. The value is a closed
 * vocabulary and a typo throws, for the reason every selector here throws.
 */
export const KB_PROVIDER_SORT_KEY = "KB_PROVIDER_SORT";
export const KB_PROVIDER_SORT_DEFAULT: ProviderSort = "throughput";

export class KbProviderSortInvalidError extends Error {
  readonly key = KB_PROVIDER_SORT_KEY;
  constructor() {
    super(`${KB_PROVIDER_SORT_KEY} must be one of ${PROVIDER_SORTS.join(", ")}. Clear it for the default.`);
    this.name = "KbProviderSortInvalidError";
  }
}

export function resolveKbProviderSort(env: EnvSource = process.env): ProviderSort {
  const raw = (env[KB_PROVIDER_SORT_KEY] ?? "").trim().toLowerCase();
  if (raw === "") return KB_PROVIDER_SORT_DEFAULT;
  if (!(PROVIDER_SORTS as readonly string[]).includes(raw)) throw new KbProviderSortInvalidError();
  return raw as ProviderSort;
}
