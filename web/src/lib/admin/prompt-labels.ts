import { PROMPT_KEYS } from "./prompt-types.ts";

/**
 * What an operator reads where a prompt key would otherwise appear.
 *
 * The keys themselves stay the identity — they are what the API takes, what `prompt_versions`
 * stores and what an evaluator row names — so this is a display layer over them and nothing else.
 * It is keyed by plain string rather than by `PromptKey` on purpose: `funding-readiness-narrative`
 * ships in this map before it ships in `PROMPT_KEYS`, and a `Record<PromptKey, string>` would make
 * that ordering a type error rather than the harmless no-op it is.
 *
 * Unknown keys fall through to the key itself, which is what the surface rendered before any of
 * these labels existed. So a key added upstream is never invisible: at worst it reads as its own
 * identifier until someone writes it a label here.
 */
const PROMPT_KEY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "funding-readiness-narrative": "Plan narrative",
  "funding-readiness-plan": "Funding readiness plan",
  "support-draft": "Support draft",
});

export function promptKeyLabel(key: string): string {
  return PROMPT_KEY_LABELS[key] ?? key;
}

/**
 * The prompt families the picker offers, derived from `PROMPT_KEYS` rather than transcribed.
 *
 * The surface used to carry its own literal list beside the one in `prompt-types.ts`, so a key
 * added there was governed by the API and absent from the only control that can reach it. Reading
 * the constant means a new family appears in the picker the moment it is declared.
 */
export function promptFamilyOptions(
  keys: readonly string[] = PROMPT_KEYS,
): readonly { value: string; label: string }[] {
  return keys.map((key) => ({ label: promptKeyLabel(key), value: key }));
}
