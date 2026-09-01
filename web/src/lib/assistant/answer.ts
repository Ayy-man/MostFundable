import 'server-only';

// The seam between a scope and the grounding that answers it.
//
// Two scopes, one pipeline. `operator` runs `lib/kb/operator.ts` and `admin`
// runs `lib/kb/admin-answer.ts` — the same one each surface's KB route uses,
// reached with the same dependencies — so nothing about grounding or the
// supervisor gate is re-implemented here. Lane 4a wrote the admin module; until
// it existed this branch threw `ASSISTANT_SCOPE_UNAVAILABLE`, which is now
// raised by nothing and kept in the vocabulary for the next scope that is named
// before it is built.
//
// The stage stream is produced by instrumenting the transport rather than by
// timing anything. `runGroundedChat` makes exactly two calls through
// `ChatTransport.complete` — the candidate and the supervisor review — and the
// wrapper below reports a stage at the moment each request is dispatched. That
// makes every stage the consequence of real work finishing: `drafting` means the
// workspace read returned, `reviewing` means the candidate came back and passed
// the compliance and citation scans. A candidate the scans reject produces no
// `reviewing` line at all, which is truthful — the supervisor was never asked.

import { resolveDriver } from '../env.ts';
import { createZdrChatTransport } from '../llm/chat-transport.ts';
import { createMockChatTransport } from '../llm/mock-chat-transport.ts';
import { encodeAnswerBody } from '../kb/answer-body.ts';
import { resolveKbModel, resolveKbProviderSort, resolveKbReasoning } from '../kb/model.ts';
import { answerAssistantQuestion } from './orchestrator.ts';
import { toAssistantSources } from './sources.ts';
import { AssistantError } from './types.ts';

import type { SessionProfile } from '../auth/session.ts';
import type { ChatRequest, ChatTransport } from '../llm/chat-transport.ts';
import type { AdminKbDependencies } from '../kb/admin-answer.ts';
import type { OperatorKbDependencies } from '../kb/operator.ts';
import type { AssistantProgressEvent, AssistantScope, AssistantSource } from './types.ts';

export interface AssistantAnswer {
  readonly body: string;
  readonly sources: readonly AssistantSource[];
}

export interface AssistantAnswerDependencies {
  /** Called as each real stage begins. Never called on a timer. */
  readonly onProgress: (event: AssistantProgressEvent) => void;
  readonly transport?: () => ChatTransport;
  readonly answerOperator?: typeof import('../kb/operator.ts')['createOperatorKbAnswer'];
  /**
   * The grounding reads, when a caller supplies them.
   *
   * Injected as a set rather than one at a time so that supplying them skips the
   * dynamic imports below entirely. That is what lets a test drive the stage
   * ordering without loading the tracker, applications and support libraries —
   * three module graphs that have nothing to say about the order of two model
   * calls.
   */
  readonly operatorDependencies?: Omit<OperatorKbDependencies, 'transport' | 'onProgress'>;
  readonly resolveBankLabels?: () => Promise<ReadonlyMap<string, string>>;
  readonly answerAdmin?: typeof import('../kb/admin-answer.ts')['createAdminKbAnswer'];
  /** The platform reads, injected for the same reason the operator ones are. */
  readonly adminDependencies?: Omit<AdminKbDependencies, 'transport' | 'onProgress'>;
}

/**
 * The mock responder, mirroring the one in `lib/kb/handlers.ts`.
 *
 * It is a copy rather than an import because that one is module-private there,
 * and exporting it would widen a file this lane does not own. A mock is the one
 * kind of duplication worth accepting: it has no behaviour to keep in step
 * beyond producing a shape the real pipeline's parser accepts.
 */
