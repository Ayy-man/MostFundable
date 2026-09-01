import { PUBLIC_PATHS, SIGN_IN_PATH } from "@/lib/auth/roles";
import type { AppRole } from "@/lib/auth/session";

import vercelConfig from "../../../vercel.json" with { type: "json" };

/**
 * Paths Vercel cron invokes with `Authorization: Bearer CRON_SECRET` and no
 * Supabase session. Derived from `vercel.json` rather than written out, so a
 * cron registered there is exempt here by construction — the failure this
 * prevents was found live the first night FEATURE_REAL_AUTH ran in production,
 * when the guard 307'd the tick to /sign-in before the route's own bearer
 * check could run and no cron could ever drain a job. Exact match only: the
 * exemption stands the guard aside, and each of these routes then enforces its
 * own secret (503 unconfigured, 401 on a wrong bearer).
 */
const CRON_PATHS: readonly string[] = (vercelConfig.crons ?? []).map(
  (cron) => cron.path,
);

export type GuardDecision = { redirectTo: string } | null;
export type ProfileSessionState = "active" | "disabled" | "missing" | "unavailable";
export type AuthenticatedProfile = {
  disabled_at: string | null;
  role: AppRole;
};

export function activeProfileRole(
  profile: AuthenticatedProfile | null,
): AppRole | null {
  return profile && profile.disabled_at === null ? profile.role : null;
}

export function providerSessionDecision(
  hasProviderSession: boolean,
  profileState: ProfileSessionState,
): { clear: boolean; hasSession: boolean } {
  if (!hasProviderSession) return { clear: false, hasSession: false };
  return {
    clear: profileState === "disabled" || profileState === "missing",
    hasSession: profileState === "active",
  };
}

function isPublicPath(pathname: string): boolean {
  if (CRON_PATHS.includes(pathname)) return true;
  return PUBLIC_PATHS.some((publicPath) =>
    publicPath.endsWith("/")
      ? pathname.startsWith(publicPath)
      : pathname === publicPath,
  );
}

export function guardDecision({
  hasSession,
  pathname,
}: {
  hasSession: boolean;
  pathname: string;
}): GuardDecision {
  if (!hasSession && !isPublicPath(pathname)) {
    return { redirectTo: SIGN_IN_PATH };
  }

  if (hasSession && pathname === SIGN_IN_PATH) {
    return { redirectTo: "/" };
  }

  return null;
}
