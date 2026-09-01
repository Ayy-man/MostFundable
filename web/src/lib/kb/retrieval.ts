import "server-only";

import { resolveDriverFromSpec, type DriverSpec, type EnvSource } from "@/lib/env";

import type { ChatTransport } from "../llm/chat-transport.ts";
import { recordRouteFailure } from "../diagnostics/route-failure.ts";
import { createDeterministicEmbeddingDriver } from "./embedding.ts";
import { KB_RELEVANCE_PROMPT } from "./prompts.ts";
import type { KbArticleMatch, Float8ArrayEmbeddingIndex } from "./search.ts";
import type { EmbeddingDriver } from "./types.ts";

/**
 * The KB retriever's own driver table.
 *
 * Retrieval used to have no selector at all: `handlers.ts` constructed
 * `createDeterministicEmbeddingDriver()` unconditionally, so the only thing
 * standing between a consumer's question and the corpus was a 64-bucket lexical
 * hash of its tokens. That hash has no notion of meaning — it scores overlap of
 * word spellings — so a question had to be phrased in roughly the article's own
 * words to clear the similarity gate. Measured on production against the six
 * fixture articles: "How do I get funding ready?" scored 0.122, "How do lenders
 * decide if I qualify?" 0.086 and "Why was my funding plan created?" 0.010,
 * all under the 0.18 gate and all answered with the not-enough-context refusal,
 * while phrasings lifted from the article bodies scored 0.24–0.48 and answered.
 * The assistant was not broken so much as it was a lexical search wearing a
 * semantic surface.
 *
 * So retrieval selects on `KB_EMBEDDING_DRIVER` and nothing else. It is not part
 * of the frozen INTERFACES §10 table, for the same reason `KB_SOURCE_DRIVER` is
 * not (G-KB-01): a service that borrows another service's selector gets
 * reconfigured by a deployment decision that was never about it. `AI_DRIVER`
 * choosing where *answers* come from must stay silent about how documents are
 * *found*, and vice versa.
 *
 * `hash64` is the fallback rather than the arm we would choose, and that is
 * deliberate. It is the behaviour every environment has today, it needs no
 * credential and no network, and it is what the real arm degrades to when the
 * provider is slow, down, or answering nonsense — so an environment that has not
 * set the selector, and an environment whose provider just failed, land on the
 * same well-understood retrieval rather than on two different unknowns.
 *
 * `llm_score` requires `OPENROUTER_API_KEY` because the scoring call goes over
 * the same ZDR transport the answer does; preflighting the key keeps the failure
 * at selection rather than one round trip into a consumer's question.
 */
export const KB_EMBEDDING_DRIVERS = {
  selector: "KB_EMBEDDING_DRIVER",
  values: ["hash64", "llm_score"],
  fallback: "hash64",
  requires: { llm_score: ["OPENROUTER_API_KEY"] },
} as const satisfies DriverSpec;

export type KbEmbeddingDriverName = (typeof KB_EMBEDDING_DRIVERS)["values"][number];

export function resolveKbEmbeddingDriver(env: EnvSource = process.env): KbEmbeddingDriverName {
  return resolveDriverFromSpec("kb_embedding", KB_EMBEDDING_DRIVERS, env);
}

/**
 * The gate each arm's scores are read against.
 *
 * These are two different measurements and they must not share a number. A
 * hash64 score is the cosine of two sparse sign-weighted token histograms, where
 * 0.18 was chosen against the observed spread of that distribution. An
 * `llm_score` score is a model's stated relevance divided by 100 — a scale with
 * a meaning rather than a distribution, on which 0.5 is "this article is at
 * least as much about the question as it is about something else". Reusing 0.18
 * on the second scale would admit every article for every question, which is the
 * failure that quietly turns a refusal path into an answer path.
 */
export const HASH64_SIMILARITY_THRESHOLD = 0.18;
export const LLM_SCORE_RELEVANCE_THRESHOLD = 0.5;

/**
 * How many rows the candidate fetch asks for.
 *
 * The scoring model is shown the candidates and nothing else, so this is the
 * ceiling on what `llm_score` can ever return — and `search_kb_articles` clamps
 * its own limit to 8, so it is also the highest number the RPC will honour. With
 * today's six-article corpus that means every article is scored on every
 * question and the hash plays no part in the ranking at all. If the corpus ever
 * grows past 8, this arm becomes a re-ranking of the hash's top 8 rather than a
 * search of the whole corpus, and the fix at that point is a candidate fetch
 * that does not go through a similarity function — not a bigger number here.
 */
