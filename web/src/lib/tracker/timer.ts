import type { TrackerStage } from "./types";

export const TARGET_DAYS: Readonly<Partial<Record<TrackerStage, number>>> = Object.freeze({
  optimization: 60,
  applying: 60,
});

export interface TrackerStageTimer {
  elapsedDays: number;
  remainingDays: number;
  targetDays: number;
}

export function trackerStageTimer(
  stage: TrackerStage,
  stageEnteredAt: string,
  now: Date,
): TrackerStageTimer | null {
  const targetDays = TARGET_DAYS[stage];
  if (targetDays === undefined) return null;
  const entered = Date.parse(stageEnteredAt);
  if (!Number.isFinite(entered) || !Number.isFinite(now.getTime())) return null;
  const elapsedDays = Math.max(0, Math.floor((now.getTime() - entered) / 86_400_000));
  return {
    elapsedDays,
    remainingDays: Math.max(0, targetDays - elapsedDays),
    targetDays,
  };
}
