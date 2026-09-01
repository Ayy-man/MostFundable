import { drainJobs } from "./drainer.ts";
import { validateJobTuple } from "./definitions.ts";

import type { DrainJobsResult } from "./drainer.ts";
import type { BackgroundJob, JobsRepository, JobName } from "./types.ts";

type RunNowDependencies = {
  drain?: (enqueued: BackgroundJob) => Promise<DrainJobsResult>;
  repository: JobsRepository;
};

export async function runNow(
  job: JobName,
  subject: string,
  window: string,
  supplied?: RunNowDependencies,
): Promise<DrainJobsResult> {
  const tuple = validateJobTuple({ job, subject, window });
  const deps = supplied ?? {
    repository: (await import("./repository.ts")).productionJobsRepository(),
  };
  // Drain the enqueued row itself, not the FIFO head: with anything else queued
  // (a cadence tick, a neighbour's accrual, an analysis run) a one-row FIFO drain
  // ran and reported on that job while this tuple stayed queued. `claimed: 0`
  // now means the tuple was not queued (already running or terminal), never
  // that some other job ran instead.
  const enqueued = await deps.repository.enqueue(tuple);
  return deps.drain ? deps.drain(enqueued) : drainJobs({ jobId: enqueued.id, maxJobs: 1 });
}
