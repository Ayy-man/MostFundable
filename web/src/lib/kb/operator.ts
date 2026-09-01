import "server-only";

import type { SessionProfile } from "../auth/session.ts";
import type { ChatTransport } from "../llm/chat-transport.ts";
import type { Application, BankRetrievalDocument } from "../applications/types.ts";
import type { HeldDraftRow, SupportViewer } from "../support/repository.ts";
import type { TrackerClient } from "../tracker/types.ts";
import { encodeAnswerBody } from "./answer-body.ts";
import { runGroundedChat, type GroundingDocument, type KbCitation } from "./chat-driver.ts";
import { OPERATOR_KB_PROMPT, OPERATOR_NOT_ADVICE_FOOTER } from "./prompts.ts";
import { recordRouteFailure } from "../diagnostics/route-failure.ts";
import type { KbProgressReporter } from "./progress.ts";

const MAX_OPERATOR_CONTEXT = 8_000;

export interface OperatorKbDependencies {
  readonly listTrackerClients: (session: SessionProfile, filters: { scope: "all" }) => Promise<TrackerClient[]>;
  readonly listApplications: (clientId: string) => Promise<Application[]>;
  readonly listBankRetrievalDocuments: (bankRefs?: readonly string[]) => Promise<BankRetrievalDocument[]>;
  readonly transport: () => ChatTransport;
  readonly generateDraft: (threadId: string, viewer: SupportViewer) => Promise<HeldDraftRow>;
  readonly onProgress?: KbProgressReporter;
}

/**
 * F-09. `headline`, `bullets` and `footer` are the answer; `answer` is the same
 * three encoded into the one string the frozen surface renders and the assistant
 * turn stores. A caller that wants to render structure reads the parts, and a
 * caller that has one text node reads `answer` — neither has to parse the other.
 *
 * The degraded arms keep only `answer`, because there is no headline in "a
 * grounded answer is unavailable right now": promoting a refusal sentence into a
 * headline field would let a surface render it in the shape of an answer.
 */
export type OperatorKbResult =
  | { readonly status: "answered"; readonly headline: string; readonly bullets: readonly string[]; readonly footer: string; readonly answer: string; readonly citations: readonly KbCitation[] }
  | { readonly status: "insufficient_grounding" | "unavailable"; readonly answer: string; readonly citations: readonly [] }
  | { readonly status: "drafted"; readonly draft: HeldDraftRow };

function bounded(documents: readonly GroundingDocument[]): GroundingDocument[] {
  const output: GroundingDocument[] = [];
  let total = 0;
  for (const document of documents) {
    if (total >= MAX_OPERATOR_CONTEXT) break;
    const content = document.content.slice(0, MAX_OPERATOR_CONTEXT - total);
    if (content.length === 0) continue;
    output.push({ ...document, content });
    total += content.length;
  }
  return output;
}

async function defaultDependencies(): Promise<OperatorKbDependencies> {
  const [tracker, applications, support] = await Promise.all([import("../tracker/index.ts"), import("../applications/index.ts"), import("../support/index.ts")]);
  return {
    listTrackerClients: tracker.listTrackerClients,
    listApplications: applications.listApplications,
    listBankRetrievalDocuments: applications.listBankRetrievalDocuments,
    transport: () => { throw new Error("KB_ANSWER_UNAVAILABLE"); },
    generateDraft: support.generateDraft,
  };
}

