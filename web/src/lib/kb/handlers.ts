import "server-only";

import type { SessionProfile } from "../auth/session.ts";
import { assistantMockResponder } from "../assistant/mock-responder.ts";
import { featureFlag, resolveDriver } from "../env.ts";
import type { ChatTransport } from "../llm/chat-transport.ts";
import { createZdrChatTransport } from "../llm/chat-transport.ts";
import { createMockChatTransport } from "../llm/mock-chat-transport.ts";
import { createAdminKbAnswer, type AdminKbResult } from "./admin-answer.ts";
import { CONSUMER_KB_IDENTITY, type ConsumerKbResult } from "./consumer.ts";
import { runVaultReimportKb, type VaultReimportKbResult } from "./job.ts";
import { resolveKbModel, resolveKbProviderSort, resolveKbReasoning } from "./model.ts";
import { createOperatorKbAnswer, type OperatorKbResult } from "./operator.ts";
import { KB_NDJSON_CONTENT_TYPE, encodeKbStreamEvent } from "./stream.ts";
import { assistantContextIsSafe } from "../assistant/context.ts";
import { AssistantError, type AssistantErrorCode } from "../assistant/types.ts";

import type { KbProgressReporter } from "./progress.ts";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

type OperatorRequest = { readonly mode: "answer"; readonly question: string } | { readonly mode: "message_draft"; readonly supportThreadId: string };

export interface KbHandlerDependencies {
  readonly enabled: () => boolean;
  readonly getSession: () => Promise<SessionProfile | null>;
  readonly assertTenantWriteAllowed: (session: SessionProfile) => Promise<void>;
  readonly answerConsumer: (question: string, onProgress?: KbProgressReporter, session?: SessionProfile) => Promise<ConsumerKbResult>;
  readonly answerOperator: (request: OperatorRequest, session: SessionProfile) => Promise<OperatorKbResult>;
  readonly answerAdmin: (question: string, session: SessionProfile) => Promise<AdminKbResult>;
  readonly reimport: (subject: string, window: string) => Promise<VaultReimportKbResult>;
}

/**
 * What a scope that is not this handler's answers.
 *
 * Every default set below supplies all three answer functions, and two of the
 * three are always this. Naming it once beats three inline copies whose text
 * would drift, and keeps the shape honest: the route decides which scope it
 * serves, and the other two are not quietly reachable through it.
 */
const OTHER_SCOPE_UNAVAILABLE = { answer: "Unavailable.", citations: [] } as const;

/** One degraded consumer result minus the two fields every one of them shares. */
type ConsumerFailure = Omit<Extract<ConsumerKbResult, { readonly citations: readonly [] }>, "citations" | "identity">;

/**
 * The consumer surface's sentence for every way an answer can fail.
 *
 * Exported because it is the rule, and a test that transcribes a sentence out of
 * it is testing a copy of the rule: a regression enumerates this map and asks
 * `consumerAssistantFailure` for each code, so a code added to
 * `ASSISTANT_ERROR_CODES` without a sentence here is caught rather than silently
 * rendering the default. `satisfies` binds the keys to the assistant's own code
 * vocabulary, so a key that stops being a real outcome fails the typecheck rather
 * than sitting here unreachable.
 */
export const CONSUMER_ASSISTANT_FAILURE_COPY = Object.freeze({
  ASSISTANT_NO_MATCHING_RECORDS: { status: "no_matching_records", answer: "I don't see any matching records in your file yet." },
  ASSISTANT_OUT_OF_SCOPE: { status: "out_of_scope", answer: "That question is outside the records this assistant is allowed to use." },
  ASSISTANT_PROVIDER_UNAVAILABLE: { status: "provider_unreachable", answer: "The AI provider could not be reached just now. Try again." },
  ASSISTANT_ANSWER_MALFORMED: { status: "answer_malformed", answer: "The AI provider could not return a usable answer just now. Try again." },
  ASSISTANT_DATA_UNAVAILABLE: { status: "data_unreachable", answer: "Your permitted workspace records could not be read just now. Try again." },
  ASSISTANT_RESULT_TOO_LARGE: { status: "result_too_large", answer: "More of your records matched than one answer can list in full. Ask about a single application or lender." },
  ASSISTANT_POLICY_REFUSED: { status: "refused_by_policy", answer: "I can't answer that question because the assistant's policy rules do not allow it." },
} as const) satisfies Readonly<Partial<Record<AssistantErrorCode, ConsumerFailure>>>;

