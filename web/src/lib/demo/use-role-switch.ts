"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { SURFACE_PATH_BY_DEMO_ROLE } from "@/lib/auth/roles";
import type { DemoRole } from "@/lib/demo/types";

/**
 * What the role switcher has to do, which differs by arm.
 *
 * With `FEATURE_REAL_AUTH` off there is no session, so a route navigation is the
 * whole switch and `router.push` is correct.
 *
 * With it on, a route navigation cannot change who you are. Every surface page
 * calls `requireRole()` and redirects a caller holding another role back to its
 * own surface, so pushing `/admin` as the consumer lands you on `/consumer`
 * again — the control appears to do nothing, which is the defect this replaces.
 * The session has to be exchanged first, and `/api/auth/quick-sign-in` is
 * already the route that does it: it signs in the seeded account for the posted
 * role and answers a same-origin redirect to the surface derived from that
 * account's own profile row.
 *
 * The destination is deliberately not sent. The route derives it from the
 * profile it just authenticated, so asking for one here could only disagree with
 * the account actually signed in.
 *
 * `quickSignIn` is the caller's promise that the route will answer. When it is
 * false under real auth the switcher must not be rendered at all, because the
 * route 404s and there is no way to honour the click — the surface pages make
 * that decision from `demoQuickSignInEnabled()` rather than guessing here.
 */
export function useRoleSwitch({
  onSettled,
  quickSignIn,
  realAuth,
}: {
  onSettled?: () => void;
  quickSignIn: boolean;
  realAuth: boolean;
}): (role: DemoRole) => void {
  const router = useRouter();

  return useCallback(
    (role: DemoRole) => {
      const path = SURFACE_PATH_BY_DEMO_ROLE[role];

      if (!realAuth) {
        onSettled?.();
        router.push(path);
        return;
      }

      if (!quickSignIn) {
        onSettled?.();
        return;
      }

      void (async () => {
        try {
          const response = await fetch("/api/auth/quick-sign-in", {
            body: JSON.stringify({ role }),
            headers: { "Content-Type": "application/json" },
            method: "POST",
          });

          if (response.redirected) {
            // A full document load rather than router.push: the session cookie
            // changed, and every server component on the way in has to be
            // rendered for the new identity rather than served from the client
            // router's cache for the old one.
            window.location.assign(response.url);
            return;
          }
        } catch {
          // Fall through to onSettled: a failed switch closes the dialog and
          // leaves the caller where they already were, signed in as before.
        }

        onSettled?.();
      })();
    },
    [onSettled, quickSignIn, realAuth, router],
  );
}
