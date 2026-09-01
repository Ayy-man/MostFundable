"use client";

import { useCallback, useState } from "react";

import { DemoEnvironmentBar } from "@/components/demo/demo-chrome";
import { FeedbackSessionProvider } from "@/components/demo/feedback-session";
import { ProfileSwitcher } from "@/components/demo/profile-switcher";
import { useRoleSwitch } from "@/lib/demo/use-role-switch";
import { OperatorSurface } from "@/components/surfaces/operator";
import type { SessionDisplayIdentity } from "@/lib/auth/display-identity";
import type { PublishedBrand } from "@/lib/tenancy/types";

/**
 * `SurfaceProps` is `{ onOpenProfiles: () => void }` and a Server Component
 * cannot pass a function across the boundary, so every surface route needs a
 * thin client wrapper. This one reproduces the parts of `DemoApp`'s envelope
 * the operator surface actually needs and drops the rest.
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
 * `trackerEnabled` travels the same way and for the same reason as `realAuth`,
 * with one extra consequence: the operator Dashboard uses it to decide on the
 * first paint whether its rollups come from the workspace or from fixtures.
 * Deriving that from the `/api/clients` response instead would paint the
 * fixture numbers first and swap them a moment later.
 *
 * `vaultEnabled` travels the same way again, for the Bank Vault: the surface
 * decides on the first paint whether its lender rows come from `banks_cache` or
 * from the fixtures, and deriving that from the `/api/banks` response would
 * paint the illustrative lenders first.
 *
 * `realAuth` arrives as a plain boolean prop because FEATURE_REAL_AUTH is
 * server-side only: `featureFlag()` inside a client component returns false
 * unconditionally, and a NEXT_PUBLIC_ twin would bake the value into the bundle
 * and turn a runtime switch into a redeploy (D-55).
 */
export function OperatorSurfaceClient({
  affiliatesEnabled = false,
  applicationsEnabled = false,
  feesEnabled = false,
  paidRefreshEnabled = false,
  quickSignIn,
  realAuth,
  sessionIdentity,
  tenantBrand,
  tenancyEnabled = false,
  timelineEnabled = false,
  trackerEnabled = false,
  vaultEnabled = false,
}: {
  affiliatesEnabled?: boolean;
  applicationsEnabled?: boolean;
  feesEnabled?: boolean;
  paidRefreshEnabled?: boolean;
  quickSignIn: boolean;
  realAuth: boolean;
  sessionIdentity?: SessionDisplayIdentity;
  tenantBrand?: PublishedBrand;
  tenancyEnabled?: boolean;
  timelineEnabled?: boolean;
  trackerEnabled?: boolean;
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
        data-mf-surface="operator"
        data-motion-route
      >
        <DemoEnvironmentBar realAuth={realAuth} />
        <div className="pt-[var(--demo-banner-height)]">
          <OperatorSurface
            affiliatesEnabled={affiliatesEnabled}
            applicationsEnabled={applicationsEnabled}
            feesEnabled={feesEnabled}
            onOpenProfiles={openProfiles}
            paidRefreshEnabled={paidRefreshEnabled}
            sessionIdentity={sessionIdentity}
            tenantBrand={tenantBrand}
            tenancyEnabled={tenancyEnabled}
            timelineEnabled={timelineEnabled}
            trackerEnabled={trackerEnabled}
            vaultEnabled={vaultEnabled}
          />
        </div>
        {realAuth && !quickSignIn ? null : (
        <ProfileSwitcher
          seededIdentities
          activeRole="operator"
          onOpenChange={setProfileSwitcherOpen}
          onSelect={selectRole}
          open={profileSwitcherOpen}
        />
        )}
      </div>
    </FeedbackSessionProvider>
  );
}
