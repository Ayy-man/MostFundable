/**
 * Public, content-safe observations from the grounded-answer pipeline.
 *
 * These events are emitted by the work itself. The UI may render them, but it
 * must never manufacture one or advance them on a timer.
 */
export const KB_PROGRESS_STAGES = ["searching", "reading", "composing", "reviewing"] as const;

export type KbProgressStage = (typeof KB_PROGRESS_STAGES)[number];

export type KbProgressEvent =
  | { readonly stage: "searching" }
  | { readonly stage: "reading"; readonly titles: readonly string[] }
  | { readonly stage: "composing" }
  | { readonly stage: "reviewing" };

export type KbProgressReporter = (event: KbProgressEvent) => void;

export function isKbProgressEvent(value: unknown): value is KbProgressEvent {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (row.stage === "reading") {
    return Array.isArray(row.titles)
      && row.titles.length > 0
      && row.titles.every((title) => typeof title === "string" && title.trim().length > 0);
  }
  return row.stage === "searching" || row.stage === "composing" || row.stage === "reviewing";
}
