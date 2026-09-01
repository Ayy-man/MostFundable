import { randomUUID } from "node:crypto";

import { registerJobHandler } from "../registry.ts";
import { validateJobTuple } from "../definitions.ts";

import type { JobHandler } from "../types.ts";
import type { DrainAnalysisQueueInput, DrainAnalysisQueueResult } from "@/lib/analysis/worker";

/**
 * The worker's own signature, borrowed rather than restated. It was restated
 * here, and the copy went stale: the local shape never gained the fields the
 * worker had added, so the two enumerations of "how a drain can end" drifted
 * apart in exactly the way a round-5 regression does. A type-only import costs
 * nothing at runtime — the worker itself is still reached through `await import`
 * so the handler module stays cheap to load.
 */
type AnalysisDrain = (input: DrainAnalysisQueueInput) => Promise<DrainAnalysisQueueResult>;

export function createAnalysisRunHandler(drain?: AnalysisDrain): JobHandler {
  return async (subject, window) => {
    try {
      validateJobTuple({ job: "analysis.run", subject, window });
    } catch {
      return { status: "failed", code: "ANALYSIS_TUPLE_INVALID" };
    }
    const clientId = subject.slice("client:".length);
    const analysisRunId = window.slice("run:".length);
    const run = drain ?? (await import("@/lib/analysis/worker")).drainAnalysisQueue;
    const result = await run({
      maxJobs: 1,
      target: { analysisRunId, clientId },
      workerId: randomUUID(),
    });
    if ((result.terminal ?? 0) > 0) {
      // A discharged obligation completes the tuple. An *exhausted* one does not:
      // migration 370's sweep re-queues an inner row in status `failed`, and the
      // only outer rows it looks at are the ones in status `failed` too. Reporting
      // this as `skipped` completed the tuple and left the analysis owed with
      // nothing left that could ever run it.
      return result.terminalStatus === "failed"
        ? { status: "failed", code: "ANALYSIS_JOB_EXHAUSTED" }
        : { status: "skipped" };
    }
    // Nothing ran. `failed` is still the right result and the attempt is already
    // spent either way — migration 336 counts it at the drainer's first `renew`,
    // before this function is entered, and `skipped` would complete the tuple
    // where migration 370's sweep (`where status = 'failed'`) can never reach it
    // again. What was wrong is that it said nothing: production logged this and a
    // 150,495ms stage failure as the same `handler_failed` with no detail, one of
    // them in 177ms.
    if ((result.pending ?? 0) > 0) {
      return result.pendingReason === "missing"
        ? { status: "failed", code: "ANALYSIS_JOB_MISSING" }
        : { status: "failed", code: "ANALYSIS_JOB_NOT_CLAIMABLE" };
    }
    // The worker's stage code, which since migration 389 separates a candidate the
    // engine refused (`plan_rejected`) from one the provider never delivered
    // (`plan_unavailable`). Both are retryable; the code is what makes a runtime
    // log line answer which happened without going to the database.
    if (result.failed > 0) {
      return { status: "failed", code: result.errorCode ?? "ANALYSIS_STAGE_FAILED" };
    }
    if (result.succeeded > 0) return { status: "ok", rows: result.succeeded };
    return { status: "skipped" };
  };
}

registerJobHandler("analysis.run", createAnalysisRunHandler(), "FEATURE_ANALYSIS");