/**
 * What anything unmapped becomes — an `AssistantError` whose code has no copy of
 * its own, and anything thrown that is not an `AssistantError` at all.
 *
 * This used to be `provider_unreachable`, so a route the router shaped wrongly, a
 * candidate our own parser refused, and a bug in this process were all reported
 * to a consumer as an outage at the provider. `toAssistantError` already owns the
 * "anything else" rule and calls it `ASSISTANT_UNAVAILABLE`; this is that same
 * classification in the consumer's words, so the two cannot disagree.
 */
export const CONSUMER_ASSISTANT_DEFAULT_FAILURE = Object.freeze({
  status: "unavailable",
  answer: "The assistant could not complete that request just now. Try again.",
} as const) satisfies ConsumerFailure;

/** Turn anything the assistant threw into the one degraded result a consumer reads. Never carries a code, a message or an id. */
export function consumerAssistantFailure(error: unknown): ConsumerKbResult {
  const code = error instanceof AssistantError ? error.code : null;
  const failure = code !== null && code in CONSUMER_ASSISTANT_FAILURE_COPY
    ? CONSUMER_ASSISTANT_FAILURE_COPY[code as keyof typeof CONSUMER_ASSISTANT_FAILURE_COPY]
    : CONSUMER_ASSISTANT_DEFAULT_FAILURE;
  return { ...failure, identity: CONSUMER_KB_IDENTITY, citations: [] };
}

// Bound at transport construction rather than passed per call: the KB's
// operations would otherwise carry the same two settings at five call sites,
// which is five places for them to drift. The plan engine builds its own
// transport and none of this reaches it.
function answerTransport(): ChatTransport {
  return resolveDriver("ai") === "mock"
    ? createMockChatTransport(assistantMockResponder)
    : createZdrChatTransport({ apiKey: process.env.OPENROUTER_API_KEY, model: resolveKbModel(), reasoning: resolveKbReasoning(), providerSort: resolveKbProviderSort() });
}

async function consumerDefaults(): Promise<KbHandlerDependencies> {
  const [{ getSession }, { assertTenantWriteAllowed }] = await Promise.all([import("../auth/session.ts"), import("../tenancy/wall.ts")]);
  return {
    enabled: () => featureFlag("FEATURE_KB"),
    getSession,
    assertTenantWriteAllowed,
    // Which retrieval this is comes from `KB_EMBEDDING_DRIVER`, not from here.
    // The transport is passed as a thunk so the scoring arm constructs it only
    // once it has candidates to score, and so an environment on the hash arm
    // never touches provider configuration at all.
    answerConsumer: async (question, onProgress, session) => {
      if (session === undefined) return { status: "out_of_scope", identity: CONSUMER_KB_IDENTITY, answer: "That question is outside the records this assistant is allowed to use.", citations: [] };
      const { answerAssistantQuestion } = await import("../assistant/orchestrator.ts");
      try {
        const result = await answerAssistantQuestion(question, "consumer", session, { transport: answerTransport(), onProgress });
        const body = result.body;
        const decoded = (await import("./answer-body.ts")).decodeAnswerBody(body);
        return { status: "answered", identity: CONSUMER_KB_IDENTITY, headline: decoded.headline, bullets: decoded.bullets, footer: null, answer: body, citations: result.citations };
      } catch (error) {
        return consumerAssistantFailure(error);
      }
    },
    answerAdmin: async () => ({ ...OTHER_SCOPE_UNAVAILABLE, status: "unavailable" }),
    answerOperator: async () => ({ ...OTHER_SCOPE_UNAVAILABLE, status: "unavailable" }),
    reimport: runVaultReimportKb,
  };
}

async function operatorDefaults(): Promise<KbHandlerDependencies> {
  const [{ getSession }, { assertTenantWriteAllowed }, tracker, applications, support] = await Promise.all([import("../auth/session.ts"), import("../tenancy/wall.ts"), import("../tracker/index.ts"), import("../applications/index.ts"), import("../support/index.ts")]);
  return {
    enabled: () => featureFlag("FEATURE_KB"),
    getSession,
    assertTenantWriteAllowed,
    answerAdmin: async () => ({ ...OTHER_SCOPE_UNAVAILABLE, status: "unavailable" }),
    answerConsumer: async () => ({ ...OTHER_SCOPE_UNAVAILABLE, identity: CONSUMER_KB_IDENTITY, status: "unavailable" }),
    answerOperator: (request, session) => createOperatorKbAnswer(request, session, { listTrackerClients: tracker.listTrackerClients, listApplications: applications.listApplications, listBankRetrievalDocuments: applications.listBankRetrievalDocuments, transport: answerTransport, generateDraft: support.generateDraft }),
    reimport: runVaultReimportKb,
  };
}

