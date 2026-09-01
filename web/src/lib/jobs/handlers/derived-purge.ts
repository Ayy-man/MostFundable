import { listDerivedPurgeTargets, runDerivedPurge } from "@/lib/enrollment/derived-purge";

import { registerCadenceProvider, registerJobHandler } from "../registry.ts";

export const DERIVED_PURGE_OWNER_FLAGS = ["FEATURE_ENROLLMENT", "FEATURE_ANALYSIS"] as const;

function utcDate(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
}

registerJobHandler("purge.derived", runDerivedPurge, DERIVED_PURGE_OWNER_FLAGS);
// R4D-03: the declared daily cadence had no producer, so a tuple that exhausted its three
// attempts was the end of the obligation. The window is the tick's own UTC date, exactly as
// `purge.uploaded_reports` does it, so a dead row's conflict-ignore cannot swallow the retry.
registerCadenceProvider("purge.derived", async (now) => {
  const targets = await listDerivedPurgeTargets(utcDate(now), now);
  return targets.map((target) => ({
    job: "purge.derived" as const,
    subject: target.subject,
    window: target.window,
  }));
}, DERIVED_PURGE_OWNER_FLAGS);
