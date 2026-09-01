import "server-only";

import { createKbRetrieval } from "../kb/retrieval.ts";
import { Float8ArrayEmbeddingIndex } from "../kb/search.ts";
import { createConsumerKbAnswer } from "../kb/consumer.ts";
import { KB_REFUSAL_CODES, KB_SUPERVISOR_REVISABLE_REASONS, runGroundedChat } from "../kb/chat-driver.ts";
import { ADMIN_KB_PROMPT, CONSUMER_APPLICATION_LEDGER_PROMPT, CONSUMER_WORKSPACE_PROMPT, OPERATOR_APPLICATION_LEDGER_PROMPT, OPERATOR_KB_PROMPT } from "../kb/prompts.ts";
import { encodeAnswerBody } from "../kb/answer-body.ts";
import { toAssistantSources } from "./sources.ts";
import { AssistantError } from "./types.ts";
import { createWorkspaceToolRegistry } from "./workspace-tools.ts";
import { assistantQuestionIsRestricted, selectAssistantRoute } from "./workspace-router.ts";

import type { SessionProfile } from "../auth/session.ts";
import type { ChatTransport } from "../llm/chat-transport.ts";
import type { GroundingDocument, KbCitation, KbRefusalCode, KbSupervisorReason } from "../kb/chat-driver.ts";
import type { KbRetrieval } from "../kb/retrieval.ts";
import type { KbProgressEvent, KbProgressReporter } from "../kb/progress.ts";
import type { AssistantSource } from "./types.ts";
import type { WorkspaceToolRegistry } from "./workspace-tools.ts";

export type AssistantDataScope = "operator" | "admin" | "consumer";

export interface OrchestratedAnswer {
  readonly body: string;
  readonly sources: readonly AssistantSource[];
  readonly citations: readonly KbCitation[];
}

export interface AssistantOrchestratorDependencies {
  readonly transport: ChatTransport;
  readonly onProgress?: KbProgressReporter;
  readonly tools?: WorkspaceToolRegistry;
  readonly retrieval?: KbRetrieval;
}

const MAX_CONTEXT_CHARS = 12_000;
const MAX_CONTEXT_DOCUMENTS = 30;
const TOOL_TAG: Readonly<Record<string, string>> = Object.freeze({
  client_readiness: "r",
  client_applications: "a",
  client_fees: "f",
  bank_catalog: "b",
  platform_operators: "o",
  platform_rollups: "p",
  platform_revenue: "v",
  platform_audit: "u",
});

/**
 * Fit whole records into the answer window, or stop.
 *
 * This used to `slice` the last record's JSON at whatever the budget had left,
 * which is worse than dropping it: half a record is still a record the model
 * will describe, and the half that survives can carry a status without the
 * outcome that superseded it. The caller compares the returned length against
 * what it was given and raises `ASSISTANT_RESULT_TOO_LARGE`, so a book that does
 * not fit is refused out loud instead of answered quietly and partially.
 */
function bounded(documents: readonly GroundingDocument[]): GroundingDocument[] {
  const output: GroundingDocument[] = [];
  let remaining = MAX_CONTEXT_CHARS;
  for (const row of documents) {
    if (output.length >= MAX_CONTEXT_DOCUMENTS || row.content.length > remaining) break;
    output.push(row);
    remaining -= row.content.length;
  }
  return output;
}

function articleSources(citations: readonly KbCitation[]): readonly AssistantSource[] {
  return citations.map((citation) => ({ kind: "article", label: citation.label, ref: citation.id }));
}

/**
 * Which outcome a refusal from the grounded driver deserves.
 *
 * Three causes were one code. `ANSWER_FAILED` is the transport throwing, which
 * is the only one of the three where "the AI provider could not be reached" is
 * a true sentence. `CANDIDATE_MALFORMED` and `CITATION_UNMATCHED` are our own
 * parser refusing what the provider *did* return — the provider was reachable,
 * the answer was unusable, and both are worth one more attempt, which is why
 * they are retryable and separate rather than folded into the outage. What is
 * left — the compliance scan, the identifier scan and the supervisor — are
 * decisions this platform made about an answer it could read, so they stay a
 * policy refusal and stay non-retryable.
 *
 * This also settles the completeness question the supervisor cannot answer: a
 * ledger candidate that merges or drops a record fails the parser and arrives
 * here as `CANDIDATE_MALFORMED`, so an incomplete answer is never reported as
 * a policy refusal.
 */
export type GroundedFailureOutcome =
  | "ASSISTANT_PROVIDER_UNAVAILABLE"
  | "ASSISTANT_ANSWER_MALFORMED"
  | "ASSISTANT_POLICY_REFUSED";