const CANDIDATE_LIMIT = 8;

/** Bounds what one article contributes to the scoring request. Titles and openings decide relevance; full bodies would pay for tokens the judgement does not use. */
const MAX_SCORING_EXCERPT = 600;

const SCORE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["scores"],
  properties: {
    scores: {
      type: "array",
      minItems: 0,
      maxItems: CANDIDATE_LIMIT,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ref", "relevance"],
        properties: {
          ref: { type: "string", minLength: 1, maxLength: 8 },
          relevance: { type: "integer", minimum: 0, maximum: 100 },
        },
      },
    },
  },
} as const;

/**
 * One retrieval, and the scale its numbers are on.
 *
 * The threshold travels with the *result* rather than with the retriever, and
 * that is the load-bearing part. The `llm_score` arm degrades to the hash arm's
 * rows whenever the provider fails, so a threshold fixed on the retriever would
 * read hash cosines against 0.5 on exactly the requests where the provider was
 * already down — turning a degraded answer into a blanket refusal, which is
 * worse than the behaviour this driver replaces. `scale` names which
 * measurement actually produced these numbers, so a caller reading
 * `similarityThreshold` is never reading the other arm's constant.
 */
export interface KbRetrievalResult {
  readonly scale: KbEmbeddingDriverName;
  readonly similarityThreshold: number;
  readonly matches: readonly KbArticleMatch[];
}

export interface KbRetrieval {
  readonly driver: KbEmbeddingDriverName;
  retrieve(question: string, limit: number): Promise<KbRetrievalResult>;
}

export interface KbRetrievalOptions {
  readonly index: Pick<Float8ArrayEmbeddingIndex, "search">;
  readonly env?: EnvSource;
  readonly embedding?: EmbeddingDriver;
  /** Constructed only on the arm that scores, and only once a candidate set exists — a question that matched nothing must not cost a provider call. */
  readonly transport?: () => ChatTransport;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read the model's answer back into a ref → relevance table.
 *
 * Parsed here rather than trusted from the transport, because the mock transport
 * does not validate against the schema it is handed and a test double is exactly
 * where a malformed shape would first arrive. A duplicate ref, an unknown ref or
 * a value outside 0–100 makes the whole response unusable rather than partially
 * usable: a half-read score table would silently rank on the half that parsed.
 */
function parseScores(value: unknown, refs: ReadonlySet<string>): Map<string, number> | null {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Array.isArray(value.scores)) return null;
  if (value.scores.length > refs.size) return null;
  const table = new Map<string, number>();
  for (const item of value.scores) {
    if (!isRecord(item) || Object.keys(item).length !== 2) return null;
    if (typeof item.ref !== "string" || !refs.has(item.ref) || table.has(item.ref)) return null;
    if (typeof item.relevance !== "number" || !Number.isInteger(item.relevance) || item.relevance < 0 || item.relevance > 100) return null;
    table.set(item.ref, item.relevance / 100);
  }
  return table;
}

/**
 * The hash arm: embed the question, ask the index for the nearest rows.
 *
 * Unchanged behaviour, named. It is also the candidate fetch the scoring arm
 * builds on, which is why it is a function rather than a branch.
 */
function hashMatches(question: string, embedding: EmbeddingDriver, index: Pick<Float8ArrayEmbeddingIndex, "search">, limit: number): Promise<KbArticleMatch[]> {
  return embedding.embed(question).then((vector) => index.search(vector, limit));
}

/**
 * Rank the candidates by a model's stated relevance instead of by token overlap.
 *
 * The model sees per-request positional refs, a title and an excerpt — never a
 * row id, a source article id or a url. That is the same discipline
 * `runGroundedChat` applies to the answer call (F-05), and it holds here for the
 * same reason: a model that has never been shown a stored key cannot echo one,
 * and a scoring call is not exempt from rail 3 because it returns numbers.
 *
 * An article the model omits scores zero rather than inheriting its hash score.
 * Mixing the two scales inside one ordering would produce a ranking that is
 * neither, and a silent omission is a judgement — "not relevant" — not a gap to
 * fill in from the measurement this arm exists to replace.
 */
