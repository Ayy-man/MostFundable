import { featureFlag } from "@/lib/env";

/**
 * The one condition under which the demo role shortcut is usable.
 *
 * Three call sites need this answer and each of them used to spell it out: the
 * sign-in page (whether to render the four buttons), the quick-sign-in route
 * (whether to answer at all), and — since the role switcher was taught to
 * exchange the session rather than navigate — the four surface pages (whether
 * to offer the switcher). Spelling a three-part condition out four times is how
 * one copy drifts, so it is derived here and imported.
 *
 * All three parts matter. `FEATURE_REAL_AUTH` decides whether authentication
 * exists; `FEATURE_DEMO_QUICK_SIGN_IN` gates the convenience separately, so the
 * real sign-in form can ship without the shortcut following it; and the password
 * must actually be present, because offering a control the server cannot honour
 * is worse than not offering it.
 *
 * Server-only by construction. `featureFlag()` returns false unconditionally in a
 * client component and `process.env` is not readable there, so the answer travels
 * to the browser as a boolean prop and never as a `NEXT_PUBLIC_` twin that would
 * bake a runtime switch into the bundle (D-55).
 */
export function demoQuickSignInEnabled(): boolean {
  if (!featureFlag("FEATURE_REAL_AUTH") || !featureFlag("FEATURE_DEMO_QUICK_SIGN_IN")) {
    return false;
  }

  const password = process.env.DEMO_QUICK_SIGN_IN_PASSWORD;

  return typeof password === "string" && password !== "";
}