/**
 * The supervisor reasons that describe a bad answer rather than a rule holding.
 *
 * `incomplete` means the reply left out records it was asked to cover and
 * `citation_mismatch` means it cited something it should not have; both are the
 * model doing the job badly, both can come out right on a regenerated attempt,
 * and reporting either as a policy refusal told the reader that a compliance
 * rule blocked a compliant answer and that retrying was pointless. The
 * `citation_mismatch` pairing is deliberate: the local `CITATION_UNMATCHED` gate
 * already classifies the same defect that way, and two paths to one defect must
 * not disagree about what it is.
 */
// Derived from the driver's own revisable vocabulary rather than re-listed here:
// a reason the driver considers fixable by another draft is by definition not a
// rule, and two modules must not disagree about which reasons those are.
const REGENERABLE_SUPERVISOR_REASONS: ReadonlySet<KbSupervisorReason> = new Set(KB_SUPERVISOR_REVISABLE_REASONS);

export function groundedFailureOutcome(code: KbRefusalCode | null, reason: KbSupervisorReason | null = null): GroundedFailureOutcome {
  if (code === null || code === KB_REFUSAL_CODES.ANSWER_FAILED) return "ASSISTANT_PROVIDER_UNAVAILABLE";
  if (code === KB_REFUSAL_CODES.CANDIDATE_MALFORMED
    || code === KB_REFUSAL_CODES.CITATION_UNMATCHED
    || code === KB_REFUSAL_CODES.DECLINE_MALFORMED) return "ASSISTANT_ANSWER_MALFORMED";
  if (reason !== null && REGENERABLE_SUPERVISOR_REASONS.has(reason)) return "ASSISTANT_ANSWER_MALFORMED";
  return "ASSISTANT_POLICY_REFUSED";
}

/**
 * The knowledge chain, started ahead of the routing verdict.
 *
 * Its progress is held back until `attach()` says the verdict was `knowledge`,
 * then replayed in order and forwarded live from there: the stage labels a
 * reader sees may only name work the server is doing *for their answer*, and
 * until the verdict lands this work may be for nothing. A verdict that is not
 * `knowledge` never calls `attach()`, so the chain's events and its answer stay
 * inside this closure — the reader sees the workspace path's own stages or the
 * refusal, exactly as before. `createConsumerKbAnswer` settles with a status
 * and never rejects, and the trailing `catch` keeps a discarded chain from ever
 * becoming an unhandled rejection.
 */
function startKnowledgeChain(question: string, deps: AssistantOrchestratorDependencies) {
  const state: { failure: KbRefusalCode | null; retrievalFailed: boolean } = { failure: null, retrievalFailed: false };
  let live = false;
  const held: KbProgressEvent[] = [];
  const onProgress: KbProgressReporter = (event) => { if (live) deps.onProgress?.(event); else held.push(event); };
  const retrieval = deps.retrieval ?? createKbRetrieval({
    index: new Float8ArrayEmbeddingIndex(),
    transport: () => deps.transport,
  });
  const result = createConsumerKbAnswer(question, {
    retrieval,
    transport: () => deps.transport,
    onProgress,
    onFailure: (code) => { state.failure = code; },
    onRetrievalFailure: () => { state.retrievalFailed = true; },
  });
  result.catch(() => undefined);
  return {
    state,
    result,
    attach(): void {
      live = true;
      for (const event of held.splice(0)) deps.onProgress?.(event);
    },
  };
}

function promptFor(scope: AssistantDataScope, documentLedger = false) {
  if (documentLedger && scope === "operator") return OPERATOR_APPLICATION_LEDGER_PROMPT;
  if (documentLedger && scope === "consumer") return CONSUMER_APPLICATION_LEDGER_PROMPT;
  if (scope === "admin") return ADMIN_KB_PROMPT;
  if (scope === "consumer") return CONSUMER_WORKSPACE_PROMPT;
  return OPERATOR_KB_PROMPT;
}

/**
 * Route one question to verified articles or a closed set of scoped reads.
 *
 * The model only chooses names from a role-specific enum. The registry repeats
 * the role check and owns every database call, so route selection can never
 * widen authorization.
 */
