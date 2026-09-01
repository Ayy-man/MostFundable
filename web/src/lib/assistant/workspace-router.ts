import "server-only";

import type { SessionProfile } from "../auth/session.ts";
import type { ChatTransport } from "../llm/chat-transport.ts";
import type { WorkspaceToolArgs } from "./workspace-tools.ts";

export const WORKSPACE_TOOLS = Object.freeze({
  operator: ["client_readiness", "client_applications", "client_fees", "bank_catalog"],
  admin: ["platform_operators", "platform_rollups", "platform_revenue", "platform_audit", "bank_catalog"],
  consumer: ["client_readiness", "client_applications"],
} as const);

export type WorkspaceToolName = (typeof WORKSPACE_TOOLS)[keyof typeof WORKSPACE_TOOLS][number];
export type WorkspaceToolCall = { readonly name: WorkspaceToolName; readonly args: WorkspaceToolArgs };
export type AssistantRoute =
  | { readonly kind: "knowledge"; readonly tools: readonly [] }
  | { readonly kind: "workspace"; readonly tools: readonly WorkspaceToolCall[] }
  | { readonly kind: "out_of_scope" | "policy_refused"; readonly tools: readonly [] };

/**
 * What each read holds, described from the caller's own point of view.
 *
 * Found live: a consumer asking "What stage am I in and what is my readiness
 * right now?" was routed out of scope, while "What open actions do I have?"
 * answered from the same read a moment later. Nothing about the question was
 * refused — the two client reads were described as covering "visible clients"
 * and the prompt refuses another person's record, so on the one surface where
 * the caller *is* the client, a first-person question looked like a question
 * about somebody else.
 *
 * The fix is the description, not another rule about another question. A
 * consumer is shown reads that say whose records they are, so the refusal rule
 * and the question stop contradicting each other; the two client reads are the
 * only ones a consumer is ever offered, so nothing else needs a second wording.
 */
const SHARED_DESCRIPTIONS: Readonly<Record<WorkspaceToolName, string>> = Object.freeze({
  client_readiness: "Visible clients: who each client is, their stage, verified readiness, how long they have been in that stage, open actions, and the assigned team member.",
  client_applications: "Applications and recorded outcomes for visible clients, one record per application: which client, which lender, the recorded operator and client status, the amount, and any recorded outcome.",
  client_fees: "Fee balances for visible clients: what each client was billed, what they have paid, what is still outstanding, and when they last paid.",
  bank_catalog: "The lender catalog on this signed-in surface: lender names and the products each one offers.",
  platform_operators: "The operator roster: each operator by name, their plan, when they started, how many clients they have, and how much they have funded.",
  platform_rollups: "Platform totals: how many operators and consumers exist, funded volume, cash collected, and recurring revenue.",
  platform_revenue: "The revenue ledger for a month: revenue KPIs, operator earnings by operator, and referral earnings by referrer.",
  platform_audit: "The recent audit trail: what happened on the platform, when, and to what kind of record.",
});

const CONSUMER_DESCRIPTIONS: Readonly<Partial<Record<WorkspaceToolName, string>>> = Object.freeze({
  client_readiness: "The signed-in caller's own record: their stage, verified readiness, stage timer, open actions, and assigned team member.",
  client_applications: "The signed-in caller's own applications and recorded outcomes, one record per application.",
});

const DESCRIPTIONS: Readonly<Record<keyof typeof WORKSPACE_TOOLS, Readonly<Record<WorkspaceToolName, string>>>> = Object.freeze({
  operator: SHARED_DESCRIPTIONS,
  admin: SHARED_DESCRIPTIONS,
  consumer: Object.freeze({ ...SHARED_DESCRIPTIONS, ...CONSUMER_DESCRIPTIONS }),
});

/** Exported so a test derives its expectation from the rule rather than quoting the wording. */
export const ASSISTANT_TOOL_DESCRIPTIONS = DESCRIPTIONS;

/** The description one role is shown for one read. Exported so a test derives its expectation from the rule. */
export function assistantToolDescription(role: keyof typeof WORKSPACE_TOOLS, name: WorkspaceToolName): string {
  return DESCRIPTIONS[role][name];
}

/**
 * The sentence that decides between a typed read and the article path.
 *
 * A named constant because it is the rule a regression should derive from: an
 * admin asking "What does the revenue ledger show for the current period?" was
 * routed to the article path, where nothing covers revenue, and the decline
 * supervisor declined — so the answer a typed read was sitting on became an
 * apology about the knowledge base.
 */
