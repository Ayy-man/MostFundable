import {
  BUSINESS_ITEM_KEYS_V2,
  NARRATIVE_TIMELINE_BANDS_V1,
  PERSONAL_ITEM_KEYS_V2,
} from "../llm/narrative/contract.ts";

import type { NarrativeStepV1, NarrativeV1, PersonalItemKeyV2 } from "../llm/narrative/contract.ts";

/**
 * The gate between `plans.narrative` and a browser.
 *
 * `plans.narrative` is jsonb written by a worker that asks a model for prose. Everything about
 * that path is fallible in a way a schema cannot express: a driver change, a prompt version that
 * drifts, a half-written row from a failed attempt. So nothing stored there is trusted here. This
 * guard admits ONE shape — `NarrativeV1` exactly, no extra keys, every string non-empty and
 * bounded, every enum a member of its band — and answers null for everything else.
 *
 * Null is the safe answer rather than a partial render: the surface draws nothing at all when the
 * narrative is null, so a malformed row costs the consumer the card and nothing more. A guard that
 * repaired what it found would put text on a consumer's screen that no prompt version accounts
 * for, which is the failure this whole seam exists to prevent.
 *
 * The length caps are refusal thresholds, not a style rule: they exist so a runaway generation
 * cannot push a wall of text into a card sized for a paragraph. Real narratives sit well under
 * them, so a value at the cap is itself evidence something went wrong.
 */
const LIMITS = Object.freeze({
  businessSide: 800,
  itemNote: 600,
  model: 200,
  stepDetail: 800,
  stepTitle: 200,
  timelineReason: 600,
  verdict: 240,
  whereYouStand: 1400,
});

/** At most three, because the contract says "1-3 steps, highest impact first". */
const MAX_STEPS = 3;

const NARRATIVE_KEYS = [
  "businessSide",
  "generation",
  "itemNotes",
  "nextSteps",
  "schemaVersion",
  "timeline",
  "verdict",
  "whereYouStand",
] as const;

const STEP_KEYS = ["detail", "itemKey", "title"] as const;
const TIMELINE_KEYS = ["band", "reason"] as const;
const GENERATION_KEYS = ["driver", "model", "promptVersion"] as const;

const PERSONAL_KEYS = new Set<string>(PERSONAL_ITEM_KEYS_V2);
const ITEM_KEYS = new Set<string>([...PERSONAL_ITEM_KEYS_V2, ...BUSINESS_ITEM_KEYS_V2]);
const TIMELINE_BANDS = new Set<string>(NARRATIVE_TIMELINE_BANDS_V1);
const DRIVERS = new Set<string>(["mock", "openrouter"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Exactly these keys, in any order, and nothing else. An unexpected key is a different shape. */
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  if (actual.length !== keys.length) return false;
  return keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

/** A non-empty single-line-or-paragraph string within its cap. Whitespace-only is empty. */
function isText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function isStep(value: unknown): value is NarrativeStepV1 {
  if (!isRecord(value) || !hasExactKeys(value, STEP_KEYS)) return false;
  if (!isText(value.title, LIMITS.stepTitle)) return false;
  if (!isText(value.detail, LIMITS.stepDetail)) return false;
  if (value.itemKey !== null && !(typeof value.itemKey === "string" && ITEM_KEYS.has(value.itemKey))) {
    return false;
  }
  return true;
}

function isItemNotes(value: unknown): value is Readonly<Partial<Record<PersonalItemKeyV2, string>>> {
  if (!isRecord(value)) return false;
  for (const [key, note] of Object.entries(value)) {
    if (!PERSONAL_KEYS.has(key)) return false;
    if (!isText(note, LIMITS.itemNote)) return false;
  }
  return true;
}

/**
 * Validate a stored `plans.narrative` value, or answer null.
 *
 * Accepts `undefined` as well as `null` on purpose: a deployment whose database predates
 * migration 435 has no `narrative` column at all, so the read hands back a row with the property
 * absent. "The column is not there yet" and "the column is there and empty" are the same answer to
 * a consumer, and both are null.
 */
export function parseNarrativeV1(value: unknown): NarrativeV1 | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || !hasExactKeys(value, NARRATIVE_KEYS)) return null;

  if (value.schemaVersion !== 1) return null;
  if (!isText(value.verdict, LIMITS.verdict)) return null;
  if (!isText(value.whereYouStand, LIMITS.whereYouStand)) return null;
  if (!isText(value.businessSide, LIMITS.businessSide)) return null;

  // An empty step list is admitted where a fourth step is not. Three is the contract's ceiling and
  // a fourth means the generation ran past it; zero is what a person with nothing left to do
  // legitimately has, and refusing it would blank the card for exactly the consumer who earned it.
  if (!Array.isArray(value.nextSteps) || value.nextSteps.length > MAX_STEPS) return null;
  if (!value.nextSteps.every(isStep)) return null;

  if (!isItemNotes(value.itemNotes)) return null;

  const timeline = value.timeline;
  if (!isRecord(timeline) || !hasExactKeys(timeline, TIMELINE_KEYS)) return null;
  if (typeof timeline.band !== "string" || !TIMELINE_BANDS.has(timeline.band)) return null;
  if (!isText(timeline.reason, LIMITS.timelineReason)) return null;

  const generation = value.generation;
  if (!isRecord(generation) || !hasExactKeys(generation, GENERATION_KEYS)) return null;
  if (typeof generation.driver !== "string" || !DRIVERS.has(generation.driver)) return null;
  if (!isText(generation.model, LIMITS.model)) return null;
  if (!Number.isInteger(generation.promptVersion) || (generation.promptVersion as number) < 1) return null;

  // Re-built rather than cast, so the returned object holds only the validated properties even if
  // the stored value carried a prototype or a getter alongside them.
  return {
    businessSide: value.businessSide,
    generation: {
      driver: generation.driver as "mock" | "openrouter",
      model: generation.model,
      promptVersion: generation.promptVersion as number,
    },
    itemNotes: { ...value.itemNotes },
    nextSteps: (value.nextSteps as readonly NarrativeStepV1[]).map((step) => ({
      detail: step.detail,
      itemKey: step.itemKey,
      title: step.title,
    })),
    schemaVersion: 1,
    timeline: { band: timeline.band as NarrativeV1["timeline"]["band"], reason: timeline.reason },
    verdict: value.verdict,
    whereYouStand: value.whereYouStand,
  };
}
