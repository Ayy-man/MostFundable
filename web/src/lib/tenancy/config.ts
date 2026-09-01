import { featureFlag, type EnvSource } from "@/lib/env";

export const DEFAULT_TRIAL_DAYS = 14;

export function tenancyFeatureEnabled(): boolean {
  return featureFlag("FEATURE_TENANCY");
}

export function resolveTrialDays(
  source: EnvSource = process.env,
): number {
  const raw = source.TRIAL_DAYS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_TRIAL_DAYS;

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("TRIAL_DAYS_INVALID");
  }
  return value;
}
