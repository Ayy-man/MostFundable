/**
 * `FEATURE_TIMELINE`, read the one way this repo reads a flag.
 *
 * **Server-side.** Every registered flag is unprefixed, so Next does not inline it into the browser
 * bundle and a client component calling this would get `false` unconditionally — indistinguishable
 * from the flag being off. The surfaces read it in their page and pass the answer down, which is
 * what `paidRefreshEnabled` and `referralsEnabled` already do.
 *
 * `FEATURE_TIMELINE` is registered in `FEATURE_FLAG_NAMES` (migration-396 lane), so this is the
 * plain read every other flag uses.
 */

import { featureFlag } from "@/lib/env";

/** The flag's name, exactly as the environment spells it. */
export const TIMELINE_FLAG = "FEATURE_TIMELINE" as const;

export function timelineFlagEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return featureFlag(TIMELINE_FLAG, env);
}
