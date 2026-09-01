import {
  TRACKER_STAGES,
  type TrackerClient,
  type TrackerStage,
} from "@/lib/tracker/types";

/**
 * The operator Dashboard's rollups, derived from the same `/api/clients`
 * payload the Clients view already renders.
 *
 * Why this exists rather than a second endpoint: before it, the Dashboard read
 * `deriveOperatorHomeMetrics()` — a fixture — while the sidebar badge one inch
 * away read the durable count, so the first screen after sign-in claimed 196
 * active clients beside a badge reading 4. With the demo bar labelling
 * everything a simulation that was a limitation; with a real sign-in in front
 * of it, it is a screen that misrepresents the system.
 *
 * Every figure here is a count or a sum over rows the operator can open in the
 * Clients view, so nothing on the Dashboard asserts more than the tracker can
 * show. `fundedAllTimeCents` sums the recorded funding on those same rows
 * (clients.funded_amount_cents, written when an approved outcome is recorded);
 * null when no client carries one, so the caller can say "no recorded
 * outcomes" instead of showing $0. Cash collected still has no source in this
 * payload — it lives in the fee ledger behind FEATURE_FEES, and the surface
 * reads it from /api/fees when that flag is on rather than approximating here.
 */
export interface DurableHomeMetrics {
  activeClients: number;
  analyses: number;
  attention: TrackerClient[];
  averageOptimizationDays: number | null;
  fundedAllTimeCents: number | null;
  graduatedClients: number;
  pipeline: ReadonlyArray<{ count: number; stage: TrackerStage }>;
}

/** The terminal stage. Read from the catalog so adding a stage cannot strand this. */
const TERMINAL_STAGE: TrackerStage = TRACKER_STAGES[TRACKER_STAGES.length - 1];

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Days each client spent in `optimization`, counted only where the tracker
 * records both the entry and the exit — a client still in optimization has no
 * duration yet, and inventing one from "now" would make the average drift
 * upward every time the page is opened.
 */
function completedOptimizationDays(client: TrackerClient, nowMs: number): number | null {
  const history = [...client.history].sort(
    (left, right) => Date.parse(left.at) - Date.parse(right.at),
  );
  const enteredIndex = history.findIndex((entry) => entry.to === "optimization");
  if (enteredIndex === -1) return null;

  const exit = history[enteredIndex + 1];
  if (!exit) return null;

  const entered = Date.parse(history[enteredIndex].at);
  const left = Date.parse(exit.at);
  if (!Number.isFinite(entered) || !Number.isFinite(left) || left < entered) return null;
  if (nowMs - left > NINETY_DAYS_MS) return null;

  return (left - entered) / (24 * 60 * 60 * 1000);
}

export function deriveDurableHomeMetrics(
  clients: readonly TrackerClient[],
  now: Date,
): DurableHomeMetrics {
  const nowMs = now.getTime();
  const active = clients.filter((client) => client.status === "active");
  const optimizationDays = active
    .map((client) => completedOptimizationDays(client, nowMs))
    .filter((days): days is number => days !== null);

  return {
    // "Active" is the working book: an active row that has not yet graduated.
    activeClients: active.filter((client) => client.stage !== TERMINAL_STAGE).length,
    analyses: clients.filter((client) => client.analysisAt !== null).length,
    attention: active.filter(
      (client) => client.health === "amber" || client.health === "red",
    ),
    averageOptimizationDays: optimizationDays.length
      ? Math.round(
          optimizationDays.reduce((sum, days) => sum + days, 0) /
            optimizationDays.length,
        )
      : null,
    // All-time means archived rows count too; a funded client that later left
    // the book still received its funding.
    fundedAllTimeCents: clients.some((client) => client.fundingApprovedCents !== null)
      ? clients.reduce((sum, client) => sum + (client.fundingApprovedCents ?? 0), 0)
      : null,
    graduatedClients: clients.filter((client) => client.stage === TERMINAL_STAGE)
      .length,
    // Mapped over the catalog rather than a written-out list, so a new stage
    // appears in the pipeline the day it is added instead of vanishing from it.
    pipeline: TRACKER_STAGES.map((stage) => ({
      count: active.filter((client) => client.stage === stage).length,
      stage,
    })),
  };
}
