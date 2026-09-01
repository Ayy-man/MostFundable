import {
  registerCadenceProvider,
  registerJobHandler,
} from "@/lib/jobs/registry";

import { runTrialExpiry } from "./trial-expiry.ts";

import type { CadenceProvider, JobHandler } from "@/lib/jobs/types";
import type { FeatureFlagName } from "@/lib/env";

export const TENANCY_TRIAL_EXPIRY_JOB = "tenancy.trial_expiry" as const;

type JobRegistrar = {
  cadence(job: typeof TENANCY_TRIAL_EXPIRY_JOB, provider: CadenceProvider, ownerFlag: FeatureFlagName): void;
  handler(job: typeof TENANCY_TRIAL_EXPIRY_JOB, handler: JobHandler, ownerFlag: FeatureFlagName): void;
};

function utcDate(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
}

export function registerTenancyJobs(registrar: JobRegistrar): void {
  registrar.handler(TENANCY_TRIAL_EXPIRY_JOB, runTrialExpiry, "FEATURE_TENANCY");
  registrar.cadence(TENANCY_TRIAL_EXPIRY_JOB, async (now) => [{
    job: TENANCY_TRIAL_EXPIRY_JOB,
    subject: "global",
    window: utcDate(now),
  }], "FEATURE_TENANCY");
}

registerTenancyJobs({
  cadence: registerCadenceProvider,
  handler: registerJobHandler,
});
