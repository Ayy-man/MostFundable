"use client";

import { useCallback, useState } from "react";

import { DemoEnvironmentBar } from "@/components/demo/demo-chrome";
import { FeedbackSessionProvider } from "@/components/demo/feedback-session";
import { ProfileSwitcher } from "@/components/demo/profile-switcher";
import { useRoleSwitch } from "@/lib/demo/use-role-switch";
import { ConsumerSurface } from "@/components/surfaces/consumer";
import type { SessionDisplayIdentity } from "@/lib/auth/display-identity";
import type { ConsumerApplicationContext } from "@/lib/demo/types";
import type { ConsumerTeamChatSnapshot } from "@/lib/support";

/**
 * `SurfaceProps` is `{ onOpenProfiles: () => void }` and a Server Component
 * cannot pass a function across the boundary, so every surface route needs a
 * thin client wrapper. This one reproduces the parts of `DemoApp`'s envelope
 * the consumer surface actually needs and drops the rest.
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
 * `sessionIdentity` travels as a plain prop for the same reason `PublishedBrand`
 * does on the operator route: it is read server-side under the caller's own RLS,
 * and absent means the fixture shell, where the fixture operator brand is right.
 *
 * `teamChat` is the consumer's durable team chat, read on the server so the
 * conversation is on screen at first paint rather than after three sequential
 * requests. It is spread rather than written as an attribute for exactly one
 * reason: `ConsumerSurface` lives in `web/src/components/`, which the lane that
 * wrote this read may not edit (chat rebuild contract §1), so its props type
 * does not name `teamChat` yet. An attribute would be an excess-property error
 * against a type only the owning lane can widen; a spread is not, so the value
 * flows today and stays inert until the consumer team chat destructures it —
 * one word on their side instead of a two-file landing that has to happen at
 * once. Fold it into the attribute list above the moment that type names it.
 *
 * `realAuth` arrives as a plain boolean prop because FEATURE_REAL_AUTH is
 * server-side only: `featureFlag()` inside a client component returns false
 * unconditionally, and a NEXT_PUBLIC_ twin would bake the value into the bundle
 * and turn a runtime switch into a redeploy (D-55).
 */
export function ConsumerSurfaceClient({
  applicationContext,
  paidRefreshEnabled = false,
  quickSignIn,
  realAuth,
  referralsEnabled = false,
  sessionIdentity,
  teamChat,
  timelineEnabled = false,
}: {
  applicationContext: ConsumerApplicationContext;
  paidRefreshEnabled?: boolean;
  timelineEnabled?: boolean;
  quickSignIn: boolean;
  realAuth: boolean;
  referralsEnabled?: boolean;
  sessionIdentity?: SessionDisplayIdentity;
  teamChat: ConsumerTeamChatSnapshot | null;
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
        data-mf-surface="consumer"
        data-motion-route
      >
        <DemoEnvironmentBar realAuth={realAuth} />
        <div className="pt-[var(--demo-banner-height)]">
          <ConsumerSurface applicationContext={applicationContext} onOpenProfiles={openProfiles} paidRefreshEnabled={paidRefreshEnabled} realAuth={realAuth} referralsEnabled={referralsEnabled} sessionIdentity={sessionIdentity} teamChat={teamChat} timelineEnabled={timelineEnabled} />
        </div>
        {realAuth && !quickSignIn ? null : (
        <ProfileSwitcher
          seededIdentities
          activeRole="consumer"
          onOpenChange={setProfileSwitcherOpen}
          onSelect={selectRole}
          open={profileSwitcherOpen}
        />
        )}
      </div>
    </FeedbackSessionProvider>
  );
}
