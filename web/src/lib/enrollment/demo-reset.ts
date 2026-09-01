import { featureFlag } from "@/lib/env";

/**
 * The demo reset rides on the same two flags as quick sign-in, plus enrollment itself: it is a
 * development-phase convenience for the seeded consumers and must vanish with them. Read inside the
 * function rather than at import, matching every other flag read, so the app boots with no env.
 */
export function demoResetEnabled(): boolean {
  return (
    featureFlag("FEATURE_ENROLLMENT") &&
    featureFlag("FEATURE_REAL_AUTH") &&
    featureFlag("FEATURE_DEMO_QUICK_SIGN_IN")
  );
}
