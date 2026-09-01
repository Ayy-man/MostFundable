import type { JobHandlerResult } from "@/lib/jobs/types";
import type { TenancyRepository } from "../repository.ts";

const DATE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

export async function runTrialExpiry(
  subject: string,
  window: string,
  supplied?: TenancyRepository,
): Promise<JobHandlerResult> {
  if (subject !== "global" || !DATE.test(window)) throw new Error("JOB_TUPLE_INVALID");
  const repository: TenancyRepository = supplied ?? await import("../repository.ts").then(
    (module) => module.productionTenancyRepository(),
  );
  const result = await repository.expireTrials(window);
  return { status: "ok", rows: result.rows };
}