export const ASSISTANT_WORKSPACE_PREFERENCE = "Prefer workspace over knowledge: when the question names a durable record, figure, roster, ledger, trail or total that one of the offered typed reads covers, the route is workspace and the read that covers it, even when the question is phrased generally. Choose knowledge only for an educational question about how something works that no offered typed read covers.";

const ROUTE_SYSTEM_PROMPT = "Classify the question. Choose knowledge for general educational questions answered by verified articles. Choose workspace and only the named typed reads needed for durable records on the caller's permitted surface. Mandatory rule: a question asking which visible clients are closest to funding and what their recorded verified readiness is must return workspace with client_readiness and no arguments. This is a comparison of existing records, not a forecast, qualification decision, prediction about a funding decision, or promise. Mandatory rule: a question asking where each open application stands with its lender must return workspace with client_applications and no arguments; application and lender statuses come from that read, never from client_readiness. A request to rank visible clients by who is closest to funding, or to compare their recorded verified readiness, is a workspace client_readiness read. For ranking or comparison, omit every tool argument because the typed read already ranks the full authorized book. Use query only for a human client or operator name copied verbatim from the question. A bank name may be query only for bank_catalog, or for client_applications when bank_catalog is also in the offered tool set; this keeps consumer application reads from resolving catalog data their surface cannot read. Never put a filter, sort, or instruction in query. Include stage, month, from date, or result limit only when the question supplies that exact value. " + ASSISTANT_WORKSPACE_PREFERENCE + " Choose out_of_scope for another person's record, another workspace, a write/send request, or anything outside these reads. Choose policy_refused for personalized outcome forecasts, predicted funding decisions, score promises, or guarantees. Never invent a tool and never treat a record name as an id.";

/**
 * One line, and it is about who the caller is rather than about any question.
 *
 * It exists because the out-of-scope rule above says "another person's record",
 * and on the consumer surface every record is the caller's own. Without it the
 * two sentences disagree and the model resolves the disagreement differently
 * depending on how the question is phrased.
 */
/**
 * The caller's own workspace, named, so "another workspace" is decidable.
 *
 * The first live walk asked an operator for "the clients in the Cedar Harbor
 * workspace" and the router sent it to the caller's own `client_readiness` read,
 * because nothing told it which workspace the caller was in: the instruction to
 * refuse "another workspace" had no workspace to compare against. The name is
 * supplied beside the question as `callerWorkspace`, and the rule is stated in
 * terms of it. Admins read across every workspace, so they carry no name.
 */
export const ASSISTANT_OWN_WORKSPACE_RULE = "callerWorkspace is the name of the signed-in caller's own workspace. A question whose subject is the clients, applications, fees, or records of any other named workspace, organization, operator, or company is out_of_scope, even when the same kind of record exists in the caller's workspace; never answer it from the caller's own records.";

const CONSUMER_IDENTITY_RULE = " On this surface the signed-in caller is the client, so their own record is never another person's record: first-person questions using I, me, my, or mine are about the caller's own record and are in scope for these reads.";

/** The system prompt one role is routed with. Exported so a test derives its expectation from the rule. */
export function assistantRouteSystemPrompt(role: keyof typeof WORKSPACE_TOOLS): string {
  if (role === "admin") return ROUTE_SYSTEM_PROMPT;
  const confined = `${ROUTE_SYSTEM_PROMPT} ${ASSISTANT_OWN_WORKSPACE_RULE}`;
  return role === "consumer" ? `${confined}${CONSUMER_IDENTITY_RULE}` : confined;
}

function roleKey(role: SessionProfile["role"]): keyof typeof WORKSPACE_TOOLS | null {
  if (role === "operator_member") return "operator";
  if (role === "platform_admin") return "admin";
  if (role === "consumer") return "consumer";
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const RESTRICTED_QUESTION = /\b(?:crs|credit reporting service|credit reports?|credit snapshot|bureaus?|bureau pulls?|experian|equifax|transunion|tradelines?|credit scores?|credit monitoring|monitoring (?:data|history|snapshot|status)|utilization|fico|vantagescore|soft pulls?|qualification summary)\b/i;

export function assistantQuestionIsRestricted(question: string): boolean {
  return RESTRICTED_QUESTION.test(question);
}

function parseToolCall(value: unknown, allowed: readonly WorkspaceToolName[], question: string): WorkspaceToolCall | null {
  if (!isRecord(value) || typeof value.name !== "string" || !allowed.includes(value.name as WorkspaceToolName)) return null;
  if (Object.keys(value).some((key) => !["name", "query", "stage", "month", "from", "limit"].includes(key))) return null;
  const args: { query?: string; stage?: WorkspaceToolArgs["stage"]; month?: string; from?: string; limit?: number } = {};
  for (const key of ["query", "month", "from"] as const) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== "string" || value[key].length > 120) return null;
    if (key !== "query") args[key] = value[key];
    else {
      const query = value[key].trim();
      if (query.length > 0 && question.toLocaleLowerCase().includes(query.toLocaleLowerCase())) args.query = query;
    }
  }
  if (value.stage !== undefined) {
    if (!["onboarding", "optimization", "ready", "applying", "funded", "graduate"].includes(String(value.stage))) return null;
    args.stage = value.stage as WorkspaceToolArgs["stage"];
  }
  if (value.limit !== undefined) {
    if (!Number.isInteger(value.limit) || (value.limit as number) < 1 || (value.limit as number) > 30) return null;
    args.limit = value.limit as number;
  }
  return { name: value.name as WorkspaceToolName, args };
}