export async function answerAssistantQuestion(
  question: string,
  scope: AssistantDataScope,
  session: SessionProfile,
  deps: AssistantOrchestratorDependencies,
): Promise<OrchestratedAnswer> {
  const roleMatchesScope = (scope === "operator" && session.role === "operator_member")
    || (scope === "admin" && session.role === "platform_admin")
    || (scope === "consumer" && session.role === "consumer");
  if (!roleMatchesScope) throw new AssistantError("ASSISTANT_OUT_OF_SCOPE");
  const tools = deps.tools ?? createWorkspaceToolRegistry();
  // The knowledge chain — retrieval, scoring, draft, review — starts now, beside
  // the router, and is consulted only if the verdict is `knowledge`. Measured on
  // the deployment (2026-08-24, six consumer questions): the four provider calls
  // ran in sequence at 1.5–6.7s (router), 3.1–19.9s (retrieval + scorer),
  // 3.0–8.0s (candidate) and 1.6–4.4s (supervisor), p50 16.1s, and nothing in
  // the chain depends on the router's answer. The local restricted-terms rule
  // is checked first because it is the one gate that must run before any
  // provider call: a bureau term must not reach the transport through the
  // chain any more than through the routing request.
  const knowledge = assistantQuestionIsRestricted(question) ? null : startKnowledgeChain(question, deps);
  // The name is context for the router's own-workspace rule, never a filter: a
  // failed read leaves the rule without a name to compare against, which is the
  // pre-fix behaviour, not a refusal.
  const workspaceName = await tools.workspaceName?.(session).catch(() => null) ?? null;
  let selected;
  try {
    selected = await selectAssistantRoute(question, session, deps.transport, { workspaceName });
  } catch (error) {
    // `ASSISTANT_ROUTE_INVALID` is this codebase rejecting the shape of a reply
    // it received; reporting it as an outage told the reader the provider was
    // down when it had answered. Anything else out of the selector is the
    // transport itself failing, which is the outage.
    throw new AssistantError(
      error instanceof Error && error.message === "ASSISTANT_ROUTE_INVALID"
        ? "ASSISTANT_ANSWER_MALFORMED"
        : "ASSISTANT_PROVIDER_UNAVAILABLE",
    );
  }
  if (selected.kind === "out_of_scope") throw new AssistantError("ASSISTANT_OUT_OF_SCOPE");
  if (selected.kind === "policy_refused") throw new AssistantError("ASSISTANT_POLICY_REFUSED");

  if (selected.kind === "knowledge") {
    // A restricted question never reaches this branch: the router refuses it
    // locally before any verdict, so a null chain here is a programming error,
    // not a state to degrade through.
    if (knowledge === null) throw new AssistantError("ASSISTANT_OUT_OF_SCOPE");
    knowledge.attach();
    const result = await knowledge.result;
    if (result.status === "insufficient_grounding") throw new AssistantError("ASSISTANT_NO_MATCHING_RECORDS");
    if (result.status !== "answered") {
      if (knowledge.state.retrievalFailed) throw new AssistantError("ASSISTANT_DATA_UNAVAILABLE");
      throw new AssistantError(groundedFailureOutcome(knowledge.state.failure));
    }
    return {
      body: encodeAnswerBody({ bullets: result.bullets, headline: result.headline }),
      citations: result.citations,
      sources: articleSources(result.citations),
    };
  }

  let results;
  try {
    results = await Promise.all(selected.tools.map(async (tool) => ({
      tool,
      result: await tools.run(tool.name, session, tool.args),
    })));
  } catch {
    throw new AssistantError("ASSISTANT_DATA_UNAVAILABLE");
  }
  if (results.some(({ result }) => result.status === "out_of_scope")) {
    throw new AssistantError("ASSISTANT_OUT_OF_SCOPE");
  }
  // The read itself found more rows than it is willing to ground an answer on.
  // It says so rather than returning its first page, because a first page and a
  // whole book are indistinguishable once they reach the model.
  if (results.some(({ result }) => result.truncated === true)) {
    throw new AssistantError("ASSISTANT_RESULT_TOO_LARGE");
  }
  const available = results.flatMap(({ result, tool }) => result.documents.map((document, index) => {
    const separator = document.id.indexOf(":");
    const prefix = separator === -1 ? "metric:" : document.id.slice(0, separator + 1);
    return { ...document, id: `${prefix}${TOOL_TAG[tool.name] ?? "x"}:${index}` };
  }));
  const documents = bounded(available);
  if (documents.length !== available.length) throw new AssistantError("ASSISTANT_RESULT_TOO_LARGE");
  if (documents.length === 0) throw new AssistantError("ASSISTANT_NO_MATCHING_RECORDS");
  // An application read answers a per-record question, so it takes the ledger
  // shape: one bullet and one citation per application, cardinality enforced by
  // the schema. Every other read is a summary and keeps the six-bullet shape.
  const documentLedger = selected.tools.length === 1
    && selected.tools[0]?.name === "client_applications"
    && documents.every((document) => document.id.startsWith("application:"));

  let failure: KbRefusalCode | null = null;
  let failureReason: KbSupervisorReason | null = null;
  const answer = await runGroundedChat({
    documentLedger,
    documents,
    onFailure: (code, detail) => { failure = code; failureReason = detail?.reason ?? null; },
    onProgress: deps.onProgress,
    prompt: promptFor(scope, documentLedger),
    question,
    transport: deps.transport,
  });
  if (answer === null) {
    throw new AssistantError(groundedFailureOutcome(failure, failureReason));
  }
  return {
    body: encodeAnswerBody({ bullets: answer.bullets, headline: answer.headline }),
    citations: answer.citations,
    sources: toAssistantSources(answer.citations, new Map()),
  };
}
