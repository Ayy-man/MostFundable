import { resolveDriverFromSpecWithDeprecatedSelector, type DriverSpec, type EnvSource } from "@/lib/env";

/**
 * The assistant's own driver table — the coach in `assistant/answer.ts` and the
 * four KB operations in `kb/handlers.ts`, which are one service reached from two
 * surfaces and therefore share one key.
 *
 * It is a key of its own for the reason `llm/driver.ts` sets out at length:
 * `AI_DRIVER` used to select the driver for the assistants, the support draft
 * engine and the admin eval policy at once, so a flip aimed at one of them
 * silently reconfigured the other two, and on 2026-08-22 that cost every
 * production analysis run. The KB already carries its own selectors for the
 * corpus (`KB_SOURCE_DRIVER`) and for retrieval (`KB_EMBEDDING_DRIVER`);
 * `ASSISTANT_DRIVER` is the same rule applied to where the answers come from.
 *
 * `AI_DRIVER` is still read as a fallback while it is blank, so a deployment
 * running the assistants on a real model keeps that model through this release
 * rather than dropping back to the mock responder. Setting `ASSISTANT_DRIVER`
 * silences the warning and ends the coupling.
 *
 * The model, reasoning effort and provider ordering stay on their own KB_* keys.
 * This selector chooses the *driver*, mock or provider, and nothing else.
 */
export const ASSISTANT_DRIVERS = {
  selector: "ASSISTANT_DRIVER",
  values: ["mock", "openrouter"],
  fallback: "mock",
  requires: { openrouter: ["OPENROUTER_API_KEY"] },
} as const satisfies DriverSpec;

export type AssistantDriverName = (typeof ASSISTANT_DRIVERS)["values"][number];

export function resolveAssistantDriver(env: EnvSource = process.env): AssistantDriverName {
  return resolveDriverFromSpecWithDeprecatedSelector(
    "assistant",
    ASSISTANT_DRIVERS,
    "AI_DRIVER",
    env,
  );
}