/**
 * Let the model choose a named read, never a query.
 *
 * The schema is built from the caller's role, so a consumer cannot even name an
 * admin tool. The executor repeats the role check; this is routing, not access
 * control.
 */
export async function selectAssistantRoute(
  question: string,
  session: SessionProfile,
  transport: ChatTransport,
  context: { readonly workspaceName?: string | null } = {},
): Promise<AssistantRoute> {
  const key = roleKey(session.role);
  if (key === null) return { kind: "out_of_scope", tools: [] };
  // Restricted source terms are rejected locally so bureau/CRS material never
  // enters assistant transport, including the routing request itself.
  if (assistantQuestionIsRestricted(question)) return { kind: "out_of_scope", tools: [] };
  const allowed = WORKSPACE_TOOLS[key] as readonly WorkspaceToolName[];
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["route", "tools"],
    properties: {
      route: { type: "string", enum: ["knowledge", "workspace", "out_of_scope", "policy_refused"] },
      tools: {
        type: "array",
        minItems: 0,
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name"],
          properties: {
            name: { type: "string", enum: allowed },
            query: { type: "string", maxLength: 120 },
            stage: { type: "string", enum: ["onboarding", "optimization", "ready", "applying", "funded", "graduate"] },
            month: { type: "string", pattern: "^\\d{4}-\\d{2}$" },
            from: { type: "string", maxLength: 40 },
            limit: { type: "integer", minimum: 1, maximum: 30 },
          },
        },
      },
    },
  } as const;
  const value = await transport.complete({
    operation: "assistant-route.select",
    schemaName: `assistant-route-${key}-v2`,
    schema,
    maxTokens: 160,
    messages: [
      {
        role: "system",
        content: assistantRouteSystemPrompt(key),
      },
      {
        role: "user",
        content: JSON.stringify({
          question,
          ...(key === "admin" ? {} : { callerWorkspace: context.workspaceName ?? null }),
          tools: allowed.map((name) => ({ name, description: assistantToolDescription(key, name) })),
        }),
      },
    ],
  });
  if (!isRecord(value) || Object.keys(value).some((field) => field !== "route" && field !== "tools")) {
    throw new Error("ASSISTANT_ROUTE_INVALID");
  }
  if (!Array.isArray(value.tools)) throw new Error("ASSISTANT_ROUTE_INVALID");
  const parsed = value.tools.map((tool) => parseToolCall(tool, allowed, question));
  if (parsed.some((tool) => tool === null)) throw new Error("ASSISTANT_ROUTE_INVALID");
  const tools = [...new Map((parsed as WorkspaceToolCall[]).map((tool) => [tool.name, tool])).values()];
  // An application read is kept exclusive. Application documents already carry
  // their authorized lender display name, so a catalog or readiness read beside
  // them adds nothing the answer needs — and it costs the exact-cardinality
  // ledger path, because a mixed document set falls back to the six-bullet
  // summary the ledger exists to replace.
  const application = tools.find((tool) => tool.name === "client_applications");
  const workspaceTools = application === undefined ? tools : [application];
  if (value.route === "knowledge" && tools.length === 0) return { kind: "knowledge", tools: [] };
  if (value.route === "out_of_scope" && tools.length === 0) return { kind: "out_of_scope", tools: [] };
  if (value.route === "policy_refused" && tools.length === 0) return { kind: "policy_refused", tools: [] };
  if (value.route === "workspace" && workspaceTools.length > 0) return { kind: "workspace", tools: workspaceTools };
  throw new Error("ASSISTANT_ROUTE_INVALID");
}
