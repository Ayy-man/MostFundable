import "server-only";

import type { ChatTransport } from "../llm/chat-transport.ts";
import { encodeAnswerBody } from "./answer-body.ts";
import { runGroundedChat, runGroundedDecline, type GroundingDocument, type KbCitation } from "./chat-driver.ts";
import { CONSUMER_KB_DECLINE_PROMPT, CONSUMER_KB_PROMPT } from "./prompts.ts";
import { HASH64_SIMILARITY_THRESHOLD, type KbRetrieval } from "./retrieval.ts";
import type { KbProgressReporter } from "./progress.ts";
import type { KbArticleMatch } from "./search.ts";

export const CONSUMER_KB_IDENTITY = "AI assistant";
/**
 * Kept as an export because the surfaces and the API verifier name it, but it is
 * the *hash* arm's gate and it is no longer this module's to choose. Retrieval
 * reports the scale its numbers are on and the threshold that reads them, so a
 * question is never scored one way and judged by the other arm's constant.
 */
export const CONSUMER_KB_SIMILARITY_THRESHOLD = HASH64_SIMILARITY_THRESHOLD;
const MAX_QUESTION_LENGTH = 800;
const MAX_CHUNK_LENGTH = 1_500;
const MAX_CONTEXT_LENGTH = 6_000;

/**
 * F-09, and see `OperatorKbResult` for the same reasoning: the parts are the
 * answer, `answer` is the encoding of them, and the degraded arms carry no
 * headline because a refusal must not be renderable in the shape of an answer.
 *
 * `footer` is null here rather than absent. The not-advice line is an operator
 * surface's, and a consumer's assistant already identifies itself; a field that
 * exists and is empty says that deliberately, where a missing field would read
 * as an omission.
 */
export type ConsumerKbFailureStatus =
  | "insufficient_grounding"
  | "unavailable"
  | "no_matching_records"
  | "out_of_scope"
  | "provider_unreachable"
  | "answer_malformed"
  | "data_unreachable"
  | "result_too_large"
  | "refused_by_policy";

export type ConsumerKbResult =
  | { readonly status: "answered"; readonly identity: typeof CONSUMER_KB_IDENTITY; readonly headline: string; readonly bullets: readonly string[]; readonly footer: null; readonly answer: string; readonly citations: readonly KbCitation[] }
  | { readonly status: ConsumerKbFailureStatus; readonly identity: typeof CONSUMER_KB_IDENTITY; readonly answer: string; readonly citations: readonly [] };

export interface ConsumerKbDependencies {
  readonly retrieval: KbRetrieval;
  readonly transport: () => ChatTransport;
  readonly onProgress?: KbProgressReporter;
  readonly onFailure?: (code: import("./chat-driver.ts").KbRefusalCode) => void;
  readonly onRetrievalFailure?: () => void;
  /** An explicit override still wins, for the callers that want one gate regardless of arm. Absent — which is every production path — the retrieval's own threshold governs. */
  readonly similarityThreshold?: number;
}

function selectDocuments(matches: readonly KbArticleMatch[], threshold: number): GroundingDocument[] {
  const selected: GroundingDocument[] = [];
  let total = 0;
  for (const match of matches) {
    if (match.similarity < threshold || total >= MAX_CONTEXT_LENGTH) continue;
    const content = match.body.slice(0, Math.min(MAX_CHUNK_LENGTH, MAX_CONTEXT_LENGTH - total));
    if (content.length === 0) continue;
    // The chunk id is a stored key; the article title is what a consumer recognises, so the label
    // names the record type and carries that title into every citation the surface prints.
    const title = match.title.slice(0, 240);
    selected.push({ id: match.id, title, label: `Knowledge article · ${title}`, url: match.sourceUrl, content, metadata: { sourceArticleId: match.sourceArticleId } });
    total += content.length;
  }
  return selected;
}

/**
 * The sentence printed when the knowledge base cannot answer.
 *
 * Exported because the regression test asserts where it may and may not appear,
 * and a transcribed copy in the test would keep passing after this string
 * changed. It is the deterministic fallback now rather than the whole behaviour:
 * a reader who asks something the corpus does not cover gets a written decline
 * that names what the corpus does cover, and only a decline that could not be
 * generated or could not clear its gates falls back to this.
 */
export const CONSUMER_KB_STATIC_DECLINE = "I do not have enough verified knowledge-base context to answer that.";

/** Our own words around the model's, kept here so the one static phrase a reader sees beside a generated decline is a constant the compliance gate scans rather than a string assembled at a call site. */
const DECLINE_TOPIC_LEAD = "Here is what I can help with from the knowledge base:";
const MAX_DECLINE_TOPICS = 6;

