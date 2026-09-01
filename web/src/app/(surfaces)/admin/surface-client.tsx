"use client";

import { useCallback, useState } from "react";

import { DemoEnvironmentBar } from "@/components/demo/demo-chrome";
import { FeedbackSessionProvider } from "@/components/demo/feedback-session";
import { ProfileSwitcher } from "@/components/demo/profile-switcher";
import { useRoleSwitch } from "@/lib/demo/use-role-switch";
import { AdminSurface } from "@/components/surfaces/admin";

import type { SessionDisplayIdentity } from "@/lib/auth/display-identity";

/**
 * `SurfaceProps` is `{ onOpenProfiles: () => void }` and a Server Component
 * cannot pass a function across the boundary, so every surface route needs a
 * thin client wrapper. This one reproduces the parts of `DemoApp`'s envelope
 * the admin surface actually needs and drops the rest.
 *
 * What must be here, and what breaks without it:
 *   - FeedbackSessionProvider. The surface calls `useFeedbackSession()`, which
 *     throws outside its provider, so the route 500s.
 *   - `--demo-banner-height`. Declared in one place in the whole codebase and
 *     read in twenty across eight files, in `top-[var(--demo-banner-height)]`
 *     and `min-h-[calc(100dvh-var(--demo-banner-height))]`. Undefined, each of
 *     those declarations is invalid at computed-value time, `top` falls back to
 *     `auto`, and every sticky header and the fixed sidebar quietly stop being
 *     positioned. Nothing errors; it just looks broken.
 *   - The `pt-[var(--demo-banner-height)]` container, so the surface clears the
 *     fixed bar.
 *   - `data-mf-surface`, unconditional in the SSR output, which is what the
 *     four-role walk asserts against instead of a copy string that can move
 *     behind a tab or be reworded.
 *
 * What is deliberately absent: a second tooltip provider, because layout.tsx
 * already wraps every route in one; the launch-animation attribute and its
 * skeleton, whose CSS simply does not apply while the attribute is missing; and
 * the scroll-and-focus dance that existed to manage an intra-SPA role switch a
 * route navigation now handles by itself.
 *
 * `realAuth` arrives as a plain boolean prop because FEATURE_REAL_AUTH is
 * server-side only: `featureFlag()` inside a client component returns false
 * unconditionally, and a NEXT_PUBLIC_ twin would bake the value into the bundle
 * and turn a runtime switch into a redeploy (D-55).
 */
export function AdminSurfaceClient({
  adminEnabled = false,
  paidRefreshEnabled = false,
  quickSignIn,
  realAuth,
  sessionIdentity,
  vaultEnabled = false,
}: {
  adminEnabled?: boolean;
  paidRefreshEnabled?: boolean;
  quickSignIn: boolean;
  realAuth: boolean;
  sessionIdentity?: SessionDisplayIdentity;
  vaultEnabled?: boolean;
}) {
  const [profileSwitcherOpen, setProfileSwitcherOpen] = useState(false);
  const openProfiles = () => setProfileSwitcherOpen(true);
  const closeProfiles = useCallback(() => setProfileSwitcherOpen(false), []);
  const selectRole = useRoleSwitch({
    onSettled: closeProfiles,
    quickSignIn,
    realAuth,
  });

  return (
    <FeedbackSessionProvider seeded={!realAuth}>
      <div
        className="min-h-dvh [--demo-banner-height:2.75rem] sm:[--demo-banner-height:2.25rem]"
        data-mf-surface="admin"
        data-motion-route
      >
        <DemoEnvironmentBar realAuth={realAuth} />
        <div className="pt-[var(--demo-banner-height)]">
          <AdminSurface
            adminEnabled={adminEnabled}
            onOpenProfiles={openProfiles}
            paidRefreshEnabled={paidRefreshEnabled}
            sessionIdentity={sessionIdentity}
            signedIn={realAuth}
            vaultEnabled={vaultEnabled}
          />
        </div>
        {realAuth && !quickSignIn ? null : (
        <ProfileSwitcher
          seededIdentities
          activeRole="admin"
          onOpenChange={setProfileSwitcherOpen}
          onSelect={selectRole}
          open={profileSwitcherOpen}
        />
        )}
      </div>
    </FeedbackSessionProvider>
  );
}
