import { isJobName } from "./definitions.ts";
import { featureFlag } from "@/lib/env";

import type { EnvSource, FeatureFlagName } from "@/lib/env";
import type { CadenceProvider, JobHandler, JobName } from "./types.ts";

// This module is a server-side singleton. It intentionally remains free of
// runtime-only imports so the ownership and collision contract can be unit tested.
const handlers = new Map<JobName, JobHandler>();
const cadenceProviders = new Map<JobName, CadenceProvider>();
const handlerOwnerFlags = new Map<JobName, ReadonlySet<FeatureFlagName>>();
const cadenceOwnerFlags = new Map<JobName, ReadonlySet<FeatureFlagName>>();
const schedulerOwnerFlags = new Set<FeatureFlagName>();

function requireName(job: string): asserts job is JobName {
  if (!isJobName(job)) throw new Error("JOB_NAME_INVALID");
}

type OwnerFlags = FeatureFlagName | readonly FeatureFlagName[];

function owners(value: OwnerFlags): ReadonlySet<FeatureFlagName> {
  const values = typeof value === "string" ? [value] : value;
  if (values.length === 0) throw new Error("JOB_OWNER_REQUIRED");
  return new Set(values);
}

export function registerJobHandler(job: string, handler: JobHandler, ownerFlags: OwnerFlags): void {
  requireName(job);
  if (handlers.has(job)) throw new Error(`JOB_HANDLER_DUPLICATE:${job}`);
  handlers.set(job, handler);
  const flags = owners(ownerFlags);
  handlerOwnerFlags.set(job, flags);
  for (const flag of flags) schedulerOwnerFlags.add(flag);
}

export function registerCadenceProvider(job: string, provider: CadenceProvider, ownerFlags: OwnerFlags): void {
  requireName(job);
  if (cadenceProviders.has(job)) throw new Error(`JOB_CADENCE_DUPLICATE:${job}`);
  cadenceProviders.set(job, provider);
  const flags = owners(ownerFlags);
  cadenceOwnerFlags.set(job, flags);
  for (const flag of flags) schedulerOwnerFlags.add(flag);
}

/**
 * R5C-02: a second producer for a job that may already have one. The duplicate guard on
 * `registerCadenceProvider` is the right default — two modules each thinking they own a
 * cadence is a collision — but rediscovery is an additional source for the same obligation,
 * so it composes instead. Both producers' tuples are emitted; the scheduler still validates
 * ownership and `enqueue_background_job` still deduplicates.
 */
export function composeCadenceProvider(job: string, provider: CadenceProvider, ownerFlags: OwnerFlags): void {
  requireName(job);
  const existing = cadenceProviders.get(job);
  if (!existing) {
    registerCadenceProvider(job, provider, ownerFlags);
    return;
  }
  cadenceProviders.set(job, async (now) => [...await existing(now), ...await provider(now)]);
  const flags = new Set([...(cadenceOwnerFlags.get(job) ?? []), ...owners(ownerFlags)]);
  cadenceOwnerFlags.set(job, flags);
  for (const flag of flags) schedulerOwnerFlags.add(flag);
}

export function getJobHandler(job: JobName): JobHandler | undefined {
  return handlers.get(job);
}

export function getCadenceProviders(): ReadonlyMap<JobName, CadenceProvider> {
  return cadenceProviders;
}

export function getCadenceOwnerFlags(): ReadonlyMap<JobName, ReadonlySet<FeatureFlagName>> {
  return cadenceOwnerFlags;
}

export function getHandlerOwnerFlags(): ReadonlyMap<JobName, ReadonlySet<FeatureFlagName>> {
  return handlerOwnerFlags;
}

export function enabledHandlerJobs(env: EnvSource = process.env): ReadonlySet<JobName> {
  return new Set([...handlerOwnerFlags]
    .filter(([, flags]) => [...flags].some((flag) => featureFlag(flag, env)))
    .map(([job]) => job));
}

export function getSchedulerOwnerFlags(): ReadonlySet<FeatureFlagName> {
  return schedulerOwnerFlags;
}

export function resetJobRegistryForTests(): void {
  handlers.clear();
  cadenceProviders.clear();
  handlerOwnerFlags.clear();
  cadenceOwnerFlags.clear();
  schedulerOwnerFlags.clear();
}
