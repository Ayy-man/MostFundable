import { createZdrChatTransport } from "./chat-transport.ts";
import { PLAN_EMBEDDED_PROMPT, PLAN_PROMPT_V1, planCandidateSchemaForPrompt } from "./prompts/plan-v1.ts";

import type { DerivedFeatures } from "../analysis/features.ts";
import type { FundingReadinessPlanV1, PlanDriver, SupervisorVerdict } from "./types.ts";
import type { ResolvedPrompt } from "../admin/prompt-types.ts";

export { OPENROUTER_MODEL, OpenRouterDriverError } from "./chat-transport.ts";

export interface OpenRouterPlanDriverOptions {
  apiKey: string | undefined;
  fetch?: typeof globalThis.fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}

export function createOpenRouterPlanDriver(options: OpenRouterPlanDriverOptions): PlanDriver {
  const transport = createZdrChatTransport(options);
  return {
    driver: "openrouter",
    async generateCandidate(features: DerivedFeatures, supplied?: ResolvedPrompt): Promise<FundingReadinessPlanV1> {
      const prompt = supplied ?? { ...PLAN_EMBEDDED_PROMPT, source: "embedded" as const };
      return await transport.complete({
        operation: "candidate",
        schemaName: PLAN_PROMPT_V1.candidateSchemaName,
        schema: planCandidateSchemaForPrompt(prompt.version),
        maxTokens: 4_096,
        // Measured on the production model: a full candidate generates for
        // 50–105s. The default attempt budget is sized for verdicts and would
        // abort every candidate mid-body.
        timeLimitMs: 150_000,
        messages: [
          { role: "system", content: prompt.body },
          { role: "user", content: JSON.stringify({ prompt: { key: prompt.key, version: prompt.version }, derived: PLAN_PROMPT_V1.serializeDerived(features) }) },
        ],
      }) as FundingReadinessPlanV1;
    },
    async supervise(features: DerivedFeatures, candidate: FundingReadinessPlanV1, supplied?: ResolvedPrompt): Promise<SupervisorVerdict> {
      const prompt = supplied ?? { ...PLAN_EMBEDDED_PROMPT, source: "embedded" as const };
      return await transport.complete({
        operation: "supervisor",
        schemaName: PLAN_PROMPT_V1.supervisorSchemaName,
        schema: PLAN_PROMPT_V1.supervisorSchema,
        maxTokens: 512,
        timeLimitMs: 45_000,
        messages: [
          { role: "system", content: "Review the typed funding-readiness candidate against only the supplied derived values and return the exact supervisor schema." },
          { role: "user", content: JSON.stringify({ prompt: { key: prompt.key, version: prompt.version }, derived: PLAN_PROMPT_V1.serializeDerived(features), candidate }) },
        ],
      }) as SupervisorVerdict;
    },
  };
}
