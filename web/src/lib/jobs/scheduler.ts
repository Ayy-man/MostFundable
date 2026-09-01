import { validateJobTuple } from "./definitions.ts";
import { featureFlag } from "@/lib/env";
import { getCadenceOwnerFlags, getCadenceProviders, getSchedulerOwnerFlags } from "./registry.ts";

import type { EnvSource, FeatureFlagName } from "@/lib/env";
import type { CadenceProvider, JobsRepository, JobName, JobTuple } from "./types.ts";

type SchedulerDependencies = {
  env?: EnvSource;
  ownerFlags?: ReadonlyMap<JobName, ReadonlySet<FeatureFlagName>>;
  providers?: ReadonlyMap<JobName, CadenceProvider>;
  repository: JobsRepository;
};

/**
 * R4C-04: one producer's failure is recorded, never propagated. `job` is `"scheduler"` only
 * for a failure of the scheduler itself, which callers construct; providers and tuples always
 * name their job. `reason` is a bounded code, never provider text, so the tick response stays
 * metadata only.
 */
export type ScheduleFailure = {
  count: number;
  job: JobName | "scheduler";
  reason: string;
  scope: "provider" | "scheduler" | "tuple";
};

export type ScheduleResult = {
  failures: readonly ScheduleFailure[];
  jobs: number;
  providers: number;
};

const REASON_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;

function reasonCode(error: unknown, fallback: string): string {
  return error instanceof Error && REASON_CODE.test(error.message) ? error.message : fallback;
}

export async function schedulerEnabled(
  env: EnvSource = process.env,
  suppliedFlags?: ReadonlySet<FeatureFlagName>,
): Promise<boolean> {
  if (!suppliedFlags) await import("./register.ts");
  const flags = suppliedFlags ?? getSchedulerOwnerFlags();
  return [...flags].some((flag) => featureFlag(flag, env));
}

async function productionDependencies(): Promise<SchedulerDependencies> {
  await import("./register.ts");
  const { productionJobsRepository } = await import("./repository.ts");
  return { repository: productionJobsRepository() };
}

export async function enqueueDueJobs(
  now: Date,
  supplied?: SchedulerDependencies,
): Promise<ScheduleResult> {
  if (Number.isNaN(now.getTime())) throw new Error("JOB_SCHEDULE_TIME_INVALID");
  const deps = supplied ?? await productionDependencies();
  const providers = deps.providers ?? getCadenceProviders();
  const ownerFlags = deps.ownerFlags ?? getCadenceOwnerFlags();
  const env = deps.env ?? process.env;
  let jobs = 0;
  let enabledProviders = 0;
  const failures = new Map<string, ScheduleFailure>();
  const record = (job: JobName, scope: "provider" | "tuple", reason: string): void => {
    const key = `${job}|${scope}|${reason}`;
    const seen = failures.get(key);
    if (seen) seen.count += 1;
    else failures.set(key, { count: 1, job, reason, scope });
  };

  for (const [ownedJob, provider] of providers) {
    const flags = ownerFlags.get(ownedJob);
    if (!flags || ![...flags].some((flag) => featureFlag(flag, env))) continue;
    enabledProviders += 1;
    let tuples: readonly JobTuple[];
    try {
      // Spread inside the guard so a provider returning something unreadable is a recorded
      // producer failure rather than a thrown one that suppresses every later producer.
      tuples = [...await provider(now)];
    } catch (error) {
      record(ownedJob, "provider", reasonCode(error, "PROVIDER_FAILED"));
      continue;
    }
    for (const tuple of tuples) {
      try {
        validateJobTuple(tuple);
        if (tuple.job !== ownedJob) throw new Error("JOB_CADENCE_OWNER_MISMATCH");
        await deps.repository.enqueue(tuple);
        jobs += 1;
      } catch (error) {
        record(ownedJob, "tuple", reasonCode(error, "TUPLE_FAILED"));
      }
    }
  }
  return { failures: [...failures.values()], jobs, providers: enabledProviders };
}
