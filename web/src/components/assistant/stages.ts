// The words for a stage the server actually reported.
//
// Contract §0 R1: there is no token streaming, so for the ten to sixteen seconds a supervised
// answer takes, the orb's label is the entire user-facing content. That makes this table load
// bearing rather than decorative, and it has exactly one rule: a label may only name work the
// server has said is happening. `ASSISTANT_STAGES` is the vocabulary and `Record<AssistantStage,
// string>` is what makes a stage added there a compile error here rather than a stage that
// silently renders as nothing.
//
// F-10's measurement governs the wording. `drafting` is the ≤900-token candidate call and holds
// the screen for the great majority of the wait; `reviewing` is a 128-token boolean and is over
// almost as soon as it appears. Nothing here reorders them to put the slow one last — that would
// mean reporting a stage before the work it names, which is the failure R1 exists to prevent — so
// the honest treatment is a label that reads as work rather than as a hang, plus the elapsed
// seconds the workspace shows beside it once the wait is long enough to wonder about. A measured
// clock is real information; a stage advanced on a timer is not, and this module has no timer.

import { ASSISTANT_STAGES } from "@/lib/assistant/types";

import type { AssistantScope, AssistantStage } from "@/lib/assistant/types";

/**
 * What each scope calls each stage.
 *
 * The two scopes differ only where the work itself differs: `retrieving` reads a workspace book
 * on one side and the platform roster on the other, and saying "your workspace" to a platform
 * admin looking across every tenant would be the wrong noun. The two model calls are the same
 * calls, so they get the same words.
 */
const STAGE_LABELS: Readonly<Record<AssistantScope, Readonly<Record<AssistantStage, string>>>> = {
  admin: {
    searching: "Searching platform records",
    reading: "Reading retrieved records",
    composing: "Composing the answer",
    reviewing: "Reviewing against policy",
  },
  operator: {
    searching: "Searching your workspace",
    reading: "Reading retrieved records",
    composing: "Composing the answer",
    reviewing: "Reviewing against policy",
  },
};

export function stageLabel(scope: AssistantScope, stage: AssistantStage): string {
  return STAGE_LABELS[scope][stage];
}

/**
 * Whether a value off the wire is a stage this build knows.
 *
 * The stream is NDJSON and a line that is not a stage we can name is dropped rather than shown:
 * an unknown string rendered as a label would be the server's internal vocabulary on somebody's
 * screen, and the orb's own fallback ("Working on your answer") is already the truthful answer to
 * "a stream is open and it has not said what it is doing yet".
 */
export function isAssistantStage(value: unknown): value is AssistantStage {
  return typeof value === "string" && (ASSISTANT_STAGES as readonly string[]).includes(value);
}

/**
 * How long a wait has to run before the workspace shows the elapsed seconds.
 *
 * Under this, a counter is noise on a wait nobody was worried about yet. Over it, the same silence
 * starts reading as a hang, and the seconds are the cheapest true thing to show — a measurement,
 * not a prediction, and never a stage.
 */
export const ELAPSED_VISIBLE_AFTER_MS = 6_000;

/** The elapsed seconds, floored. Rendered in tabular figures beside the stage label. */
export function elapsedSeconds(startedAtMs: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
}