function mockResponder(request: ChatRequest): unknown {
  if (request.operation === 'assistant-route.select') {
    const body = JSON.parse(request.messages[1]?.content ?? '{}') as { question?: unknown; tools?: Array<{ name?: unknown }> };
    const names = (body.tools ?? []).flatMap((tool) => typeof tool.name === 'string' ? [tool.name] : []);
    const question = typeof body.question === 'string' ? body.question.toLowerCase() : '';
    const dataQuestion = /client|application|fee|revenue|operator|audit|bank|readiness|stage|status/.test(question);
    const preferred = dataQuestion ? names[0] : undefined;
    return preferred === undefined ? { route: 'knowledge', tools: [] } : { route: 'workspace', tools: [{ name: preferred }] };
  }
  if (!request.operation.endsWith('candidate')) return { approved: true };
  const body = JSON.parse(request.messages[1]?.content ?? '{}') as {
    documents?: Array<{ id?: unknown; title?: unknown }>;
  };
  const first = body.documents?.[0];
  if (typeof first?.id !== 'string' || typeof first.title !== 'string') {
    return { bullets: [], citations: [], headline: 'No grounded answer is available.' };
  }
  return {
    bullets: [],
    citations: [{ id: first.id }],
    headline: 'The cited workspace information supports this answer.',
  };
}

function productionTransport(): ChatTransport {
  return resolveDriver('ai') === 'mock'
    ? createMockChatTransport(mockResponder)
    : createZdrChatTransport({ apiKey: process.env.OPENROUTER_API_KEY, model: resolveKbModel(), reasoning: resolveKbReasoning(), providerSort: resolveKbProviderSort() });
}

/**
 * Report a stage as each model call is dispatched.
 *
 * Before the await, not after: the stage names what the machine is doing now,
 * and a `reviewing` line emitted after the supervisor had already answered would
 * be a label for work that was over.
 */
async function defaultOperatorGrounding(): Promise<Omit<OperatorKbDependencies, 'transport' | 'onProgress'>> {
  const [tracker, applications, support] = await Promise.all([
    import('../tracker/index.ts'),
    import('../applications/index.ts'),
    import('../support/index.ts'),
  ]);
  return {
    // `generateDraft` is required by the dependency shape and is never reached:
    // this call is always `mode: 'answer'`, and the assistant has no route that
    // asks for a draft. It is wired to the real function rather than to a stub
    // so that the shape stays honest if that ever changes.
    generateDraft: support.generateDraft,
    listApplications: applications.listApplications,
    listBankRetrievalDocuments: applications.listBankRetrievalDocuments,
    listTrackerClients: tracker.listTrackerClients,
  };
}

async function defaultAdminGrounding(): Promise<Omit<AdminKbDependencies, 'transport' | 'onProgress'>> {
  const [overview, platform] = await Promise.all([
    import('../admin/overview.ts'),
    import('../admin/platform.ts'),
  ]);
  const repository = platform.createPlatformRepository();
  return {
    readCounts: overview.readAdminOverviewCounts,
    readFundedVolume: (today) => repository.readFundedVolume(today),
    readPlatformMrrCents: () => repository.readPlatformMrrCents(),
    readTenants: () => repository.readTenants(),
  };
}

async function defaultBankLabels(): Promise<ReadonlyMap<string, string>> {
  try {
    const { listBanks } = await import('../vault/index.ts');
    const rows = await listBanks();
    return new Map(rows.map((row) => [row.bankRef, row.name]));
  } catch {
    // With FEATURE_VAULT off, or the read model empty, there are no lender names
    // to resolve. An unnameable source is dropped by `toAssistantSources` rather
    // than rendered as a handle, so the answer loses a chip and never gains an
    // identifier on screen.
    return new Map();
  }
}

/**
 * Answer one question in one scope.
 *
 * Throws an `AssistantError` rather than returning a status union, because every
 * caller of this function is the turns route and the route already has to map a
 * thrown refusal from the repository — one shape to handle rather than two.
 */
