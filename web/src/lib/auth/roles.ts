import type { AppRole } from "@/lib/auth/session";
import type { DemoRole } from "@/lib/demo/types";

export const SIGN_IN_PATH = "/sign-in";
export const FORGOT_PASSWORD_PATH = "/forgot-password";
export const RESET_PASSWORD_PATH = "/reset-password";

// The invite link lands on a browser with no session (Phase 20 TEN-05), so
// its exact path passes the guard; the route validates the token itself.
export const INVITE_ACCEPT_PATH = "/api/invites/accept";

export const PUBLIC_PATHS = [
  "/api/auth/",
  SIGN_IN_PATH,
  FORGOT_PASSWORD_PATH,
  RESET_PASSWORD_PATH,
  "/privacy",
  "/terms",
  INVITE_ACCEPT_PATH,
] as const;

export type PublicPath = (typeof PUBLIC_PATHS)[number];

export const DEMO_ROLE_BY_APP_ROLE: Record<AppRole, DemoRole> = {
  affiliate: "affiliate",
  consumer: "consumer",
  operator_member: "operator",
  platform_admin: "admin",
};

export const SURFACE_PATH_BY_ROLE: Record<AppRole, string> = {
  affiliate: "/affiliate",
  consumer: "/consumer",
  operator_member: "/operator",
  platform_admin: "/admin",
};

export function surfacePathFor(role: AppRole): string {
  return SURFACE_PATH_BY_ROLE[role];
}

/**
 * The profile switcher speaks `DemoRole` and the router needs a path, so the
 * four surface wrappers need this direction of the map. Derived from
 * SURFACE_PATH_BY_ROLE rather than written out again, so the four paths still
 * have exactly one source; a wrapper spelling them inline would be four copies
 * that can drift apart.
 */
export const SURFACE_PATH_BY_DEMO_ROLE: Record<DemoRole, string> = {
  admin: SURFACE_PATH_BY_ROLE.platform_admin,
  affiliate: SURFACE_PATH_BY_ROLE.affiliate,
  consumer: SURFACE_PATH_BY_ROLE.consumer,
  operator: SURFACE_PATH_BY_ROLE.operator_member,
};
