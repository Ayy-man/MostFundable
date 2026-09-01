import type { ChatTransport } from "../llm/chat-transport.ts";
import { serializeContext, SUPPORT_DRAFT_EMBEDDED_PROMPT } from "./prompt.ts";

import type { SupervisorVerdict, SupportDraftCandidate, SupportDraftContext, SupportDraftDriver } from "./types.ts";
import type { ResolvedPrompt } from "../admin/prompt-types.ts";

const CANDIDATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["body", "confidence"],
  properties: {
    body: { type: "string", minLength: 1, maxLength: 600 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
} as const;

const SUPERVISOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["approved", "codes"],
  properties: {
    approved: { type: "boolean" },
    codes: { type: "array", maxItems: 16, items: { type: "string", minLength: 2, maxLength: 64 } },
  },
} as const;

export function createOpenRouterSupportDraftDriver(transport: ChatTransport): SupportDraftDriver {
  return Object.freeze({
    driver: transport.driver,
    model: transport.model,
    async generateDraft(context: SupportDraftContext, supplied?: ResolvedPrompt): Promise<SupportDraftCandidate> {
      const prompt = supplied ?? { ...SUPPORT_DRAFT_EMBEDDED_PROMPT, source: "embedded" as const };
      const result = await transport.complete({
        operation: "support.candidate",
        schemaName: "support_draft_candidate_v1",
        schema: CANDIDATE_SCHEMA,
        maxTokens: 512,
        messages: [
          { role: "system", content: prompt.body },
          { role: "user", content: JSON.stringify({ prompt: { key: prompt.key, version: prompt.version }, context: serializeContext(context) }) },
        ],
      }) as { body: string; confidence: number };
      return { body: result.body, confidence: result.confidence, model: transport.model };
    },
    async superviseDraft(context: SupportDraftContext, candidate: SupportDraftCandidate, supplied?: ResolvedPrompt): Promise<SupervisorVerdict> {
      const prompt = supplied ?? { ...SUPPORT_DRAFT_EMBEDDED_PROMPT, source: "embedded" as const };
      return await transport.complete({
        operation: "support.supervisor",
        schemaName: "support_draft_supervisor_v1",
        schema: SUPERVISOR_SCHEMA,
        maxTokens: 256,
        messages: [
          { role: "system", content: "Review the draft against only the supplied thread context and return the exact supervisor schema." },
          { role: "user", content: JSON.stringify({ prompt: { key: prompt.key, version: prompt.version }, context: serializeContext(context), candidate }) },
        ],
      }) as SupervisorVerdict;
    },
  });
}