export async function answerForScope(
  scope: AssistantScope,
  question: string,
  session: SessionProfile,
  deps: AssistantAnswerDependencies,
): Promise<AssistantAnswer> {
  let lastProgress = "";
  const onProgress = (event: AssistantProgressEvent) => {
    const signature = JSON.stringify(event);
    if (signature === lastProgress) return;
    lastProgress = signature;
    deps.onProgress(event);
  };
  onProgress({ stage: 'searching' });

  // Built on first use rather than up front, and that is not a micro-optimisation.
  // `createZdrChatTransport` THROWS when no key is configured, so constructing it
  // before the scope branch would turn every refusal that never needed a model —
  // a question from the wrong role, a roster with no operators — into a thrown
  // provider error in any environment without a key. Memoized so the two calls
  // the pipeline makes still share one transport.
  let built: ChatTransport | null = null;
  const transport = () => (built ??= (deps.transport ?? productionTransport)());

  // Default production path: route the question first, then execute only the
  // role-registered typed reads it chose. The injected legacy dependencies stay
  // available for the older KB route tests and for callers that explicitly ask
  // to exercise those builders.
  const legacyInjected = deps.answerOperator !== undefined
    || deps.operatorDependencies !== undefined
    || deps.answerAdmin !== undefined
    || deps.adminDependencies !== undefined
    || deps.resolveBankLabels !== undefined;
  if (!legacyInjected) {
    const answer = await answerAssistantQuestion(question, scope, session, {
      onProgress,
      transport: transport(),
    });
    return { body: answer.body, sources: answer.sources };
  }

  // `ASSISTANT_SCOPE_UNAVAILABLE` used to be thrown here, with a TODO naming the
  // module lane 4 owed. Lane 4a wrote it (F-08): the visible half of that
  // finding is a component lane 4b deletes, and deleting an inert shell only
  // helps if what replaces it can answer.
  if (scope === 'admin') {
    const answerAdmin = deps.answerAdmin ?? (await import('../kb/admin-answer.ts')).createAdminKbAnswer;
    const adminGrounding = deps.adminDependencies ?? (await defaultAdminGrounding());
    const platform = await answerAdmin(question, session, {
      ...adminGrounding,
      onProgress,
      transport,
    });
    if (platform.status !== 'answered') throw new AssistantError('ASSISTANT_ANSWER_UNAVAILABLE');
    // No bank labels: the admin builder issues operator and metric documents,
    // both of which carry a stamped human label already. Passing an empty map is
    // the honest argument rather than reaching into the vault for names this
    // scope never cites.
    return {
      body: encodeAnswerBody({ bullets: platform.bullets, headline: platform.headline }),
      sources: toAssistantSources(platform.citations, new Map()),
    };
  }

  const answerOperator = deps.answerOperator ?? (await import('../kb/operator.ts')).createOperatorKbAnswer;
  const grounding = deps.operatorDependencies ?? (await defaultOperatorGrounding());

  const result = await answerOperator({ mode: 'answer', question }, session, {
    ...grounding,
    onProgress,
    transport,
  });

  if (result.status !== 'answered') {
    // `insufficient_grounding` and `unavailable` both mean there is no answer to
    // store. Persisting the module's own prose as an assistant turn would put a
    // sentence in the history that reads like an answer and cites nothing.
    throw new AssistantError('ASSISTANT_ANSWER_UNAVAILABLE');
  }

  const bankLabels = await (deps.resolveBankLabels ?? defaultBankLabels)();
  // Re-encoded from the parts rather than passed through as `result.answer`,
  // which carries the not-advice footer. A stored body must be the answer and
  // nothing else: the footer is a constant the surface renders from the scope,
  // and a copy of it in every row would be a literal duplicated into the
  // database — as well as the one thing `decodeAnswerBody` cannot separate back
  // out when an answer has no bullets.
  return {
    body: encodeAnswerBody({ bullets: result.bullets, headline: result.headline }),
    sources: toAssistantSources(result.citations, bankLabels),
  };
}