export async function buildOperatorGrounding(session: SessionProfile, _question: string, supplied?: OperatorKbDependencies): Promise<GroundingDocument[]> {
  const deps = supplied ?? await defaultDependencies();
  const clients = await deps.listTrackerClients(session, { scope: "all" });
  const applicationLists = await Promise.all(clients.map(async (client) => ({ clientId: client.id, rows: await deps.listApplications(client.id) })));
  const applications = applicationLists.flatMap(({ clientId, rows }) => rows.filter((application) => application.clientId === clientId));
  const bankRefs = [...new Set(applications.map((application) => application.bankRef).filter((bankRef) => bankRef.length > 0))].sort();
  const lenderDocuments = bankRefs.length === 0 ? [] : await deps.listBankRetrievalDocuments(bankRefs);

  // Each document carries the phrase a citation is allowed to show — record type plus the name the
  // operator already sees on that record — so the surfaces never have to fall back to the row id.
  const trackerDocuments = clients.map((client): GroundingDocument => ({ id: `tracker:${client.id}`, title: client.displayName, label: `Client · ${client.displayName}`, url: `/workspace/clients/${client.id}`, content: JSON.stringify({ stage: client.stage, readiness: client.readiness, openActionCount: client.openActionCount, goalCents: client.goalCents }), metadata: { kind: "tracker", clientId: client.id } }));
  const applicationDocuments = applications.map((application): GroundingDocument => ({ id: `application:${application.id}`, title: `Application ${application.bankRef}`, label: `Application · ${application.bankRef}`, url: `/workspace/applications/${application.id}`, content: JSON.stringify({ bankRef: application.bankRef, operatorStatus: application.operatorStatus, consumerStatus: application.consumerStatus, amountCents: application.amountCents }), metadata: { kind: "application", clientId: application.clientId } }));
  const bankDocuments = lenderDocuments.map((document): GroundingDocument => ({ id: `lender:${document.bankRef}:${document.statsVersion}`, title: `Lender ${document.bankRef}`, label: `Lender · ${document.bankRef}`, url: `/workspace/lenders/${encodeURIComponent(document.bankRef)}`, content: JSON.stringify(document.document), metadata: { kind: "lender", bankRef: document.bankRef, statsVersion: document.statsVersion } }));
  return bounded([...trackerDocuments, ...applicationDocuments, ...bankDocuments]);
}

export async function createOperatorKbAnswer(request: { readonly mode: "answer"; readonly question: string } | { readonly mode: "message_draft"; readonly supportThreadId?: string }, session: SessionProfile, supplied?: OperatorKbDependencies): Promise<OperatorKbResult> {
  const deps = supplied ?? await defaultDependencies();
  if (request.mode === "message_draft") {
    if (!request.supportThreadId) return { status: "unavailable", answer: "A support thread is required.", citations: [] };
    return { status: "drafted", draft: await deps.generateDraft(request.supportThreadId, { profileId: session.id, role: session.role }) };
  }
  const question = request.question.trim();
  if (question.length < 1 || question.length > 800) return { status: "unavailable", answer: "This question cannot be processed.", citations: [] };
  try {
    deps.onProgress?.({ stage: "searching" });
    const documents = await buildOperatorGrounding(session, question, deps);
    if (documents.length === 0) return { status: "insufficient_grounding", answer: "There is not enough visible workspace context to answer that.", citations: [] };
    const answer = await runGroundedChat({ question, documents, transport: deps.transport(), prompt: OPERATOR_KB_PROMPT, onProgress: deps.onProgress });
    if (answer === null) return { status: "unavailable", answer: "A grounded answer is unavailable right now.", citations: [] };
    const body = { bullets: answer.bullets, headline: answer.headline };
    // The footer is appended to the legacy string and is not part of the
    // encoding — see `answer-body.ts` for why. A caller that renders the parts
    // reads `footer`; the frozen surface renders `answer` and gets the same
    // words in the same order.
    return { status: "answered", ...body, answer: `${encodeAnswerBody(body)}\n\n${OPERATOR_NOT_ADVICE_FOOTER}`, citations: answer.citations, footer: OPERATOR_NOT_ADVICE_FOOTER };
  } catch (cause) {
    // Grounding reaches the tracker, the applications table and the lender
    // documents before a single token is generated, so a failure here looks
    // identical to a model refusal from the surface. Naming it is the difference
    // between "the assistant is down" and "one read threw".
    recordRouteFailure({ cause, code: "KB_OPERATOR_GROUNDING_FAILED", status: 200, surface: "kb.operator" });
    return { status: "unavailable", answer: "A grounded answer is unavailable right now.", citations: [] };
  }
}