/**
 * The topics on offer, as pseudo-documents so the decline path can reuse the
 * handle table the answer path uses.
 *
 * The content is the title. A topic is a name being offered, not a passage being
 * read from, and putting the body in would hand the model the very text it must
 * not answer from — the shortest way to make a decline drift into an answer is
 * to show it the material for one.
 */
function declineTopics(matches: readonly KbArticleMatch[]): GroundingDocument[] {
  const topics: GroundingDocument[] = [];
  const seen = new Set<string>();
  for (const match of matches) {
    const title = match.title.slice(0, 240).trim();
    if (title.length === 0 || seen.has(title)) continue;
    seen.add(title);
    topics.push({ id: match.id, title, label: title, url: match.sourceUrl, content: title, metadata: {} });
    if (topics.length >= MAX_DECLINE_TOPICS) break;
  }
  return topics;
}

/**
 * A decline a reader can act on, or the constant.
 *
 * With no topics at all there is nothing to offer and nothing for a model to
 * choose from, so the generated path is skipped entirely rather than asked to
 * produce a sentence whose second half would be empty — an empty corpus is a
 * deployment fault, and spending two provider calls to phrase it warmly does not
 * make it less of one.
 */
async function insufficientGrounding(question: string, matches: readonly KbArticleMatch[], deps: ConsumerKbDependencies): Promise<ConsumerKbResult> {
  const refused = { status: "insufficient_grounding", identity: CONSUMER_KB_IDENTITY, answer: CONSUMER_KB_STATIC_DECLINE, citations: [] } as const;
  const topics = declineTopics(matches);
  if (topics.length === 0) return refused;
  try {
    // `deps.transport()` is inside the try, not only the call it feeds.
    // Constructing the production transport throws when the key is absent, which
    // is a configuration this deployment has actually run in — and an
    // unconstructed transport escaping to the caller's catch would answer a
    // perfectly ordinary out-of-scope question with `unavailable`, the one
    // status that tells a reader something is wrong with the product.
    const written = await runGroundedDecline({ question, topics, transport: deps.transport(), prompt: CONSUMER_KB_DECLINE_PROMPT, onProgress: deps.onProgress });
    if (written === null) return refused;
    return { ...refused, answer: `${written.decline} ${DECLINE_TOPIC_LEAD} ${written.titles.join("; ")}.` };
  } catch {
    return refused;
  }
}

export async function createConsumerKbAnswer(question: string, deps: ConsumerKbDependencies): Promise<ConsumerKbResult> {
  const normalized = question.trim();
  if (normalized.length < 1 || normalized.length > MAX_QUESTION_LENGTH) return { status: "unavailable", identity: CONSUMER_KB_IDENTITY, answer: "This question cannot be processed.", citations: [] };
  let retrieved;
  try {
    deps.onProgress?.({ stage: "searching" });
    retrieved = await deps.retrieval.retrieve(normalized, 6);
  } catch {
    deps.onRetrievalFailure?.();
    return { status: "unavailable", identity: CONSUMER_KB_IDENTITY, answer: "A grounded answer is unavailable right now.", citations: [] };
  }
  try {
    const documents = selectDocuments(retrieved.matches, deps.similarityThreshold ?? retrieved.similarityThreshold);
    // A decline now costs a provider round trip, which reverses a property this
    // module used to assert. That was a cost argument ("a refusal must not cost
    // an answer round trip") and the owner has overruled it: a control that
    // answers every unmatched question with one fixed sentence reads as broken,
    // and reading as broken is the more expensive failure. Every path out of
    // here still terminates in a bounded time and never in an error.
    if (documents.length === 0) return await insufficientGrounding(normalized, retrieved.matches, deps);
    const answer = await runGroundedChat({ question: normalized, documents, transport: deps.transport(), prompt: CONSUMER_KB_PROMPT, onProgress: deps.onProgress, onFailure: deps.onFailure });
    if (answer === null) return { status: "unavailable", identity: CONSUMER_KB_IDENTITY, answer: "A grounded answer is unavailable right now.", citations: [] };
    const body = { bullets: answer.bullets, headline: answer.headline };
    return { status: "answered", identity: CONSUMER_KB_IDENTITY, ...body, answer: encodeAnswerBody(body), citations: answer.citations, footer: null };
  } catch {
    return { status: "unavailable", identity: CONSUMER_KB_IDENTITY, answer: "A grounded answer is unavailable right now.", citations: [] };
  }
}