async function scoredMatches(question: string, candidates: readonly KbArticleMatch[], transport: ChatTransport): Promise<readonly KbArticleMatch[] | null> {
  const refs = candidates.map((_, position) => `a${position + 1}`);
  const articles = candidates.map((match, position) => ({ ref: refs[position]!, title: match.title.slice(0, 240), excerpt: match.body.slice(0, MAX_SCORING_EXCERPT) }));
  const value = await transport.complete({
    operation: `${KB_RELEVANCE_PROMPT.key}.score`,
    schemaName: `${KB_RELEVANCE_PROMPT.key}-v${KB_RELEVANCE_PROMPT.version}`,
    schema: SCORE_SCHEMA,
    // Sized from the schema rather than guessed: eight entries of a two-field
    // object with an 8-character ref and an integer is about 130 tokens of JSON,
    // and the transport adds 256 on top for the reasoning this model bills
    // against the same budget. 256 is roughly double what the answer can be and
    // still leaves the headroom that keeps a harmony fragment from coming back
    // in place of JSON — a budget cut past what the schema needs is what the
    // truncation guard in the transport exists because of.
    maxTokens: 256,
    timeLimitMs: 20_000,
    messages: [
      { role: "system", content: KB_RELEVANCE_PROMPT.system },
      { role: "user", content: JSON.stringify({ question, articles }) },
    ],
  });
  const table = parseScores(value, new Set(refs));
  if (table === null) return null;
  return candidates
    .map((match, position) => ({ ...match, similarity: table.get(refs[position]!) ?? 0 }))
    .sort((left, right) => right.similarity - left.similarity || left.sourceArticleId.localeCompare(right.sourceArticleId));
}

/**
 * Build the retriever the environment selects.
 *
 * An unknown selector value throws, as every driver table in this codebase does
 * — a typo that degrades quietly is the misconfiguration the throw rule exists
 * to surface, and it is a deploy-time mistake rather than a runtime condition.
 * Everything that can go wrong *at request time* on the real arm — no key, a
 * provider timeout, an HTTP error, a schema the model did not honour — lands on
 * the hash arm's result instead. A retrieval failure must never be the reason a
 * consumer sees an error page, and a degraded answer path that still refuses
 * out-of-scope questions is strictly better than no answer path.
 */
export function createKbRetrieval(options: KbRetrievalOptions): KbRetrieval {
  const env = options.env ?? process.env;
  const embedding = options.embedding ?? createDeterministicEmbeddingDriver();
  const index = options.index;
  const selected = resolveKbEmbeddingDriver(env);

  const hashResult = (matches: readonly KbArticleMatch[]): KbRetrievalResult =>
    ({ scale: "hash64", similarityThreshold: HASH64_SIMILARITY_THRESHOLD, matches });

  if (selected === "hash64") {
    return Object.freeze({
      driver: "hash64" as const,
      async retrieve(question: string, limit: number): Promise<KbRetrievalResult> {
        return hashResult(await hashMatches(question, embedding, index, limit));
      },
    });
  }

  return Object.freeze({
    driver: "llm_score" as const,
    async retrieve(question: string, limit: number): Promise<KbRetrievalResult> {
      const candidates = await hashMatches(question, embedding, index, CANDIDATE_LIMIT);
      if (candidates.length === 0) return hashResult(candidates);
      try {
        const transport = options.transport?.();
        if (transport === undefined) throw new Error("KB_RETRIEVAL_TRANSPORT_MISSING");
        const scored = await scoredMatches(question, candidates, transport);
        if (scored === null) throw new Error("KB_RETRIEVAL_SCORE_MALFORMED");
        return { scale: "llm_score", similarityThreshold: LLM_SCORE_RELEVANCE_THRESHOLD, matches: scored.slice(0, limit) };
      } catch (cause) {
        // Classification and cause name only, exactly as `runGroundedChat`
        // records its refusals. The question is the one thing that must never
        // reach this seam: it is a consumer's own words, and the log stream is
        // bound by the two-rails rule the same way storage is.
        recordRouteFailure({ cause, code: "KB_RETRIEVAL_DEGRADED", status: 200, surface: "kb.retrieval" });
        return hashResult(candidates.slice(0, limit));
      }
    },
  });
}
