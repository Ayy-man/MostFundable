import { registerJobHandler } from "../registry.ts";
import { validateJobTuple } from "../definitions.ts";

import type { JobHandler } from "../types.ts";

type OutcomeDrain = (
  supplied: undefined,
  options: { maxIterations: number; target: { bankRef: string; changeId: string } },
) => Promise<{ claimed: number; failed: number; pending?: number; succeeded: number; terminal?: number }>;

export function createOutcomesRefreshHandler(drain?: OutcomeDrain): JobHandler {
  return async (subject, window) => {
    try {
      validateJobTuple({ job: "outcomes.refresh_stats", subject, window });
    } catch {
      return { status: "failed" };
    }
    if (!subject.startsWith("bank:")) return { status: "failed" };
    const target = { bankRef: subject.slice("bank:".length), changeId: window.slice("change:".length) };
    const run = drain ?? (await import("@/lib/applications/worker")).drainOutcomeRefreshJobs;
    const result = await run(undefined, { maxIterations: 1, target });
    if ((result.terminal ?? 0) > 0) return { status: "skipped" };
    if ((result.pending ?? 0) > 0) return { status: "failed" };
    if (result.failed > 0) return { status: "failed" };
    if (result.succeeded > 0) return { status: "ok", rows: result.succeeded };
    return { status: "skipped" };
  };
}

registerJobHandler("outcomes.refresh_stats", createOutcomesRefreshHandler(), "FEATURE_APPLICATIONS");