async function adminDefaults(): Promise<KbHandlerDependencies> {
  const [{ getSession }, { assertTenantWriteAllowed }] = await Promise.all([import("../auth/session.ts"), import("../tenancy/wall.ts")]);
  return {
    enabled: () => featureFlag("FEATURE_KB"), getSession, assertTenantWriteAllowed,
    answerAdmin: (question, session) => createAdminKbAnswer(question, session, { ...adminReads(), transport: answerTransport }),
    answerConsumer: async () => ({ ...OTHER_SCOPE_UNAVAILABLE, identity: CONSUMER_KB_IDENTITY, status: "unavailable" }),
    answerOperator: async () => ({ ...OTHER_SCOPE_UNAVAILABLE, status: "unavailable" }),
    reimport: runVaultReimportKb,
  };
}

/**
 * The platform reads, resolved lazily.
 *
 * Deliberately not awaited alongside the session imports above: the reimport
 * route shares `adminDefaults`, and it has no business loading the analytics
 * repositories to answer a POST that never asks a question.
 */
function adminReads() {
  return {
    readCounts: async () => (await import("../admin/overview.ts")).readAdminOverviewCounts(),
    readFundedVolume: async (today: string) => (await import("../admin/platform.ts")).createPlatformRepository().readFundedVolume(today),
    readPlatformMrrCents: async () => (await import("../admin/platform.ts")).createPlatformRepository().readPlatformMrrCents(),
    readTenants: async () => (await import("../admin/platform.ts")).createPlatformRepository().readTenants(),
  };
}

function json(body: unknown, status = 200): Response { return Response.json(body, { status, headers: PRIVATE_HEADERS }); }
function disabled(method: "GET" | "POST"): Response { return method === "GET" ? json({ enabled: false }) : new Response(null, { status: 404, headers: PRIVATE_HEADERS }); }
function invalid(): Response { return json({ error: "KB_REQUEST_INVALID" }, 400); }
function exactKeys(body: Record<string, unknown>, keys: readonly string[]): boolean { const actual = Object.keys(body).sort(); const expected = [...keys].sort(); return actual.length === expected.length && actual.every((key, index) => key === expected[index]); }
async function bodyOf(request: Request): Promise<Record<string, unknown> | null> { try { const value: unknown = await request.json(); return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; } catch { return null; } }

async function resolve(method: "GET" | "POST", fallback: () => Promise<KbHandlerDependencies>, supplied?: KbHandlerDependencies): Promise<KbHandlerDependencies | Response> {
  const deps = supplied ?? await fallback();
  return deps.enabled() ? deps : disabled(method);
}

function roleAllowed(session: SessionProfile, roles: readonly SessionProfile["role"][]): boolean { return roles.includes(session.role); }

export async function consumerKbHandler(request: Request, method: "GET" | "POST", supplied?: KbHandlerDependencies): Promise<Response> {
  const resolved = await resolve(method, consumerDefaults, supplied);
  if (resolved instanceof Response) return resolved;
  const session = await resolved.getSession();
  if (session === null) return method === "GET" ? json({ enabled: true }) : json({ error: "KB_ACTOR_REQUIRED" }, 401);
  if (!roleAllowed(session, ["consumer"])) return json({ error: "KB_FORBIDDEN" }, 403);
  if (method === "GET") return json({ enabled: true });
  const body = await bodyOf(request);
  const hasContext = body !== null && Object.hasOwn(body, "context");
  if (body === null || !exactKeys(body, hasContext ? ["context", "question"] : ["question"]) || typeof body.question !== "string") return invalid();
  if (hasContext) {
    const context = body.context;
    if (
      context === null
      || typeof context !== "object"
      || Array.isArray(context)
      || !exactKeys(context as Record<string, unknown>, ["entityRef", "route"])
      || typeof (context as Record<string, unknown>).route !== "string"
      || typeof (context as Record<string, unknown>).entityRef !== "string"
    ) return invalid();
    if (!assistantContextIsSafe(context as { route: string; entityRef: string })) return invalid();
  }
  const question = body.question.trim();
  if (question.length < 1 || question.length > 800) return invalid();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (event: Parameters<typeof encodeKbStreamEvent<ConsumerKbResult>>[0]) => {
        controller.enqueue(encoder.encode(encodeKbStreamEvent(event)));
      };
      void resolved.answerConsumer(question, (progress) => write({ progress }), session)
        .then((result) => {
          write({ result });
          controller.close();
        })
        .catch(() => {
          write({ result: { status: "unavailable", identity: CONSUMER_KB_IDENTITY, answer: "A grounded answer is unavailable right now.", citations: [] } });
          controller.close();
        });
    },
  });
  return new Response(stream, {
    headers: { ...PRIVATE_HEADERS, "Content-Type": KB_NDJSON_CONTENT_TYPE, "X-Accel-Buffering": "no" },
    status: 200,
  });
}

export async function operatorKbHandler(request: Request, method: "GET" | "POST", supplied?: KbHandlerDependencies): Promise<Response> {
  const resolved = await resolve(method, operatorDefaults, supplied);
  if (resolved instanceof Response) return resolved;
  const session = await resolved.getSession();
  if (session === null) return method === "GET" ? json({ enabled: true }) : json({ error: "KB_ACTOR_REQUIRED" }, 401);
  if (!roleAllowed(session, ["operator_member", "platform_admin"])) return json({ error: "KB_FORBIDDEN" }, 403);
  if (method === "GET") return json({ enabled: true });
  try { await resolved.assertTenantWriteAllowed(session); }
  catch (error) {
    if (typeof error === "object" && error !== null && "status" in error && error.status === 402) return json({ error: "ORG_DEACTIVATED" }, 402);
    throw error;
  }
  const body = await bodyOf(request);
  if (body === null || typeof body.mode !== "string") return invalid();
  if (body.mode === "answer" && exactKeys(body, ["mode", "question"]) && typeof body.question === "string") {
    const question = body.question.trim();
    if (question.length < 1 || question.length > 800) return invalid();
    return json(await resolved.answerOperator({ mode: "answer", question }, session));
  }
  if (body.mode === "message_draft" && exactKeys(body, ["mode", "supportThreadId"]) && typeof body.supportThreadId === "string" && body.supportThreadId.length > 0 && body.supportThreadId.length <= 160) {
    return json(await resolved.answerOperator({ mode: "message_draft", supportThreadId: body.supportThreadId }, session));
  }
  return invalid();
}

/**
 * The platform-scoped answer, on its own route rather than a mode on the
 * reimport one.
 *
 * The operator route multiplexes `answer` and `message_draft` through a `mode`
 * field and that is already the least readable part of this file. A second
 * multiplexed route would put an idempotent question and a job trigger behind
 * one verb on one path, which is the kind of thing that gets a job run by a
 * retry.
 */
export async function adminKbAnswerHandler(request: Request, method: "GET" | "POST", supplied?: KbHandlerDependencies): Promise<Response> {
  const resolved = await resolve(method, adminDefaults, supplied);
  if (resolved instanceof Response) return resolved;
  const session = await resolved.getSession();
  if (session === null) return method === "GET" ? json({ enabled: true }) : json({ error: "KB_ACTOR_REQUIRED" }, 401);
  if (!roleAllowed(session, ["platform_admin"])) return json({ error: "KB_FORBIDDEN" }, 403);
  if (method === "GET") return json({ enabled: true });
  const body = await bodyOf(request);
  if (body === null || !exactKeys(body, ["question"]) || typeof body.question !== "string") return invalid();
  const question = body.question.trim();
  if (question.length < 1 || question.length > 800) return invalid();
  return json(await resolved.answerAdmin(question, session));
}

export async function adminKbHandler(request: Request, supplied?: KbHandlerDependencies): Promise<Response> {
  const resolved = await resolve("POST", adminDefaults, supplied);
  if (resolved instanceof Response) return resolved;
  const session = await resolved.getSession();
  if (session === null) return json({ error: "KB_ACTOR_REQUIRED" }, 401);
  if (!roleAllowed(session, ["platform_admin"])) return json({ error: "KB_FORBIDDEN" }, 403);
  const body = await bodyOf(request);
  if (body === null || !exactKeys(body, ["subject", "window"]) || body.subject !== "global" || typeof body.window !== "string" || !/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(body.window)) return invalid();
  const result = await resolved.reimport(body.subject, body.window);
  return json(result, result.status === "failed" ? 503 : 200);
}
